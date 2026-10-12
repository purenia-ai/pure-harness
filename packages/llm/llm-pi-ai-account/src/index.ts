/**
 * pi-ai-backed LLM routes authenticated by the deployment's account service
 * instead of a stored API key. Every request resolves a fresh account token
 * through `deepseekAccount.resolveToken`, so refresh rotation, expiry, and
 * sign-out propagate per request without any credential record of this
 * plugin's own. Use it for gateway routes whose wire protocol is not the
 * Anthropic Messages dialect the account's native route speaks.
 *
 * ```yaml
 * - id: llm-pi-ai-account
 *   name: '@deepseek-ai/dsh-llm-pi-ai-account'
 *   config:
 *     providers:
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         models:
 *           - id: acme-large
 * ```
 *
 * @module @deepseek-ai/dsh-llm-pi-ai-account
 */
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import { isVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import Schema from '@deepseek-ai/schemastery'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { PiAiAdapter, supportedProtocols } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/src/config.ts'
import type { Options, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai/src/config.ts'
import { authContextFrom, credentialStoreFrom } from '@deepseek-ai/dsh-llm-pi-ai/src/auth.ts'

export const name = 'llm-pi-ai-account'
export const inject = ['llm']

/**
 * Deployment-owned route table. The shape is the generic pi-ai plugin's
 * `providers` dict restricted to the knobs a static, account-authenticated
 * route needs; credential references (`apiKeyEnv`) are deliberately absent —
 * authentication here always comes from the account service.
 */
export interface Config {
  /**
   * Account-authenticated pi-ai provider routes, keyed by provider. Each
   * route must name its own `baseURL`: the account service validates the
   * request origin before handing out a token.
   */
  providers: Volatile<Record<string, PiAiProviderProfile>>
}

const modelProfile = Schema.object({
  id: Schema.string().required(),
  name: Schema.string(),
  contextWindow: Schema.number().step(1).min(1),
  maxTokens: Schema.number().step(1).min(1),
  input: Schema.array(Schema.union(['text', 'image'] as const)),
})

const profile = Schema.object({
  displayName: Schema.string(),
  api: Schema.union(supportedProtocols() as [string, ...string[]]),
  baseURL: Schema.string(),
  models: Schema.array(modelProfile),
  defaultContextWindow: Schema.number().step(1).min(1),
  defaultMaxTokens: Schema.number().step(1).min(1),
  defaultInput: Schema.array(Schema.union(['text', 'image'] as const)).default(['text']),
  headers: Schema.dict(Schema.string()),
  timeoutMs: Schema.natural(),
  streamIdleTimeoutMs: Schema.number().min(Number.MIN_VALUE),
})

/** Runtime schema for {@link Config}. */
export const Config = Schema.object({
  providers: Schema.dict(profile).default({}).volatile(),
})

/** Register the configured provider routes over one account-authenticated pi-ai adapter. */
export function apply(ctx: Context, config: Config): void {
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  // Resolved profiles memoized by raw snapshot identity, mirroring the generic
  // llm-pi-ai plugin: the adapter reads them once per operation.
  let lastRaw: Record<string, unknown> | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = isVolatile(config.providers) ? config.providers.get() : config.providers
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles(structuredClone(raw ?? {}) as Options['providers'], 'deferred')
    lastRaw = raw as Record<string, unknown>
    memoized = next
    return next
  }

  const resolveApiKey = async (provider: string, profile: ResolvedPiAiProviderProfile): Promise<string> => {
    if (profile.baseURL === undefined) {
      throw new LlmError(`llm-pi-ai-account: route "${provider}" must name a baseURL; account authentication validates its origin`, 'INVALID_CONFIG')
    }
    const account = ctx.get('deepseekAccount')
    const token = await account?.resolveToken(new URL(profile.baseURL).origin)
    if (token === undefined) {
      throw new LlmError('Sign in to use the account-authenticated provider. The request destination must allow account authentication.', 'ACCOUNT_SIGN_IN_REQUIRED')
    }
    return token
  }

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
  })

  const routes = [...profiles().keys()]
  if (routes.length === 0) return
  // Static composition: the route set lives in the deployment patch, so one
  // registration at apply covers it; there is no settings document to watch.
  ctx.llm.registerAdapter(routes, adapter)
  ctx.llm.registerConfigurableProviders(routes.map(provider => ({
    provider,
    displayName: profiles().get(provider)?.displayName ?? provider,
    settingsNs,
    settingsPath: ['providers', provider],
  })))
}
