/** OIDC SSO account provider; browser approval never bypasses local cancellation. */
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { platform, release } from 'node:os'
import { promises as streamPromises } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { DeepSeekAccount, installAccountTaskCancellation, platformClientHeaders, platformWireLocale, type AccountBonusBatch, type AccountBonusOrderId, type AccountClientMetadata, type AccountDetails, type AccountProfile, type AccountUserId, type AccountView, type PlatformSession, type SignInAttemptId, type SignInAttemptView } from '@deepseek-ai/dsh-deepseek-account'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { AccountUnauthorizedError, OidcAuthError, buildAuthorizeUrl, deploymentHeaders, fetchUserInfo, loginOrigin, oidcOrigin, resolveEndpoints, revokeToken, tokenRequest, type ClientAuth, type OidcEndpoints } from './oidc.ts'

/** Deployment-specific OIDC SSO configuration. */
export interface Config {
  /** OIDC issuer origin; discovery reads `{issuer}/.well-known/openid-configuration`. */
  issuer?: string
  /** User-facing name of the SSO shown by generic authorization surfaces. */
  displayName?: string
  /** Public client identifier registered at the SSO. */
  clientId?: string
  /** Optional confidential-client secret; desktop deployments normally leave this empty. */
  clientSecret?: string
  /** How clientSecret authenticates token requests (default `basic`). */
  clientSecretAuth?: 'basic' | 'post'
  /** Requested scope string (default `openid profile email offline_access`). */
  scope?: string
  /** Read `.well-known/openid-configuration` for endpoints not configured explicitly (default true). */
  discovery?: boolean
  /** Explicit authorization endpoint; wins over discovery. */
  authorizationEndpoint?: string
  /** Explicit token endpoint; wins over discovery. */
  tokenEndpoint?: string
  /** Explicit userinfo endpoint; wins over discovery. */
  userinfoEndpoint?: string
  /** Explicit RFC 7009 revocation endpoint; wins over discovery. */
  revocationEndpoint?: string
  /** Explicit end-session endpoint; wins over discovery. */
  endSessionEndpoint?: string
  /** Exact HTTP(S) origin allowed to receive account tokens for inference and files. */
  inferenceOrigin?: string
  /** Allow HTTP only on loopback for a development IdP. */
  allowLoopbackHttp?: boolean
  /** Account console link shown in the account UI; defaults to `{issuer}/usage`. */
  usageUrl?: string
  /** Account top-up link shown in the account UI; defaults to `{issuer}/top_up`. */
  topUpUrl?: string
  /** userinfo claim carrying the stable account id (default `sub`). */
  claimId?: string
  /** userinfo claim carrying the display name (default `nickname`, falling back to `username`). */
  claimName?: string
  /** userinfo claim carrying the contact (default `email`, falling back to `mobile`). */
  claimContact?: string
  /** userinfo claim carrying the avatar URL (default `picture`). */
  claimAvatar?: string
  /** Host-only headers sent exclusively to the SSO origin; authorization headers cannot be overridden. */
  requestHeaders?: Record<string, string>
  /** Deadline for each SSO HTTP request. */
  requestTimeoutMs?: number
  /** Upper bound for the entire local attempt. */
  attemptTimeoutMs?: number
  /** Additional revocation attempts after the first request fails, at most five. */
  logoutMaxRetries?: number
  /** Delay before the first revocation retry; each later delay doubles. */
  logoutRetryDelayMs?: number
  /** Access tokens this close to expiry are refreshed before use (default one minute). */
  refreshMarginMs?: number
  /** Native desktop identity for SSO requests; null identifies the client as web. */
  desktopPlatform?: 'darwin' | 'win32' | null
}

