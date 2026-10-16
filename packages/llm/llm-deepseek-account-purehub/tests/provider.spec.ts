/** The fork's account route lists every gateway model another route does not own, through Anthropic Messages. */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { DeepSeekCatalogModel } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import * as Account from '../src/index.ts'

/** The gateway's real listing: one OpenAI-shaped list that marks no dialect. */
const LISTING = [
  { id: 'gpt-5.5', object: 'model', created: 1, owned_by: 'long-ai-gw' },
  { id: 'deepseek-flash', object: 'model', created: 1, owned_by: 'long-ai-gw' },
  { id: 'kimi-k3-260716', object: 'model', created: 1, owned_by: 'long-ai-gw' },
  { id: 'glm-5.3-flash', object: 'model', created: 1, owned_by: 'long-ai-gw' },
  { id: 'gpt-image-2', object: 'model', created: 1, owned_by: 'long-ai-gw' },
  { id: 'qwen3.8-flash', object: 'model', created: 1, owned_by: 'long-ai-gw' },
]
/** Capabilities the bare listing entries leave out. */
const DECLARED: DeepSeekCatalogModel[] = [
  { id: 'deepseek-flash', name: 'deepseek-flash', inputModalities: ['text'], systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' },
  { id: 'glm-5.3-flash', name: 'glm-5.3-flash', inputModalities: ['text', 'image'] },
  // Declared but absent from the listing: hidden, and reported once per listing.
  { id: 'claude-sonnet-5', name: 'claude-sonnet-5' },
]

const contexts: Context[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  vi.restoreAllMocks()
})

/** Loopback gateway: `/v1/models` answers the listing; any other request fails through its status. */
async function gateway(reply: (request: IncomingMessage, response: ServerResponse) => void) {
  const paths: string[] = []
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    if (request.method === 'GET' && request.url === '/v1/models') reply(request, response)
    else response.writeHead(500).end('unexpected request')
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  const origin = `http://127.0.0.1:${address.port}`
  return { origin, paths, baseURL: `${origin}/v1` }
}
const json = (body: unknown) => (_request: IncomingMessage, response: ServerResponse) => {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function host(origin: string, token: () => string | undefined = () => 'fixture-account-token') {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  ctx.provide('deepseekAccount', {
    resolveToken: (url: string) => Promise.resolve(new URL(url).origin === origin ? token() : undefined),
  } as DeepSeekAccount)
  return ctx
}
const route = (over: Record<string, unknown> = {}) => ({
  baseURL: 'http://127.0.0.1:1/v1', authScheme: 'bearer' as const, maxTokens: 131_072, otherRoutePrefixes: ['gpt'], ...over,
})

it('lists every gateway model another route does not own, through Messages', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const server = await gateway(json({ object: 'list', data: LISTING }))
  const ctx = await host(server.origin)
  await ctx.plugin(Account, route({ baseURL: server.baseURL, models: DECLARED }))
  expect((await ctx.llm.listModels('deepseek-account')).map(row => [row.id, row.name, row.inputModalities])).toEqual([
    ['deepseek-flash', 'deepseek-flash', ['text']],
    ['kimi-k3-260716', 'kimi-k3-260716', ['text']],
    ['glm-5.3-flash', 'glm-5.3-flash', ['text', 'image']],
    ['qwen3.8-flash', 'qwen3.8-flash', ['text']],
  ])
  await expect(ctx.llm.prepareCall({ provider: 'deepseek-account', model: 'gpt-5.5' }))
    .rejects.toMatchObject({ code: 'MODEL_UNSUPPORTED', message: expect.stringMatching(/belongs to another provider route/) as string })
  await expect(ctx.llm.prepareCall({ provider: 'deepseek-account', model: 'unlisted-pass-through' })).resolves.toBeDefined()
  expect(server.paths).toEqual(['/v1/models'])
  expect(info).toHaveBeenCalledExactlyOnceWith('[llm-deepseek-account-purehub]', expect.stringContaining('loaded 6 model(s), skipped 0 row(s)') as string)
  expect(warn).toHaveBeenCalledExactlyOnceWith('[llm-deepseek-account-purehub]', 'declared model "claude-sonnet-5" is not in the account listing')
})

it('honours the configured other-route prefixes', async () => {
  const server = await gateway(json({ object: 'list', data: LISTING }))
  const ctx = await host(server.origin)
  await ctx.plugin(Account, route({ baseURL: server.baseURL, otherRoutePrefixes: ['gpt', 'qwen', 'kimi'] }))
  expect((await ctx.llm.listModels('deepseek-account')).map(row => row.id)).toEqual(['deepseek-flash', 'glm-5.3-flash'])
})

it('offers the declared set while the listing is unavailable', async () => {
  const server = await gateway((_request, response) => { response.writeHead(500).end('down') })
  const ctx = await host(server.origin)
  await ctx.plugin(Account, route({ baseURL: server.baseURL, models: [{ id: 'k3', name: 'k3' }] }))
  expect((await ctx.llm.listModels('deepseek-account')).map(row => row.id)).toEqual(['k3'])
})

it('returns an empty catalog while signed out and rescopes on the next token', async () => {
  let token: string | undefined = 'first-account'
  const server = await gateway(json({ object: 'list', data: LISTING }))
  const ctx = await host(server.origin, () => token)
  await ctx.plugin(Account, route({ baseURL: server.baseURL, models: DECLARED }))
  expect(await ctx.llm.listModels('deepseek-account')).toHaveLength(4)
  expect(server.paths).toEqual(['/v1/models'])
  token = undefined
  expect(await ctx.llm.listModels('deepseek-account')).toEqual([])
  token = 'second-account'
  expect(await ctx.llm.listModels('deepseek-account')).toHaveLength(4)
  expect(server.paths).toEqual(['/v1/models', '/v1/models'])
})

it('registers the configurable provider directory entry for the account route', async () => {
  const server = await gateway(json({ object: 'list', data: LISTING }))
  const ctx = await host(server.origin)
  await ctx.plugin(Account, route({ baseURL: server.baseURL, models: DECLARED }))
  expect(ctx.llm.listConfigurableProviders().map(row => [row.provider, row.displayName, row.settingsNs])).toEqual([
    ['deepseek-account', 'PureHub', 'llm-deepseek-account-purehub'],
  ])
  expect(ctx.llm.listProviders().map(row => [row.id, row.name])).toEqual([['deepseek-account', 'PureHub']])
})

it('rejects an invalid declared model at load', async () => {
  const ctx = await host('http://127.0.0.1:1')
  await expect(ctx.plugin(Account, route({ models: [{ id: 'k3', contextWindow: 0 }] }))).rejects.toThrow()
  expect(ctx.llm.listProviders()).toEqual([])
})
