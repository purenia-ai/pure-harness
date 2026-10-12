/** Validated OIDC SSO HTTP messages and restricted browser destinations. */
import { z } from 'zod'
import type { SignInErrorCode } from '@deepseek-ai/dsh-deepseek-account/types'

/** Protocol errors expose a stable code, never a response body or authorization URL. */
export class OidcAuthError extends Error {
  /** @param code - safe error classification. */
  constructor(readonly code: SignInErrorCode) { super(`oidc-account: ${code}`) }
}

/** An authenticated SSO request was rejected with HTTP 401 or an invalid_grant. */
export class AccountUnauthorizedError extends OidcAuthError {
  constructor() { super('expired') }
}

/**
 * Accept HTTPS SSO endpoints, or explicitly configured loopback development HTTP.
 * @param value - configured origin.
 * @param allowLoopbackHttp - development-only opt-in.
 * @returns normalized origin.
 */
export function oidcOrigin(value: string, allowLoopbackHttp: boolean): string {
  let url: URL
  try { url = new URL(value) } catch { throw new OidcAuthError('protocol') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || (allowLoopbackHttp && loopback && url.protocol === 'http:'))) {
    throw new Error('oidc-account: issuer and endpoint origins must be HTTPS origins or explicitly enabled loopback HTTP origins')
  }
  return url.origin
}

/**
 * Accept HTTPS (or development loopback HTTP) absolute endpoint URLs on the issuer origin.
 * @param value - configured or discovered endpoint URL.
 * @param issuer - normalized issuer origin the endpoint must belong to.
 * @param allowLoopbackHttp - development-only opt-in.
 * @returns normalized endpoint URL.
 */
export function endpointUrl(value: string, issuer: string, allowLoopbackHttp: boolean): string {
  let url: URL
  try { url = new URL(value) } catch { throw new OidcAuthError('protocol') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || (allowLoopbackHttp && loopback && url.protocol === 'http:'))
    || url.origin !== issuer) {
    console.info('[oidc-account] endpoint rejected', { originMatches: url.origin === issuer })
    throw new OidcAuthError('protocol')
  }
  return url.href
}

/**
 * Validate Host-only deployment headers without exposing their values in diagnostics.
 * @param values - configured headers for the SSO origin.
 * @returns normalized headers; authorization, routing and framing remain provider-owned.
 */
export function deploymentHeaders(values: Record<string, string>): Record<string, string> {
  const headers = new Headers()
  const names = new Set<string>()
  for (const [name, value] of Object.entries(values)) {
    const key = name.toLowerCase()
    if (['authorization', 'x-dsh-auth-token', 'host', 'content-length', 'transfer-encoding', 'connection', 'content-type'].includes(key)
      || names.has(key)) throw new Error('oidc-account: requestHeaders contains a reserved or duplicate header')
    names.add(key)
    try { headers.set(name, value) }
    catch { throw new Error('oidc-account: requestHeaders contains an invalid header') }
  }
  return Object.fromEntries(headers)
}

/**
 * Accept a browser-accessible loopback HTTP origin for local or SSH-forwarded login.
 * @param value - loopback HTTP origin with an explicit port supplied by the authenticated initiating client.
 * @returns normalized origin; remote domains and path-based proxies are unsupported.
 */
export function loginOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new OidcAuthError('protocol') }
  const explicitPort = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):([0-9]+)\/?$/i.exec(value)?.[1]
  if (explicitPort === undefined || Number(explicitPort) === 0
    || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new OidcAuthError('protocol')
  }
  return `${url.protocol}//${url.hostname}:${Number(explicitPort)}`
}

/** Discovered or configured OIDC endpoints, already origin-validated. */
export interface OidcEndpoints {
  readonly authorization: string
  readonly token: string
  readonly userinfo: string | undefined
  readonly revocation: string | undefined
  readonly endSession: string | undefined
}

const discoveryDocument = z.object({
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  userinfo_endpoint: z.url().optional(),
  revocation_endpoint: z.url().optional(),
  end_session_endpoint: z.url().optional(),
})

/**
 * Resolve the endpoint set from explicit configuration and issuer discovery.
 * @param issuer - normalized issuer origin.
 * @param configured - explicit endpoint URLs from the plugin config; empty strings mean absent.
 * @param discovery - whether to read `{issuer}/.well-known/openid-configuration` for missing endpoints.
 * @param allowLoopbackHttp - development-only opt-in.
 * @param signal - request deadline.
 * @param headers - validated deployment headers.
 * @returns origin-validated endpoints; authorization and token are always present.
 */
