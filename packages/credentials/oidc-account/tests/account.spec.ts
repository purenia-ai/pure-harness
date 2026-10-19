/** OIDC account provider behavior over a mock SSO and a real composition. */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { OidcAccount } from '../src/index.ts'

const KEY = credentialKey('oidc-account', 'default')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

/** Client identity supplied with each account operation. */
const clientMetadata = (locale = 'en'): AccountClientMetadata => ({ version: '1.2.3', locale, timezoneOffsetSeconds: 28_800 })

interface FixtureOptions {
  exchangeOverride?: Record<string, unknown>
  discovery?: boolean
  config?: Record<string, unknown>
  /** Configure `sessionExchangeUrl` as this path on the mock issuer. */
  sessionExchangePath?: string
  /** Configure `usageUrl` as this path on the mock issuer. */
  usagePath?: string
  /** Pre-seed a stored grant before the provider starts. */
  seedGrant?: Record<string, unknown>
}

async function fixture(options: FixtureOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-oidc-account-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  let origin = ''
  const tokenRequests: Array<Record<string, string>> = []
  const revokeRequests: Array<Record<string, string>> = []
  const revokeReceived = Promise.withResolvers<undefined>()
  let userinfoCalls = 0
  let exchangeFails = false
  let refreshFails = false
  const claims = { sub: 'user-1', username: 'tester', nickname: 'Test User', email: 't***@example.invalid' }
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/.well-known/openid-configuration') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        issuer: origin,
        authorization_endpoint: `${origin}/oauth2/authorize`,
        token_endpoint: `${origin}/oauth2/token`,
        userinfo_endpoint: `${origin}/oauth2/userinfo`,
        revocation_endpoint: `${origin}/oauth2/revoke`,
      }))
      return
    }
    if (req.url === '/oauth2/userinfo') {
      userinfoCalls++
      if (req.headers.authorization !== 'Bearer access-token-1' && req.headers.authorization !== 'Bearer access-token-2') {
        res.writeHead(401).end()
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(claims))
      return
    }
    if (req.url === '/oauth2/revoke') {
      req.setEncoding('utf8')
      let text = ''
      for await (const chunk of req) text += String(chunk)
      revokeRequests.push(Object.fromEntries(new URLSearchParams(text)))
      revokeReceived.resolve(undefined)
      res.writeHead(200).end()
      return
    }
    if (req.url === '/oauth2/token') {
      req.setEncoding('utf8')
      let text = ''
      for await (const chunk of req) text += String(chunk)
      const body = Object.fromEntries(new URLSearchParams(text))
      tokenRequests.push(body)
      res.setHeader('content-type', 'application/json')
      if (body.grant_type === 'authorization_code') {
        if (exchangeFails || body.code !== 'test-code') {
          res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }))
          return
        }
        res.end(JSON.stringify({
          access_token: 'access-token-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-1',
          ...(options.exchangeOverride ?? {}),
        }))
        return
      }
      if (body.grant_type === 'refresh_token') {
        if (refreshFails || body.refresh_token !== 'refresh-1') {
          res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }))
          return
        }
        res.end(JSON.stringify({ access_token: 'access-token-2', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-2' }))
        return
      }
      res.writeHead(400).end(JSON.stringify({ error: 'unsupported_grant_type' }))
      return
    }
    res.writeHead(404).end()
  }
  const server = createServer((req, res) => { void handle(req, res).catch(() => { res.writeHead(500).end() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing listener')
  origin = `http://127.0.0.1:${address.port}`
  cleanups.push(async () => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
  })
  const ctx = new Context()
  const web = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await web
  const callbackOrigin = `http://127.0.0.1:${ctx.webServer.port}`
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  const authorization = ctx.plugin(AuthorizationService)
  await authorization
  if (options.seedGrant !== undefined) {
    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: options.seedGrant }))
  }
  const provider = ctx.plugin(OidcAccount, {
    issuer: origin, clientId: 'dsh-desktop', allowLoopbackHttp: true,
    inferenceOrigin: 'https://hub.puresnake.com', logoutRetryDelayMs: 1,
    ...(options.discovery === false ? {
      discovery: false,
      authorizationEndpoint: `${origin}/oauth2/authorize`,
      tokenEndpoint: `${origin}/oauth2/token`,
      userinfoEndpoint: `${origin}/oauth2/userinfo`,
      revocationEndpoint: `${origin}/oauth2/revoke`,
    } : {}),
    ...(options.usagePath === undefined ? {} : { usageUrl: `${origin}${options.usagePath}` }),
    ...(options.sessionExchangePath === undefined ? {} : { sessionExchangeUrl: `${origin}${options.sessionExchangePath}` }),
    ...(options.config ?? {}),
  })
  await provider
  cleanups.push(async () => { await provider.dispose(); await authorization.dispose(); await credentials.dispose(); await web.dispose() })
  const account = ctx.deepseekAccount as OidcAccount
  const states = new AbortController()
  cleanups.push(async () => { states.abort() })
  async function wait(phase: string) {
    for await (const state of account.watch(states.signal)) if (state.attempt?.phase === phase) return state
    throw new Error(`missing phase ${phase}`)
  }
  return {
    ctx, account, home, origin, callbackOrigin, wait, tokenRequests, revokeRequests, revokeReceived,
    userinfoCalls: () => userinfoCalls,
    failExchange: () => { exchangeFails = true },
    failRefresh: () => { refreshFails = true },
    callback: (state: string, code = 'test-code') => `${callbackOrigin}/oauth/callback?code=${code}&state=${state}`,
  }
}

