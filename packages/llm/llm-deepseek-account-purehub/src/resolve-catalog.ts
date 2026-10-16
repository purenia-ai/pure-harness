/**
 * The fork's account catalog: gateway availability, this build's model
 * knowledge, and the deployment's dialect map.
 *
 * The gateway's listing decides which ids exist. Every listed id is served
 * through Anthropic Messages except one another provider route owns by prefix —
 * the PureHub gateway marks no `api_capabilities`, so the listing itself cannot
 * say which dialect an upstream speaks. A declaration or a mark supplies the
 * capabilities a thin listing entry leaves out.
 */
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel } from '@deepseek-ai/dsh-llm-deepseek'
import type { ModelOverride } from '@deepseek-ai/dsh-llm-deepseek-account/src/config.ts'
import type { ListedFacts, ListingEntry } from '@deepseek-ai/dsh-llm-deepseek-account/src/listing.ts'

/** Why this build refuses one listed model before network I/O. */
export type CatalogRefusal = { readonly kind: 'other-route' }

/** Inputs of one catalog resolution. */
export interface AccountCatalogInput {
  /** Entries of the last successful listing, or `undefined` before one succeeds. */
  readonly listing: readonly ListingEntry[] | undefined
  /** Declared models whose capabilities the listing leaves out, validated. */
  readonly declared: readonly DeepSeekCatalogModel[]
  /** Id prefixes another provider route owns; an empty prefix matches nothing. */
  readonly otherRoutePrefixes: readonly string[]
  /** Validated models this build supports, carrying its client-side knowledge. */
  readonly supported: readonly DeepSeekCatalogModel[]
  /** Overrides by model id, holding only the fields each one declares. */
  readonly overrides: Readonly<Record<string, ModelOverride>>
  /** Route output cap that a listed output capability bounds. */
  readonly routeMaxTokens: number
}

/** One resolved account catalog. */
export interface AccountCatalog {
  /** Selectable models in listing order, or the declared or this build's models when no listing succeeded. */
  readonly offered: readonly DeepSeekCatalogModel[]
  /** Entries request resolution consults: offered models, then supported models the listing does not offer. */
  readonly resolution: readonly DeepSeekCatalogModel[]
  /** Listed models owned by another provider route, by id. */
  readonly refusals: ReadonlyMap<string, CatalogRefusal>
  /** Declared ids a loaded listing does not carry. */
  readonly problems: readonly string[]
  /** Configuration diagnostics for `modelOverrides`. */
  readonly overrideErrors: readonly string[]
}

/** Whether one listed id belongs to another provider route. */
function underOtherRoute(id: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => prefix.length > 0 && id.startsWith(prefix))
}

/** Replace fields of an entry; a text-only result drops the image limits it inherited. */
function layered(model: DeepSeekCatalogModel, layer: ModelOverride): DeepSeekCatalogModel {
  const merged: DeepSeekCatalogModel = { ...model, ...layer }
  if (merged.inputModalities?.includes('image') !== true) {
    if (layer.imagePixelBudget === undefined) delete merged.imagePixelBudget
    if (layer.imageMaxBytes === undefined) delete merged.imageMaxBytes
  }
  return merged
}

/** The fields a declaration actually states; a parsed config carries unset fields as `undefined`. */
function declaredLayer(model: DeepSeekCatalogModel): ModelOverride {
  const layer: ModelOverride = {}
  for (const [key, value] of Object.entries(model)) {
    if (key === 'id') continue
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue
    Reflect.set(layer, key, value)
  }
  return layer
}

/** Layer one usable listing entry over this build's entry for the same id. */
function listed(base: DeepSeekCatalogModel, entry: ListingEntry, facts: ListedFacts, routeMaxTokens: number): DeepSeekCatalogModel {
  const { systemPromptUpdate: _replaced, ...leadingOnly } = base
  return layered(facts.systemPromptUpdate === 'leading-only' ? leadingOnly : base, {
    ...entry.name === undefined ? {} : { name: entry.name },
    ...facts.contextWindow === undefined ? {} : { contextWindow: facts.contextWindow },
    ...facts.maxOutputTokens === undefined ? {} : { maxTokens: Math.min(routeMaxTokens, facts.maxOutputTokens) },
    ...facts.systemPromptUpdate === 'in-history' ? { systemPromptUpdate: 'in-history' as const } : {},
    inputModalities: [...facts.inputModalities],
  })
}

/** The capabilities one catalog entry states, in the listing's fact vocabulary. */
function entryFacts(model: DeepSeekCatalogModel): ListedFacts {
  return {
    inputModalities: model.inputModalities ?? ['text'],
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxOutputTokens: model.maxTokens },
    ...model.systemPromptUpdate === undefined ? {} : { systemPromptUpdate: model.systemPromptUpdate },
  }
}

/**
 * Resolve the account catalog.
 * @param input - listing, declarations, other-route prefixes, supported models, overrides, and the route cap.
 * @returns offered models, request-resolution entries, refusals, and diagnostics.
 */
export function resolveAccountCatalog(input: AccountCatalogInput): AccountCatalog {
  const supported = new Map(input.supported.map(model => [model.id, model]))
  const declared = new Map(input.declared.map(model => [model.id, declaredLayer(model)]))
  const problems: string[] = []
  const overrideErrors: string[] = []
  const withOverride = (model: DeepSeekCatalogModel): DeepSeekCatalogModel => {
    const override = input.overrides[model.id]
    if (override === undefined) return model
    const candidate = layered(model, override)
    try {
      resolveAdapterOptions({ models: [candidate] })
    } catch (error) {
      overrideErrors.push(`modelOverrides.${model.id} does not apply (${String(error)})`)
      return model
    }
    return candidate
  }
  const visible = (id: string): boolean => !underOtherRoute(id, input.otherRoutePrefixes)
  if (input.listing === undefined) {
    // Without a listing the gateway has declared no availability, so the known set stands.
    const base = (input.declared.length === 0 ? input.supported : input.declared).filter(model => visible(model.id))
    const resolution = resolveAdapterOptions({ models: base.map(withOverride) }).models
    return { offered: resolution, resolution, refusals: new Map(), problems, overrideErrors }
  }
  const offered: DeepSeekCatalogModel[] = []
  const refusals = new Map<string, CatalogRefusal>()
  for (const entry of input.listing) {
    if (!visible(entry.id)) {
      refusals.set(entry.id, { kind: 'other-route' })
      continue
    }
    // Declared fields layer over this build's knowledge; the listing's own facts come last.
    const base = layered(supported.get(entry.id) ?? { id: entry.id }, declared.get(entry.id) ?? {})
    const facts = entry.capabilities.usable ? entry.capabilities.facts : entryFacts(base)
    offered.push(withOverride(listed(base, entry, facts, input.routeMaxTokens)))
  }
  const listedIds = new Set(input.listing.map(entry => entry.id))
  for (const model of input.declared) {
    if (!listedIds.has(model.id)) problems.push(`declared model "${model.id}" is not in the account listing`)
  }
  const offeredIds = new Set(offered.map(model => model.id))
  for (const id of Object.keys(input.overrides)) {
    if (!listedIds.has(id) && !supported.has(id) && !declared.has(id)) {
      overrideErrors.push(`modelOverrides names "${id}", which neither the account listing, the declared models, nor the built-in catalog describes`)
    }
  }
  const resolution = resolveAdapterOptions({
    models: [...offered, ...input.supported.filter(model => !offeredIds.has(model.id)).map(withOverride)],
  }).models
  return { offered: resolution.slice(0, offered.length), resolution, refusals, problems, overrideErrors }
}
