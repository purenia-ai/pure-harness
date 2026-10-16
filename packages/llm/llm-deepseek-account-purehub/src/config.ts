/**
 * Fork configuration: the upstream account settings plus the deployment's
 * dialect map for the gateway's model listing.
 *
 * The gateway this fork targets serves one OpenAI-shaped `GET /v1/models`
 * listing for every dialect and marks no entry with `api_capabilities`, so a
 * listed id says nothing about the wire protocol its upstream speaks. The
 * listing decides availability, and the deployment maps ids to dialects:
 * `otherRoutePrefixes` names the ids another provider route owns, which this
 * Messages route hides, and `models` states the capabilities a thin listing
 * entry leaves out.
 *
 * @module dsh-llm-deepseek-account-purehub/config
 */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { catalogModelFields, deepSeekConfigFields, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel, Options as ProtocolOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { Config as ProtocolConfig } from '@deepseek-ai/dsh-llm-deepseek'
import { DEFAULT_MODELS_MAX_AGE_MS, DEFAULT_MODELS_TIMEOUT_MS, resolveAccountOptions } from '@deepseek-ai/dsh-llm-deepseek-account/src/config.ts'
import type { ModelOverride, ResolvedAccountOptions } from '@deepseek-ai/dsh-llm-deepseek-account/src/config.ts'

const MODEL_MODALITIES = ['text', 'image'] as const

/** One declared model: the wire id plus every field this route needs to serve it. */
const catalogModel: z<DeepSeekCatalogModel> = z.object({
  id: z.string().required(),
  ...catalogModelFields,
  // An omitted list reads as text-only, matching the built-in catalog's own rule.
  inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(['text']),
})

/** Per-model override fields, with the same requiredness the upstream package applies. */
const modelOverride: z<ModelOverride> = z.object({
  ...catalogModelFields,
  // No default, unlike a models entry: an absent list materializes as [], which reads as inherited.
  inputModalities: z.array(z.union(MODEL_MODALITIES)),
})

/** Account route configuration; authentication comes exclusively from the account service. */
export interface Config extends Omit<ProtocolConfig, 'models'> {
  /** Header scheme used when sending the account token. */
  authScheme: Volatile<'x-dsh-auth-token' | 'bearer' | undefined>
  /** Deadline of one listing request, which also bounds a first-use wait (default five seconds). */
  modelsTimeoutMs: Volatile<number>
  /** Listing age after which the next access refreshes it in the background (default ten minutes). */
  modelsMaxAgeMs: Volatile<number>
  /** Field overrides by model id, layered over the account listing and the built-in catalog. */
  modelOverrides: Volatile<Record<string, ModelOverride>>
  /**
   * Ids this route serves that the listing describes thinly, in listing order.
   * A listed id is offered unless another route owns it; a declaration supplies
   * the name, capacities, modalities, and Messages update modes the listing
   * omits, layers over this build's knowledge for the same id, and is the
   * offered floor before any listing loads. A declared id absent from a loaded
   * listing stays hidden, because the gateway decides availability.
   */
  models: Volatile<DeepSeekCatalogModel[]>
  /**
   * Id prefixes owned by another provider route, matched against the listing.
   * A listed id under one stays hidden here and is reported when requested,
   * because this Messages route cannot carry its dialect. Defaults to `gpt`.
   */
  otherRoutePrefixes: Volatile<readonly string[]>
}

const { models: _protocolCatalog, ...protocolFields } = deepSeekConfigFields

/** Runtime schema for {@link Config}. */
export const Config = z.object({
  ...protocolFields,
  authScheme: z.union(['x-dsh-auth-token', 'bearer']).volatile(),
  modelsTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_MODELS_TIMEOUT_MS).volatile(),
  modelsMaxAgeMs: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MODELS_MAX_AGE_MS).volatile(),
  modelOverrides: z.dict(modelOverride).default({}).volatile(),
  models: z.array(catalogModel).default([]).volatile(),
  otherRoutePrefixes: z.array(z.string()).default(['gpt']).volatile(),
})

/** Plain account options accepted by {@link resolvePurehubOptions}. */
export type PurehubOptions = Omit<ProtocolOptions, 'models'> & {
  authScheme?: 'x-dsh-auth-token' | 'bearer'
  modelsTimeoutMs?: number
  modelsMaxAgeMs?: number
  modelOverrides?: Record<string, ModelOverride>
  models?: DeepSeekCatalogModel[]
  otherRoutePrefixes?: readonly string[]
}

/** One validated configuration generation, including the deployment's dialect map. */
export interface ResolvedPurehubOptions extends ResolvedAccountOptions {
  /** Declared models, validated and normalized; empty when the deployment declares none. */
  readonly models: readonly DeepSeekCatalogModel[]
  /** Id prefixes another provider route owns, with empty entries dropped. */
  readonly otherRoutePrefixes: readonly string[]
}

/**
 * Read the current value behind every reference of a validated Config.
 * @param config - parsed plugin Config.
 * @returns plain options for {@link resolvePurehubOptions}.
 */
export function plainOptions(config: Config): PurehubOptions {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, isVolatile(value) ? value.get() : value]))
}

/**
 * Resolve one configuration generation. The declared models are validated with
 * the shared catalog resolver; every other field resolves through the upstream
 * account route, which sees neither `models` nor `otherRoutePrefixes`.
 * @param options - plain account options.
 * @param environment - this run's environment layers, or `undefined` outside the product CLI.
 * @returns Messages settings, listing settings, overrides, declarations, and prefixes.
 */
export function resolvePurehubOptions(options: PurehubOptions, environment?: LaunchEnvironmentSnapshot): ResolvedPurehubOptions {
  const { models = [], otherRoutePrefixes = ['gpt'], ...rest } = options
  const resolved: ResolvedAccountOptions = resolveAccountOptions(rest, environment)
  return {
    ...resolved,
    models: models.length === 0 ? [] : resolveAdapterOptions({ models }).models,
    otherRoutePrefixes: otherRoutePrefixes.filter(prefix => prefix.length > 0),
  }
}