/** Validated deployment choices. */
export const Config = Schema.object({
  issuer: Schema.string().default('https://hub.puresnake.com'),
  displayName: Schema.string().default('SSO'),
  clientId: Schema.string().default(''),
  clientSecret: Schema.string().role('secret').default(''),
  clientSecretAuth: Schema.union([Schema.const('basic'), Schema.const('post')]).default('basic'),
  scope: Schema.string().default('openid profile email offline_access'),
  discovery: Schema.boolean().default(true),
  authorizationEndpoint: Schema.string().default(''),
  tokenEndpoint: Schema.string().default(''),
  userinfoEndpoint: Schema.string().default(''),
  revocationEndpoint: Schema.string().default(''),
  endSessionEndpoint: Schema.string().default(''),
  inferenceOrigin: Schema.string().default('https://hub.puresnake.com'),
  allowLoopbackHttp: Schema.boolean().default(false),
  usageUrl: Schema.string().default(''),
  topUpUrl: Schema.string().default(''),
  claimId: Schema.string().default('sub'),
  claimName: Schema.string().default('nickname'),
  claimContact: Schema.string().default('email'),
  claimAvatar: Schema.string().default('picture'),
  requestHeaders: Schema.dict(Schema.string().role('secret')).default({}),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  attemptTimeoutMs: Schema.number().min(1).max(3_600_000).default(600_000),
  logoutMaxRetries: Schema.number().min(0).max(5).step(1).default(5),
  logoutRetryDelayMs: Schema.number().min(1).max(60_000).default(1_000),
  refreshMarginMs: Schema.number().min(1_000).max(600_000).default(60_000),
  desktopPlatform: Schema.union([Schema.const('darwin'), Schema.const('win32'), Schema.const(null)]).default(null),
})

