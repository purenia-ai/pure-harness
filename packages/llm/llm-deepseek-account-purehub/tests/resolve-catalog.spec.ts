/** Fork catalog resolution: the listing decides availability, the prefix map decides the owning route. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_REQUEST_IMAGE_MAX_BYTES, parseModelListing, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel, ModelOverride } from '@deepseek-ai/dsh-llm-deepseek'
import { Config, plainOptions } from '../src/config.ts'
import { resolveAccountCatalog } from '../src/resolve-catalog.ts'

const FLASH = {
  id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1_048_576, max_output_tokens: 393_216,
  input_modalities: ['text', 'image'], output_modalities: ['text'],
  api_capabilities: { anthropic_messages: { system_prompt_update: 'in-history' } },
}
/** Declared models exactly as the plugin's own config schema parses them. */
const declaredOf = (rows: DeepSeekCatalogModel[]) =>
  resolveAdapterOptions({ models: plainOptions(Config({ models: rows })).models ?? [] }).models
const resolve = (
  rows: object[] | undefined,
  declared: DeepSeekCatalogModel[] = [],
  overrides: Record<string, ModelOverride> = {},
  otherRoutePrefixes: readonly string[] = ['gpt'],
) => resolveAccountCatalog({
  listing: rows === undefined ? undefined : parseModelListing({ data: rows }).entries,
  declared: declaredOf(declared),
  otherRoutePrefixes,
  supported: resolveAdapterOptions({}).models,
  overrides,
  routeMaxTokens: 256_000,
})

describe('without a listing', () => {
  it('offers the bundled catalog when nothing is declared', () => {
    const catalog = resolve(undefined)
    expect(catalog.offered.map(model => model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    expect(catalog.refusals.size).toBe(0)
  })

  it('offers the declared set as the floor', () => {
    const catalog = resolve(undefined, [{ id: 'k3', name: 'k3' }])
    expect(catalog.offered).toEqual([{ id: 'k3', name: 'k3', inputModalities: ['text'] }])
  })

  it('hides a declared id another route owns', () => {
    expect(resolve(undefined, [{ id: 'gpt-6-sol' }]).offered).toEqual([])
  })
})

describe('with a listing', () => {
  it('offers an OpenAI-shaped entry the gateway describes with nothing but an id', () => {
    const catalog = resolve([{ id: 'kimi-k3-260716', object: 'model', created: 1, owned_by: 'long-ai-gw' }])
    expect(catalog.offered).toEqual([{ id: 'kimi-k3-260716', inputModalities: ['text'] }])
    expect(catalog.refusals.size).toBe(0)
    expect(catalog.problems).toEqual([])
  })

  it('takes the capabilities a marked entry states', () => {
    const catalog = resolve([FLASH])
    expect(catalog.offered[0]).toMatchObject({
      id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1_048_576, maxTokens: 256_000,
      inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history', toolUpdate: 'addition-only',
      imageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    })
  })

  it('hides an id another provider route owns and refuses it before network I/O', () => {
    const catalog = resolve([{ id: 'gpt-5.5' }, { id: 'deepseek-flash' }])
    expect(catalog.offered.map(model => model.id)).toEqual(['deepseek-flash'])
    expect(catalog.refusals.get('gpt-5.5')).toEqual({ kind: 'other-route' })
  })

  it('applies the configured prefixes instead of a built-in list', () => {
    const catalog = resolve([{ id: 'seedream-4-0' }, { id: 'glm-5.3' }], [], {}, ['seedream'])
    expect(catalog.offered.map(model => model.id)).toEqual(['glm-5.3'])
    expect([...catalog.refusals.keys()]).toEqual(['seedream-4-0'])
  })

  it('keeps listing order across marked, declared, and bare entries', () => {
    const catalog = resolve([FLASH, { id: 'k3' }, { id: 'gpt-5.5' }], [{ id: 'k3', name: 'k3' }])
    expect(catalog.offered.map(model => model.id)).toEqual(['deepseek-flash', 'k3'])
  })

  it('layers a declaration over this build\'s knowledge for the same id', () => {
    const catalog = resolve([{ id: 'deepseek-flash' }], [{ id: 'deepseek-flash', name: 'deepseek-flash', inputModalities: ['text', 'image'] }])
    expect(catalog.offered[0]).toMatchObject({ id: 'deepseek-flash', name: 'deepseek-flash', inputModalities: ['text', 'image'] })
  })

  it('keeps this build\'s fields a declaration leaves unset', () => {
    const catalog = resolve([{ id: 'deepseek-flash' }], [{ id: 'deepseek-flash' }])
    expect(catalog.offered[0]).toMatchObject({
      id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1_048_576,
      systemPromptUpdate: 'in-history', toolUpdate: 'addition-only',
    })
  })

  it('hides a declared id a loaded listing does not carry and reports it', () => {
    const catalog = resolve([{ id: 'k3' }], [{ id: 'k3' }, { id: 'glm-5.3' }])
    expect(catalog.offered.map(model => model.id)).toEqual(['k3'])
    expect(catalog.problems).toEqual(['declared model "glm-5.3" is not in the account listing'])
  })

  it('applies an override to an offered model and reports a stale one', () => {
    const catalog = resolve([{ id: 'k3' }], [{ id: 'k3' }], { k3: { contextWindow: 9 }, retired: { contextWindow: 1 } })
    expect(catalog.offered[0]?.contextWindow).toBe(9)
    expect(catalog.overrideErrors).toEqual([
      'modelOverrides names "retired", which neither the account listing, the declared models, nor the built-in catalog describes',
    ])
  })
})