it('runs the authorization code flow with PKCE and stores the grant', async () => {
  const f = await fixture()
  await f.account.startSignIn(clientMetadata(), f.callbackOrigin, 'desktop')
  const waiting = await f.wait('waiting-browser')
  const authorizeUrl = new URL(waiting.attempt!.authorizeUrl!)
  expect(authorizeUrl.origin).toBe(f.origin)
  expect(authorizeUrl.pathname).toBe('/oauth2/authorize')
  expect(authorizeUrl.searchParams.get('response_type')).toBe('code')
  expect(authorizeUrl.searchParams.get('client_id')).toBe('dsh-desktop')
  expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(`${f.callbackOrigin}/oauth/callback`)
  expect(authorizeUrl.searchParams.get('scope')).toBe('openid profile email offline_access')
  expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorizeUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const state = authorizeUrl.searchParams.get('state')!
  expect((await fetch(f.callback('wrong-state'))).status).toBe(400)
  const response = await fetch(f.callback(state), { redirect: 'manual' })
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('Sign-in succeeded')
  expect((await f.account.getState()).status).toBe('credential-stored')
  expect(await readFile(join(f.home, 'credentials.yaml'), 'utf8')).toContain('access-token-1')
  expect(f.tokenRequests).toHaveLength(1)
  const exchange = f.tokenRequests[0]!
  expect(exchange.grant_type).toBe('authorization_code')
  expect(exchange.code).toBe('test-code')
  expect(exchange.redirect_uri).toBe(`${f.callbackOrigin}/oauth/callback`)
  expect(exchange.client_id).toBe('dsh-desktop')
  expect(exchange.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

it('prefetches the profile during exchange and re-reads it from userinfo afterwards', async () => {
  const f = await fixture()
  await f.account.startSignIn(clientMetadata(), f.callbackOrigin, 'desktop')
  const waiting = await f.wait('waiting-browser')
  await fetch(f.callback(waiting.attempt!.authorizeUrl!.match(/state=([^&]+)/)![1]!))
  await f.wait('succeeded')
  const first = await f.account.getProfile(clientMetadata())
  expect(first).toEqual({ status: 'ready', value: { id: 'user-1', name: 'Test User', contact: 't***@example.invalid', avatarUrl: null } })
  expect(f.userinfoCalls()).toBe(1)
  // Every explicit read re-queries userinfo; the cache only covers a failed refresh.
  const again = await f.account.getProfile(clientMetadata())
  expect(again?.status).toBe('ready')
  expect(f.userinfoCalls()).toBe(2)
  expect((await f.account.getPlatformSession())?.userId).toBe('user-1')
})

it('resolves the token only for the inference origin', async () => {
  const f = await fixture()
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin },
  }))
  expect(await f.account.resolveToken('https://hub.puresnake.com/v1/messages')).toBe('access-token-1')
  expect(await f.account.resolveToken('https://other.example.com/v1/messages')).toBeUndefined()
})

it('refreshes a near-expiry grant under the record lock', async () => {
  const f = await fixture()
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin, refreshToken: 'refresh-1', expiresAt: Date.now() + 1_000 },
  }))
  expect(await f.account.resolveToken('https://hub.puresnake.com')).toBe('access-token-2')
  expect(f.tokenRequests).toHaveLength(1)
  expect(f.tokenRequests[0]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'dsh-desktop' })
  const stored = await f.ctx.credentials.readRecord(KEY)
  expect(stored?.kind === 'grant' && (stored.payload as { token: string }).token).toBe('access-token-2')
  expect(stored?.kind === 'grant' && (stored.payload as { refreshToken: string }).refreshToken).toBe('refresh-2')
  // The refreshed grant is fresh; a second resolution does not hit the token endpoint again.
  expect(await f.account.resolveToken('https://hub.puresnake.com')).toBe('access-token-2')
  expect(f.tokenRequests).toHaveLength(1)
})

it('expires the grant when the refresh token is rejected', async () => {
  const f = await fixture()
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin, refreshToken: 'refresh-1', expiresAt: Date.now() + 1_000 },
  }))
  f.failRefresh()
  expect(await f.account.resolveToken('https://hub.puresnake.com')).toBeUndefined()
  expect((await f.account.getState()).status).toBe('signed-out')
})

it('drops a grant issued by another issuer at startup', async () => {
  const f = await fixture({ seedGrant: { version: 1, token: 'foreign', issuer: 'https://other-issuer.example.com' } })
  expect((await f.account.getState()).status).toBe('signed-out')
})