const KEY = credentialKey('oidc-account', 'default')
const DEVICE = credentialKey('oidc-account', 'device')
const grant = z.object({
  version: z.literal(1),
  token: z.string().min(1),
  issuer: z.url(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().positive().optional(),
})
const device = z.object({ id: z.uuid() })
type Grant = z.infer<typeof grant>

interface Attempt {
  locale: 'en_US' | 'zh_CN'
  clientHeaders: Record<string, string>
  view: SignInAttemptView
  controller: AbortController
  done: Promise<void>
  running: Promise<void>
  origin: string
  loginSource: 'web' | 'desktop'
  disposeCallback?: () => Promise<void>
  callback?: ServerResponse
  initialProfile?: { token: string; value: AccountDetails['profile'] }
}

/** The OIDC implementation owns login state and its opaque stored grant. */
export class OidcAccount extends DeepSeekAccount {
  static inject = ['credentials', 'authorization']
  static Config = Config
  private readonly issuer: string
  private readonly inferenceOrigin: string
  private readonly displayName: string
  private readonly configuredEndpoints: { authorization: string; token: string; userinfo: string; revocation: string; endSession: string }
  private readonly discovery: boolean
  private readonly allowLoopbackHttp: boolean
  private readonly clientAuth: ClientAuth
  private readonly clientId: string
  private readonly scope: string
  private readonly links: { usageUrl: string; topUpUrl: string }
  private readonly claims: { id: string; name: string; contact: string; avatar: string }
  private readonly platform: 'darwin' | 'win32' | null
  private readonly requestHeaders: Record<string, string>
  private readonly requestTimeout: number
  private readonly attemptTimeout: number
  private readonly refreshMargin: number
  private readonly logoutMaxRetries: number
  private readonly logoutRetryDelayMs: number
  private readonly logoutLifetime = new AbortController()
  private readonly revocations = new Set<Promise<void>>()
  private endpointsPromise: Promise<OidcEndpoints> | undefined
  private refreshing: Promise<Grant | null> | undefined
  private attempt: Attempt | undefined
  private readonly listeners = new Set<() => void>()
  /**
   * Latest ready profile read and the grant token it was read with. Binding the token keeps a
   * cached identity from answering for a credential that has since changed.
   */
  private lastProfile: { readonly token: string; readonly profile: Extract<AccountDetails['profile'], { status: 'ready' }> } | undefined
  private detailsLifetime = new AbortController()
  private closed = false
  private removing: Promise<AccountView> | undefined

  /** @param ctx - Host with authorization and credentials services. @param config - deployment options. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    installAccountTaskCancellation(ctx)
    const resolved = Config(config)
    this.issuer = oidcOrigin(resolved.issuer, resolved.allowLoopbackHttp)
    const inference = new URL(resolved.inferenceOrigin)
    if (!['http:', 'https:'].includes(inference.protocol) || inference.username || inference.password
      || inference.pathname !== '/' || inference.search || inference.hash) {
      throw new Error('oidc-account: inferenceOrigin must be an HTTP(S) origin without credentials, path, query or fragment')
    }
    this.inferenceOrigin = inference.origin
    this.displayName = resolved.displayName
    this.configuredEndpoints = {
      authorization: resolved.authorizationEndpoint, token: resolved.tokenEndpoint,
      userinfo: resolved.userinfoEndpoint, revocation: resolved.revocationEndpoint, endSession: resolved.endSessionEndpoint,
    }
    this.discovery = resolved.discovery
    this.allowLoopbackHttp = resolved.allowLoopbackHttp
    this.clientId = resolved.clientId
    this.clientAuth = { clientId: resolved.clientId, clientSecret: resolved.clientSecret, method: resolved.clientSecretAuth }
    this.scope = resolved.scope
    this.links = {
      usageUrl: resolved.usageUrl !== '' ? resolved.usageUrl : `${this.issuer}/usage`,
      topUpUrl: resolved.topUpUrl !== '' ? resolved.topUpUrl : `${this.issuer}/top_up`,
    }
    this.claims = { id: resolved.claimId, name: resolved.claimName, contact: resolved.claimContact, avatar: resolved.claimAvatar }
    this.platform = resolved.desktopPlatform
    this.requestHeaders = deploymentHeaders(resolved.requestHeaders)
    this.requestTimeout = resolved.requestTimeoutMs
    this.attemptTimeout = resolved.attemptTimeoutMs
    this.refreshMargin = resolved.refreshMarginMs
    this.logoutMaxRetries = resolved.logoutMaxRetries
    this.logoutRetryDelayMs = resolved.logoutRetryDelayMs
    ctx.authorization.registerFlow({
      key: KEY, label: this.displayName, methods: [{ id: 'browser', label: this.displayName }],
      run: (session) => {
        const attempt = this.attempt
        if (attempt === undefined) return Promise.reject(new OidcAuthError('protocol'))
        attempt.running = this.run(session, attempt)
        return attempt.running
      },
    })
    ctx.on('credentials/record-updated', (key) => {
      if (key !== KEY) return
      this.invalidateDetails()
      this.changed()
    })
    ctx.effect(() => async () => {
      this.closed = true
      this.logoutLifetime.abort()
      this.invalidateDetails()
      const active = this.attempt
      if (active !== undefined) {
        if (active.view.phase !== 'committing') active.controller.abort()
        await active.done
      }
      await this.removing
      await Promise.all(this.revocations)
      this.changed()
    }, 'oidc-account: active attempt lifetime')
  }

  async [Service.init](): Promise<void> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return
    if (record.kind !== 'grant') throw new OidcAuthError('storage')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new OidcAuthError('storage')
    if (parsed.data.issuer === this.issuer) return
    await this.ctx.credentials.deleteRecord(KEY)
    console.info('[oidc-account] stored grant discarded', { reason: 'issuer-mismatch' })
  }

  override async getState(): Promise<AccountView> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record !== undefined && (record.kind !== 'grant' || !grant.safeParse(record.payload).success)) {
      throw new OidcAuthError('storage')
    }
    const attempt = this.attempt?.view ?? null
    return {
      status: record === undefined ? 'signed-out' : 'credential-stored',
      // Credential removal can notify watchers before sign-out finishes clearing the attempt.
      attempt: record === undefined && attempt?.phase === 'succeeded' ? null : attempt,
      links: this.links,
    }
  }

  override async getProfile(client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    const lifetime = this.detailsLifetime
    const stored = await this.usableGrant(lifetime)
    if (stored === null || lifetime.signal.aborted) return null
    if (this.attempt?.initialProfile?.token === stored.token) {
      const initial = this.attempt.initialProfile.value
      delete this.attempt.initialProfile
      this.cacheProfile(stored.token, initial as Extract<AccountDetails['profile'], { status: 'ready' }>)
      return initial
    }
    const endpoints = await this.endpoints()
    if (endpoints.userinfo === undefined) return { status: 'failed' }
    try {
      const claims = await fetchUserInfo(endpoints.userinfo, stored.token,
        AbortSignal.any([lifetime.signal, AbortSignal.timeout(this.requestTimeout)]),
        { ...this.requestHeaders, ...platformClientHeaders(this.platform, client) })
      if (this.detailsLifetime !== lifetime) return null
      const result: AccountDetails['profile'] = { status: 'ready', value: this.profileOf(claims) }
      this.cacheProfile(stored.token, result as Extract<AccountDetails['profile'], { status: 'ready' }>)
      return result
    } catch (error) {
      if (error instanceof AccountUnauthorizedError) {
        if (this.detailsLifetime === lifetime) await this.expireCredential(stored.token, lifetime)
        return null
      }
      if (this.detailsLifetime !== lifetime) return null
      // Only this same grant's last ready read may stand in for a failed refresh.
      const cached = this.lastProfile?.token === stored.token ? this.lastProfile.profile : undefined
      return cached ?? { status: 'failed' }
    }
  }

  /** A generic SSO has no wallet ledger; the balance card renders its unavailable state. */
  override async getBalance(_client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    const stored = await this.usableGrant(this.detailsLifetime)
    if (stored === null) return null
    return { status: 'failed' }
  }

  /** A generic SSO has no bonus orders; nothing is ever displayed. */
  override async getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<AccountBonusBatch | null> {
    return null
  }

  /** A generic SSO has no bonus orders; acknowledgements never apply. */
  override ackBonusNotified(_accountId: AccountUserId, _orderId: AccountBonusOrderId, _client: AccountClientMetadata): Promise<boolean> {
    return Promise.resolve(false)
  }

  override async rejectToken(token: string): Promise<void> {
    const lifetime = this.detailsLifetime
    const stored = await this.readCurrentGrant(lifetime)
    if (stored?.token !== token || this.detailsLifetime !== lifetime) return
    await this.expireCredential(token, lifetime)
  }

  private async expireCredential(token: string, lifetime: AbortController): Promise<void> {
    this.removing ??= (async () => {
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      const record = await this.ctx.credentials.readRecord(KEY)
      if (this.closed || this.detailsLifetime !== lifetime || record?.kind !== 'grant') return this.getState()
      const current = grant.parse(record.payload)
      if (current.token !== token || current.issuer !== this.issuer) return this.getState()
      await this.ctx.credentials.deleteRecord(KEY)
      this.ctx.emit('deepseek-account/session-expired')
      this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    await this.removing
  }

  override async getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    const [record, session] = await Promise.all([
      this.ctx.credentials.readRecord(DEVICE),
      this.getPlatformSession(),
    ])
    const parsed = record?.kind === 'grant' ? device.safeParse(record.payload) : undefined
    return {
      ...parsed?.success ? { deviceId: parsed.data.id } : {},
      ...session?.userId == null ? {} : { userId: session.userId },
      osVersion: deviceOsVersion(),
    }
  }

  override async getPlatformSession(): Promise<PlatformSession | null> {
    const lifetime = this.detailsLifetime
    const stored = await this.usableGrant(lifetime)
    if (stored === null || lifetime.signal.aborted) return null
    // Identity comes from the profile read for this same grant; an unknown ID requires disposable
    // browser storage. A replaced credential never publishes the account its predecessor named.
    return {
      origin: this.issuer, token: stored.token,
      userId: this.lastProfile?.token === stored.token ? this.lastProfile.profile.value.id || null : null,
      requestHeaders: { ...this.requestHeaders },
    }
  }

  private async readCurrentGrant(lifetime: AbortController): Promise<Grant | null> {
    if (this.closed) return null
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined || lifetime.signal.aborted) return null
    if (record.kind !== 'grant') throw new OidcAuthError('storage')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new OidcAuthError('storage')
    // A private issuer override must never forward a grant issued by another environment.
    if (parsed.data.issuer !== this.issuer) throw new OidcAuthError('protocol')
    return parsed.data
  }

  /** Refresh within this margin of expiry; tokens without an expiry never refresh. */
  private needsRefresh(stored: Grant): boolean {
    return stored.expiresAt !== undefined && stored.expiresAt - Date.now() <= this.refreshMargin
  }

  private isExpired(stored: Grant): boolean {
    return stored.expiresAt !== undefined && stored.expiresAt <= Date.now()
  }

  /** Cached endpoint resolution; configuration is fixed for the provider lifetime. */
  private endpoints(): Promise<OidcEndpoints> {
    this.endpointsPromise ??= resolveEndpoints(this.issuer, this.configuredEndpoints, this.discovery,
      this.allowLoopbackHttp, AbortSignal.timeout(this.requestTimeout), this.requestHeaders)
    return this.endpointsPromise
  }

  /**
   * Read the stored grant and rotate it when it nears expiry. The refresh rides the record
   * store's cross-process lock inside modifyRecord, so concurrent processes cannot lose a
   * rotated refresh token.
   * @param lifetime - credential lifetime the grant is read under.
   * @returns a usable grant, or null while signed out or unable to refresh an expired grant.
   */
  private async usableGrant(lifetime: AbortController): Promise<Grant | null> {
    const stored = await this.readCurrentGrant(lifetime)
    if (stored === null) return null
    if (!this.needsRefresh(stored)) return stored
    this.refreshing ??= this.doRefresh(stored).finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  private async doRefresh(stored: Grant): Promise<Grant | null> {
    if (stored.refreshToken === undefined) {
      // Without a refresh token an expired grant can only be signed in again.
      if (this.isExpired(stored)) {
        await this.expireCredential(stored.token, this.detailsLifetime)
        return null
      }
      return stored
    }
    try {
      const resolved = await this.endpoints()
      const updated = await this.ctx.credentials.modifyRecord(KEY, async (current) => {
        if (current === undefined || current.kind !== 'grant') return undefined
        const parsed = grant.safeParse(current.payload)
        // Another process already rotated or replaced this grant; adopt its write.
        if (!parsed.success || parsed.data.token !== stored.token) return undefined
        if (!this.needsRefresh(parsed.data)) return undefined
        const tokens = await tokenRequest(resolved.token, {
          grant_type: 'refresh_token', refresh_token: parsed.data.refreshToken ?? '',
        }, this.clientAuth, AbortSignal.any([this.logoutLifetime.signal, AbortSignal.timeout(this.requestTimeout)]), this.requestHeaders)
        return {
          kind: 'grant' as const,
          payload: {
            version: 1 as const,
            token: tokens.access_token,
            issuer: parsed.data.issuer,
            ...tokens.refresh_token !== undefined ? { refreshToken: tokens.refresh_token }
              : parsed.data.refreshToken !== undefined ? { refreshToken: parsed.data.refreshToken } : {},
            ...tokens.expires_in !== undefined ? { expiresAt: Date.now() + tokens.expires_in * 1000 }
              : parsed.data.expiresAt !== undefined ? { expiresAt: parsed.data.expiresAt } : {},
          },
        }
      })
      if (updated === undefined || updated.kind !== 'grant') return null
      const parsed = grant.safeParse(updated.payload)
      if (!parsed.success) return null
      if (parsed.data.token === stored.token && this.needsRefresh(parsed.data)) return null
      return parsed.data
    } catch (error) {
      if (error instanceof AccountUnauthorizedError) {
        await this.expireCredential(stored.token, this.detailsLifetime)
        return null
      }
      console.info('[oidc-account] token refresh failed', {
        errorCode: error instanceof OidcAuthError ? error.code : 'protocol',
      })
      // A transient failure keeps a still-valid token usable; an expired one cannot authenticate.
      return this.isExpired(stored) ? null : stored
    }
  }

  override async resolveToken(url: string): Promise<string | undefined> {
    if (this.closed || this.removing !== undefined) return undefined
    const destination = new URL(url)
    if (destination.origin !== this.inferenceOrigin || destination.username || destination.password) return undefined
    const stored = await this.readCurrentGrant(this.detailsLifetime)
    if (stored === null) return undefined
    // Development grants never authenticate model or file requests.
    if (stored.token.startsWith('dsh_mock_')) return undefined
    if (new URL(stored.issuer).origin !== this.issuer) return undefined
    if (this.needsRefresh(stored)) {
      const refreshed = await this.usableGrant(this.detailsLifetime)
      if (refreshed === null || refreshed.token.startsWith('dsh_mock_')) return undefined
      return refreshed.token
    }
    return stored.token
  }

  override async startSignIn(client: AccountClientMetadata, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView> {
    if (this.removing !== undefined) await this.removing
    const origin = loginOrigin(callbackOrigin)
    if (this.closed) throw new OidcAuthError('protocol')
    if (this.attempt !== undefined && ['initializing', 'waiting-browser', 'exchanging', 'committing'].includes(this.attempt.view.phase)) {
      return this.getState()
    }
    const previous = this.attempt
    if (previous !== undefined) {
      await previous.done
      // Disposal can close the provider while the previous attempt settles.
      if (this.closed) throw new OidcAuthError('protocol')
      if (this.attempt !== previous) return this.getState()
    }
    const attempt: Attempt = {
      origin, loginSource,
      locale: platformWireLocale(client.locale),
      clientHeaders: platformClientHeaders(this.platform, client),
      view: { id: randomUUID() as SignInAttemptId, phase: 'initializing' },
      controller: new AbortController(), done: Promise.resolve(), running: Promise.resolve(),
    }
    this.attempt = attempt
    attempt.done = this.ctx.authorization.begin({
      key: KEY, signal: attempt.controller.signal,
      interaction: { notify: () => undefined, prompt: () => Promise.reject(new OidcAuthError('protocol')) },
    }).then((outcome) => {
      this.update(attempt, { phase: outcome.status === 'authorized' ? 'succeeded' : 'cancelled' })
      if (outcome.status === 'authorized') this.finishSucceededCallback(attempt)
      else attempt.callback?.writeHead(204, { 'cache-control': 'no-store' }).end()
    }).catch((error: unknown) => {
      const code = error instanceof OidcAuthError ? error.code : 'protocol'
      console.info('[oidc-account] sign-in failed', { errorCode: code })
      this.update(attempt, { phase: code === 'expired' ? 'expired' : 'failed', errorCode: code })
      this.finishFailedCallback(attempt)
    }).then(async () => {
      // begin() may report cancellation before the HTTP work observes its signal.
      await attempt.running.catch(() => undefined)
      if (attempt.callback !== undefined) {
        await streamPromises.finished(attempt.callback, { cleanup: true }).catch(() => undefined)
      }
      await attempt.disposeCallback?.()
    })
    this.changed()
    return this.getState()
  }

  override async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt?.view.id === id) {
      if (attempt.view.phase !== 'committing') {
        attempt.controller.abort()
        this.ctx.authorization.cancel(KEY)
      }
      await attempt.done
    }
    return this.getState()
  }

  override signOut(client: AccountClientMetadata): Promise<AccountView> {
    this.removing ??= (async () => {
      if (this.closed) throw new OidcAuthError('protocol')
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      const record = await this.ctx.credentials.readRecord(KEY)
      if (record !== undefined) {
        if (record.kind !== 'grant') throw new OidcAuthError('storage')
        const parsed = grant.safeParse(record.payload)
        if (!parsed.success) throw new OidcAuthError('storage')
        if (parsed.data.issuer !== this.issuer) throw new OidcAuthError('protocol')
        await this.ctx.credentials.deleteRecord(KEY)
        this.revoke(parsed.data.token, platformClientHeaders(this.platform, client))
      }
      this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    return this.removing
  }

  override async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /** Background revocation with capped exponential backoff; failures never restore the grant. */
  private revoke(token: string, headers: Record<string, string>): void {
    if (this.closed) return
    const revocation = this.revokeWithRetry(token, headers).finally(() => { this.revocations.delete(revocation) })
    this.revocations.add(revocation)
  }

  private async revokeWithRetry(token: string, headers: Record<string, string>): Promise<void> {
    const resolved = await this.endpoints().catch(() => undefined)
    if (resolved?.revocation === undefined) return
    for (let retry = 0; retry <= this.logoutMaxRetries; retry++) {
      if (retry > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.logoutRetryDelayMs * 2 ** (retry - 1))
          timer.unref?.()
        })
      }
      if (this.logoutLifetime.signal.aborted) return
      try {
        await revokeToken(resolved.revocation, token, this.clientAuth,
          AbortSignal.any([this.logoutLifetime.signal, AbortSignal.timeout(this.requestTimeout)]),
          { ...this.requestHeaders, ...headers })
        return
      } catch {
        // Remote revocation failures never reverse local sign-out or expose token diagnostics.
      }
    }
  }

  private invalidateDetails(): void {
    this.lastProfile = undefined
    this.detailsLifetime.abort()
    this.detailsLifetime = new AbortController()
  }

  private changed(): void { for (const listener of this.listeners) listener() }

  private update(attempt: Attempt, value: Partial<SignInAttemptView>): void {
    const { authorizeUrl: _url, ...rest } = attempt.view
    attempt.view = { ...rest, ...value }
    this.changed()
  }

  /**
   * Cache one ready profile against the grant token it was read with, so identity reuse cannot cross
   * a credential change. A stable ID that first appears or changes notifies watch consumers, so
   * identity consumers re-read getPlatformSession; repeated IDs stay silent.
   */
  private cacheProfile(token: string, profile: Extract<AccountDetails['profile'], { status: 'ready' }>): void {
    const previous = this.lastProfile?.profile.value.id || null
    this.lastProfile = { token, profile }
    if (previous !== (profile.value.id || null)) this.changed()
  }

  /** Project userinfo claims through the configured claim names. */
  private profileOf(claims: Record<string, unknown>): AccountProfile {
    const text = (key: string): string | undefined => {
      const value = claims[key]
      return typeof value === 'string' && value.length > 0 ? value : undefined
    }
    const id = text(this.claims.id)
    return {
      id: id === undefined ? null : id as AccountUserId,
      avatarUrl: text(this.claims.avatar) ?? null,
      name: text(this.claims.name) ?? text('username') ?? null,
      contact: text(this.claims.contact) ?? text('mobile') ?? null,
    }
  }

  private async run(session: AuthorizationSession, attempt: Attempt): Promise<void> {
    const webServer = this.ctx.get('webServer')
    if (webServer === undefined || this.clientId === '') throw new OidcAuthError('protocol')
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const code = Promise.withResolvers<string>()
    // Callback requests may precede readiness; the rejection is observed immediately.
    void code.promise.catch(() => undefined)
    const deadline = new AbortController()
    const signal = AbortSignal.any([session.signal, deadline.signal])
    const expiresAt = Date.now() + this.attemptTimeout
    const timer = setTimeout(() => { deadline.abort() }, this.attemptTimeout)
    const abort = (): void => { code.reject(new OidcAuthError('expired')) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      attempt.disposeCallback = this.ctx.effect(() => webServer.register({
        kind: 'exact', path: '/oauth/callback', handler: (req, res) => {
          let url: URL
          try { url = new URL(req.url ?? '/', 'http://127.0.0.1') }
          catch { res.writeHead(400, { 'cache-control': 'no-store' }).end(); return }
          const receivedCode = url.searchParams.get('code')
          const receivedState = url.searchParams.get('state') ?? ''
          const validState = Buffer.byteLength(receivedState) === Buffer.byteLength(state)
            && timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))
          if (req.method !== 'GET' || url.pathname !== '/oauth/callback' || !validState || !receivedCode
            || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1) {
            res.writeHead(400, { 'cache-control': 'no-store' }).end(); return
          }
          if (signal.aborted || attempt.callback !== undefined || attempt.view.phase !== 'waiting-browser') {
            res.writeHead(410, { 'cache-control': 'no-store' }).end(); return
          }
          attempt.callback = res
          code.resolve(receivedCode)
        },
      }), 'oidc-account: browser callback')
      signal.throwIfAborted()
      const resolved = await resolveEndpoints(this.issuer, this.configuredEndpoints, this.discovery,
        this.allowLoopbackHttp,
        AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeout)]), this.requestHeaders)
      this.endpointsPromise ??= Promise.resolve(resolved)
      const redirectUri = `${attempt.origin}/oauth/callback`
      const authorizeUrl = buildAuthorizeUrl(resolved.authorization, {
        clientId: this.clientId, redirectUri, scope: this.scope, state, codeChallenge: challenge,
      })
      this.update(attempt, { phase: 'waiting-browser', authorizeUrl, expiresAt })
      const receivedCode = await code.promise
      signal.throwIfAborted()
      this.update(attempt, { phase: 'exchanging' })
      await this.ctx.credentials.modifyRecord(DEVICE, current => Promise.resolve(current === undefined
        ? { kind: 'grant' as const, payload: { id: randomUUID() } } : undefined))
      const tokens = await tokenRequest(resolved.token, {
        grant_type: 'authorization_code', code: receivedCode, redirect_uri: redirectUri, code_verifier: verifier,
      }, this.clientAuth, AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeout)]),
      { ...this.requestHeaders, ...attempt.clientHeaders })
      signal.throwIfAborted()
      if (resolved.userinfo !== undefined) {
        try {
          const claims = await fetchUserInfo(resolved.userinfo, tokens.access_token,
            AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeout)]),
            { ...this.requestHeaders, ...attempt.clientHeaders })
          attempt.initialProfile = { token: tokens.access_token, value: { status: 'ready', value: this.profileOf(claims) } }
        } catch {
          // A userinfo prefetch failure falls back to the first explicit profile read.
        }
      }
      this.update(attempt, { phase: 'committing' })
      clearTimeout(timer)
      try {
        await session.commit({
          kind: 'grant',
          payload: {
            version: 1, token: tokens.access_token, issuer: this.issuer,
            ...tokens.refresh_token !== undefined ? { refreshToken: tokens.refresh_token } : {},
            ...tokens.expires_in !== undefined ? { expiresAt: Date.now() + tokens.expires_in * 1000 } : {},
          },
        })
      } catch { throw new OidcAuthError('storage') }
    } catch (error) {
      if (deadline.signal.aborted) throw new OidcAuthError('expired')
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      // begin() settles the browser response and removes only this attempt's route.
    }
  }

  /** The local success page replaces a platform-hosted completion page. */
  private finishSucceededCallback(attempt: Attempt): void {
    if (attempt.callback === undefined) return
    const nonce = randomBytes(16).toString('base64url')
    const message = attempt.locale === 'zh_CN' ? '登录成功，可以关闭此标签页。'
      : 'Sign-in succeeded. You can close this tab.'
    attempt.callback.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`,
      'referrer-policy': 'no-referrer',
    }).end(`<!doctype html><html lang="${attempt.locale === 'zh_CN' ? 'zh-CN' : 'en'}"><meta charset="utf-8"><title>${message}</title>`
      + `<body><p>${message}</p><script nonce="${nonce}">window.close()</script></body></html>`)
  }

  private finishFailedCallback(attempt: Attempt): void {
    if (attempt.loginSource === 'web') {
      const nonce = randomBytes(16).toString('base64url')
      const message = attempt.locale === 'zh_CN' ? '登录失败，请关闭此标签页并在原页面重试。'
        : 'Sign-in failed. Close this tab and try again in the original tab.'
      attempt.callback?.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`,
        'referrer-policy': 'no-referrer',
      }).end(`<!doctype html><html lang="${attempt.locale === 'zh_CN' ? 'zh-CN' : 'en'}"><meta charset="utf-8"><title>${message}</title>`
        + `<body><p>${message}</p><script nonce="${nonce}">window.close()</script></body></html>`)
    } else {
      // Native account subscribers focus the login window; retain the browser's SSO document.
      attempt.callback?.writeHead(204, { 'cache-control': 'no-store' }).end()
    }
  }
}
export default OidcAccount

/** OS identification shared by login and credential-free identity reads. */
function deviceOsVersion(): string {
  return `${platform()} ${release()}`
}
