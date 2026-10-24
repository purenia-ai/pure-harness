/** Account-token authentication and the fork's model listing for the Anthropic Messages account route. */
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import { ACCOUNT_QUOTA_EXCEEDED_CODE, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { catalogModelInfo, ModelListingCache, registerDeepSeekProvider, requestModelListing, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekRequestAuth, ListingView, ModelListing, ResolvedDeepSeekOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { Config, plainOptions, resolvePurehubOptions } from './config.ts'
import { resolveAccountCatalog } from './resolve-catalog.ts'
import type { AccountCatalog, CatalogRefusal } from './resolve-catalog.ts'

export { Config } from './config.ts'
export const name = 'llm-deepseek-account-purehub'
export const inject = ['llm']

const PROVIDER = 'deepseek-account'
/** Header carrying the account token on Messages, Files, and model-listing requests. */
const TOKEN_HEADER = 'x-dsh-auth-token'
/** Console tag of listing diagnostics; product profiles mount no console exporter for `ctx.logger`. */
const LOG_TAG = '[llm-deepseek-account-purehub]'

/** Connection facts of one account operation: protocol settings plus the catalog resolved with them. */
interface AccountConnection extends ResolvedDeepSeekOptions {
  readonly catalog: AccountCatalog
  readonly authScheme: 'x-dsh-auth-token' | 'bearer'
}

/** The listing endpoint: `/v1/models` for a `/v1` Messages base path, `/models` otherwise. */
function listingEndpoint(baseURL: string): string {
  const base = new URL(baseURL)
  return base.pathname.replace(/\/+$/u, '') === '/v1'
    ? new URL('/v1/models', base.origin).href
    : new URL('/models', base.origin).href
}

function refuse(model: string, refusal: CatalogRefusal | undefined): void {
  if (refusal === undefined) return
  throw new LlmError(`DeepSeek model "${model}" belongs to another provider route; this Messages route does not serve its dialect`, 'MODEL_UNSUPPORTED')
}

export function apply(ctx: Context, config: Config): void {
  const environment = launchEnvironmentOf(ctx)
  const settings = () => {
    const resolved = resolvePurehubOptions(plainOptions(config), environment)
    // The fork's gateway serves the model listing at `/v1/models`.
    return { ...resolved, catalog: { ...resolved.catalog, url: listingEndpoint(resolved.protocol.baseURL) } }
  }
  settings()
  const supported = resolveAdapterOptions({}).models
  const account = () => ctx.get('deepseekAccount')
  const resolveAuth = async (connection: AccountConnection): Promise<DeepSeekRequestAuth> => {
    const token = await account()?.resolveToken(connection.baseURL)
    if (token === undefined) throw new LlmError('Sign in to PureHub to use the account provider. The request destination must allow account authentication.', 'ACCOUNT_SIGN_IN_REQUIRED')
    return {
      headers: connection.authScheme === 'bearer'
        ? { authorization: `Bearer ${token}` }
        : { [TOKEN_HEADER]: token },
      onRequestError: async (error) => {
        if (!(error instanceof LlmError)) return error
        if (error.code === QUOTA_EXCEEDED_CODE) {
          return new LlmError(error.message, ACCOUNT_QUOTA_EXCEEDED_CODE, { ...error.failure, cause: error })
        }
        if (error.failure.status !== 401) return error
        const rejected = new LlmError(error.message, 'ACCOUNT_TOKEN_INVALID', { ...error.failure, cause: error })
        try { await account()?.rejectToken(token) }
        catch (_credentialRemovalFailed) { /* Storage failure cannot replace the inference failure. */ }
        return rejected
      },
    }
  }
  const catalog = new ModelListingCache({
    credential: async url => account()?.resolveToken(url),
    load: (url, token, signal) => {
      const headers = settings().authScheme === 'bearer'
        ? { authorization: `Bearer ${token}` }
        : { [TOKEN_HEADER]: token }
      return requestModelListing(url, headers, signal)
    },
    now: () => Date.now(),
    info: (message) => { console.info(LOG_TAG, message) },
    warn: (message) => { console.warn(LOG_TAG, message) },
  })
  let loggedListing: ModelListing | undefined
  /** Resolve the catalog for one view, reporting a declaration the gateway no longer lists once per listing. */
  const connectionOf = (view: ListingView): AccountConnection => {
    const resolved = settings()
    const result = resolveAccountCatalog({
      listing: view.listing?.entries,
      declared: resolved.models,
      otherRoutePrefixes: resolved.otherRoutePrefixes,
      supported,
      overrides: resolved.modelOverrides,
      routeMaxTokens: resolved.protocol.maxTokens,
    })
    if (view.listing !== loggedListing) {
      loggedListing = view.listing
      for (const problem of result.problems) console.warn(LOG_TAG, problem)
    }
    return { ...resolved.protocol, models: result.resolution, catalog: result, authScheme: resolved.authScheme }
  }
  const entry = { provider: PROVIDER, displayName: 'PureHub', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [] }
  const directory = ctx.llm.registerConfigurableProviders([entry])
  let reportedError: string | undefined
  /** Publish override diagnostics on the provider directory. */
  const discovered = (view: ListingView): AccountConnection => {
    const connection = connectionOf(view)
    const error = connection.catalog.overrideErrors.length === 0 ? undefined : connection.catalog.overrideErrors.join('; ')
    if (error !== reportedError) {
      reportedError = error
      directory.replace([error === undefined ? entry : { ...entry, error }])
    }
    return connection
  }
  registerDeepSeekProvider<AccountConnection>(ctx, PROVIDER, {
    providerName: 'PureHub',
    options: () => connectionOf(catalog.current()),
    connect: async signal => connectionOf(await catalog.view(settings().catalog, signal)),
    resolveAuth,
    admit: (connection, model) => { refuse(model, connection.catalog.refusals.get(model)) },
    discoverModels: async (provider) => {
      const view = await catalog.view(settings().catalog)
      return view.authenticated ? discovered(view).catalog.offered.map(model => catalogModelInfo(provider, model)) : []
    },
  })
  ctx.effect(() => () => { catalog.dispose() }, 'llm-deepseek-account-purehub: model catalog')
}