export async function resolveEndpoints(issuer: string,
  configured: { authorization: string; token: string; userinfo: string; revocation: string; endSession: string },
  discovery: boolean, allowLoopbackHttp: boolean,
  signal: AbortSignal, headers: Record<string, string>): Promise<OidcEndpoints> {
  let discovered: z.infer<typeof discoveryDocument> | undefined
  const missing = configured.authorization === '' || configured.token === ''
  if (discovery && missing) {
    const document = discoveryDocument.safeParse(await readJson(`${issuer}/.well-known/openid-configuration`,
      { method: 'GET', headers }, signal))
    if (!document.success) {
      console.info('[oidc-account] discovery rejected', {
        issues: document.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
      })
      throw new OidcAuthError('protocol')
    }
    discovered = document.data
  }
  function pick(explicit: string, found: string | undefined, required: true): string
  function pick(explicit: string, found: string | undefined, required: false): string | undefined
  function pick(explicit: string, found: string | undefined, required: boolean): string | undefined {
    const value = explicit !== '' ? explicit : found
    if (value === undefined) {
      if (required) throw new OidcAuthError('protocol')
      return undefined
    }
    return endpointUrl(value, issuer, allowLoopbackHttp)
  }
  return {
    authorization: pick(configured.authorization, discovered?.authorization_endpoint, true),
    token: pick(configured.token, discovered?.token_endpoint, true),
    userinfo: pick(configured.userinfo, discovered?.userinfo_endpoint, false),
    revocation: pick(configured.revocation, discovered?.revocation_endpoint, false),
    endSession: pick(configured.endSession, discovered?.end_session_endpoint, false),
  }
}

/** Token endpoint client authentication derived from the deployment config. */
export interface ClientAuth {
  readonly clientId: string
  readonly clientSecret: string
  readonly method: 'basic' | 'post'
}

/**
 * Build the browser authorization URL for the authorization code flow with PKCE.
 * @param endpoint - origin-validated authorization endpoint.
 * @param params - client identity, callback, scope, state, and challenge.
 * @returns the page the human approves in.
 */
export function buildAuthorizeUrl(endpoint: string, params: {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
}): string {
  const url = new URL(endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', params.scope)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.href
}

/** Successful token endpoint response. */
export const tokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
})

const tokenFailure = z.object({ error: z.string().min(1), error_description: z.string().optional() })

/**
 * Run one token endpoint grant (authorization_code or refresh_token).
 * @param endpoint - origin-validated token endpoint.
 * @param params - grant form fields, client_id excluded.
 * @param auth - client authentication for the token endpoint.
 * @param signal - attempt cancellation and timeout.
 * @param headers - validated deployment headers.
 * @returns validated token set.
 * @throws AccountUnauthorizedError when the SSO answers invalid_grant.
 */