it('signs out locally and revokes the token in the background', async () => {
  const f = await fixture()
  await f.account.startSignIn(clientMetadata(), f.callbackOrigin, 'desktop')
  const waiting = await f.wait('waiting-browser')
  await fetch(f.callback(waiting.attempt!.authorizeUrl!.match(/state=([^&]+)/)![1]!))
  await f.wait('succeeded')
  await f.account.signOut(clientMetadata())
  expect((await f.account.getState()).status).toBe('signed-out')
  // The background revocation must reach the SSO before the provider is disposed.
  await f.revokeReceived.promise
  expect(f.revokeRequests).toHaveLength(1)
  expect(f.revokeRequests[0]).toMatchObject({ token: 'access-token-1', token_type_hint: 'access_token' })
})

it('cancels a waiting attempt and refuses a late callback', async () => {
  const f = await fixture()
  await f.account.startSignIn(clientMetadata(), f.callbackOrigin, 'desktop')
  const waiting = await f.wait('waiting-browser')
  const state = waiting.attempt!.authorizeUrl!.match(/state=([^&]+)/)![1]!
  const cancelled = await f.account.cancelSignIn(waiting.attempt!.id)
  expect(cancelled.attempt?.phase).toBe('cancelled')
  // The callback route is gone once the attempt settles; a late approval can never sign in.
  const late = await fetch(f.callback(state))
  expect(late.status).not.toBe(200)
  expect(f.tokenRequests).toHaveLength(0)
  expect((await f.account.getState()).status).toBe('signed-out')
})

it('fails the attempt when the token endpoint rejects the exchange', async () => {
  const f = await fixture()
  f.failExchange()
  await f.account.startSignIn(clientMetadata(), f.callbackOrigin, 'desktop')
  const waiting = await f.wait('waiting-browser')
  await fetch(f.callback(waiting.attempt!.authorizeUrl!.match(/state=([^&]+)/)![1]!))
  const failed = await f.wait('expired')
  expect(failed.status).toBe('signed-out')
  expect((await f.account.getState()).status).toBe('signed-out')
})

it('works without discovery when every endpoint is configured', async () => {
  const f = await fixture({ discovery: false })
  await f.account.startSignIn(clientMetadata(), f.callbackOrigin, 'desktop')
  const waiting = await f.wait('waiting-browser')
  expect(new URL(waiting.attempt!.authorizeUrl!).pathname).toBe('/oauth2/authorize')
  await fetch(f.callback(waiting.attempt!.authorizeUrl!.match(/state=([^&]+)/)![1]!))
  await f.wait('succeeded')
  expect((await f.account.getState()).status).toBe('credential-stored')
})

it('reports balance as unavailable and never lists bonuses', async () => {
  const f = await fixture()
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin },
  }))
  expect(await f.account.getBalance(clientMetadata())).toEqual({ status: 'failed' })
  expect(await f.account.getUnnotifiedBonuses(clientMetadata())).toBeNull()
  expect(await f.account.ackBonusNotified('user-1' as never, 'order-1' as never, clientMetadata())).toBe(false)
})

it('advertises same-origin account pages for the embedded document', async () => {
  const f = await fixture({ usagePath: '/gw/usage' })
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin },
  }))
  const session = await f.account.getPlatformSession()
  expect(session?.usageUrl).toBe(`${f.origin}/gw/usage`)
  expect(session?.topUpUrl).toBe(`${f.origin}/top_up`)
})

it('omits an embedded page target that leaves the issuer origin', async () => {
  const f = await fixture({ config: { usageUrl: 'https://other.example.com/usage' } })
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin },
  }))
  expect((await f.account.getPlatformSession())?.usageUrl).toBeUndefined()
  // The account UI still links to the configured console.
  expect((await f.account.getState()).links.usageUrl).toBe('https://other.example.com/usage')
})

it('advertises the configured embedded session exchange endpoint', async () => {
  const f = await fixture({ sessionExchangePath: '/oauth2/session' })
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin },
  }))
  expect((await f.account.getPlatformSession())?.sessionExchangeUrl).toBe(`${f.origin}/oauth2/session`)
})

it('omits the session exchange endpoint unless it is configured', async () => {
  const f = await fixture()
  await f.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
    kind: 'grant', payload: { version: 1, token: 'access-token-1', issuer: f.origin },
  }))
  expect((await f.account.getPlatformSession())?.sessionExchangeUrl).toBeUndefined()
})

it('rejects a session exchange endpoint outside the issuer origin', async () => {
  await expect(fixture({ config: { sessionExchangeUrl: 'https://other.example.com/oauth2/session' } }))
    .rejects.toThrow('sessionExchangeUrl must share the issuer origin')
})

it('rejects a relative session exchange endpoint', async () => {
  await expect(fixture({ config: { sessionExchangeUrl: '/oauth2/session' } }))
    .rejects.toThrow('sessionExchangeUrl must be an absolute HTTP(S) URL')
})