export async function tokenRequest(endpoint: string, params: Record<string, string>,
  auth: ClientAuth, signal: AbortSignal, headers: Record<string, string>): Promise<z.infer<typeof tokenResponse>> {
  const body = new URLSearchParams({ ...params, client_id: auth.clientId })
  const requestHeaders: Record<string, string> = { ...headers, 'content-type': 'application/x-www-form-urlencoded' }
  if (auth.clientSecret !== '') {
    if (auth.method === 'basic') {
      requestHeaders.authorization = `Basic ${Buffer.from(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`).toString('base64')}`
    } else {
      body.set('client_secret', auth.clientSecret)
    }
  }
  let payload: unknown
  try {
    payload = await readJson(endpoint, { method: 'POST', headers: requestHeaders, body: body.toString() }, signal, true)
  } catch (error) {
    if (error instanceof TokenRejectedError) {
      console.info('[oidc-account] token request rejected', { error: error.oidcError })
      if (error.oidcError === 'invalid_grant') throw new AccountUnauthorizedError()
      throw new OidcAuthError('protocol')
    }
    throw error
  }
  const parsed = tokenResponse.safeParse(payload)
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== 'bearer') {
    console.info('[oidc-account] token response rejected', {
      issues: parsed.success ? 'token_type' : parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
    })
    throw new OidcAuthError('protocol')
  }
  return parsed.data
}

/** Token endpoint business rejection (RFC 6749 §5.2), carrying only the safe error code. */
class TokenRejectedError extends Error {
  constructor(readonly oidcError: string) { super(`oidc-account: token rejected (${oidcError})`) }
}

const userinfoResponse = z.looseObject({})

/**
 * Read the userinfo claims for one access token.
 * @param endpoint - origin-validated userinfo endpoint.
 * @param token - access token sent as a Bearer credential.
 * @param signal - credential lifetime and request timeout.
 * @param headers - validated deployment headers.
 * @returns the claim object, opaque until the caller projects configured claims.
 * @throws AccountUnauthorizedError when the SSO rejects the token with HTTP 401.
 */
export async function fetchUserInfo(endpoint: string, token: string,
  signal: AbortSignal, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const payload = await readJson(endpoint, {
    method: 'GET', headers: { ...headers, authorization: `Bearer ${token}` },
  }, signal)
  const parsed = userinfoResponse.safeParse(payload)
  if (!parsed.success) throw new OidcAuthError('protocol')
  return parsed.data
}

/**
 * Revoke one token through the RFC 7009 endpoint; the empty 200 body carries no data.
 * @param endpoint - origin-validated revocation endpoint.
 * @param token - access or refresh token to revoke.
 * @param auth - client authentication for the revocation endpoint.
 * @param signal - revocation request deadline.
 * @param headers - validated deployment headers.
 * @returns after the SSO confirms revocation.
 */
export async function revokeToken(endpoint: string, token: string,
  auth: ClientAuth, signal: AbortSignal, headers: Record<string, string>): Promise<void> {
  const body = new URLSearchParams({ token, token_type_hint: 'access_token', client_id: auth.clientId })
  const requestHeaders: Record<string, string> = { ...headers, 'content-type': 'application/x-www-form-urlencoded' }
  if (auth.clientSecret !== '') {
    if (auth.method === 'basic') {
      requestHeaders.authorization = `Basic ${Buffer.from(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`).toString('base64')}`
    } else {
      body.set('client_secret', auth.clientSecret)
    }
  }
  await readJson(endpoint, { method: 'POST', headers: requestHeaders, body: body.toString() }, signal, true)
    .catch((error: unknown) => {
      if (error instanceof TokenRejectedError) return undefined
      throw error
    })
}

/**
 * Read one bounded JSON response with stable, non-secret diagnostics.
 * @param url - validated request URL.
 * @param init - request init; the body is never logged.
 * @param signal - request cancellation and timeout.
 * @param allowEmpty - accept an empty 200 body (revocation); business error payloads still classify.
 * @returns the parsed JSON payload.
 */
async function readJson(url: string, init: RequestInit, signal: AbortSignal, allowEmpty = false): Promise<unknown> {
  const path = new URL(url).pathname
  console.info('[oidc-account] request', { path, method: init.method })
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal })
  } catch {
    console.info('[oidc-account] request failed', { path, errorCode: 'no-response', aborted: signal.aborted })
    throw new OidcAuthError('no-response')
  }
  console.info('[oidc-account] response', { path, status: response.status })
  const authenticated = new Headers(init.headers).has('authorization')
  if (response.status === 401 && authenticated && !allowEmpty) {
    await response.body?.cancel()
    throw new AccountUnauthorizedError()
  }
  const reader = response.body === null ? undefined : response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let stage = 'read-body'
  try {
    if (reader !== undefined) {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > 65_536) {
          stage = 'body-limit'
          throw new OidcAuthError('protocol')
        }
        chunks.push(next.value)
      }
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text === '' && response.ok && allowEmpty) return {}
    if (!response.ok) {
      stage = 'error-status'
      try {
        const failure = tokenFailure.safeParse(JSON.parse(text))
        if (failure.success) throw new TokenRejectedError(failure.data.error)
      } catch (error) {
        if (error instanceof TokenRejectedError) throw error
      }
      if (response.status === 401 && authenticated) throw new AccountUnauthorizedError()
      throw new OidcAuthError('network')
    }
    stage = 'parse-json'
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof OidcAuthError) && !(error instanceof TokenRejectedError)) {
      console.info('[oidc-account] response rejected', { path, stage })
      throw new OidcAuthError('protocol')
    }
    throw error
  } finally {
    await reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
  }
}
