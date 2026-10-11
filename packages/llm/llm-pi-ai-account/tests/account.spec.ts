import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAiAccount from '@deepseek-ai/dsh-llm-pi-ai-account'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import { assemble } from './assemble.ts'

afterEach(async () => {
  vi.useRealTimers()
  await closeMockServers()
})

/** Stand-in account service: hands out a fixed token and records the origin asked for. */
function provideAccount(ctx: Context, token: string | undefined, origins: string[]): void {
  ctx.provide('deepseekAccount', {
    resolveToken: (origin: string): Promise<string | undefined> => {
      origins.push(origin)
      return Promise.resolve(token)
    },
  } as never)
}

async function harness(baseURL: string, token: string | undefined, origins: string[] = []): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  provideAccount(ctx, token, origins)
  await ctx.plugin(LlmPiAiAccount, {
    providers: {
      'acme-gateway': {
        displayName: 'Acme Gateway',
        api: 'openai-completions',
        baseURL,
        models: [{ id: 'acme-large', name: 'Acme Large' }],
      },
    },
  })
  return ctx
}

const prompt = [createUserMessage({
  content: [{ type: 'text', text: 'hi' }],
  source: { kind: 'model', provider: 'acme-gateway', model: 'acme-large' },
})]

describe('llm-pi-ai-account', () => {
  it('authenticates every stream with the account token resolved for the route origin', async () => {
    const server = await mockServer([{ events: textEvents }])
    const origins: string[] = []
    const ctx = await harness(server.url, 'sso-token-1', origins)

    const result = await assemble(ctx, { provider: 'acme-gateway', model: 'acme-large', messages: prompt })

    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.paths).toEqual(['/chat/completions'])
    expect(server.headers[0]?.['authorization']).toBe('Bearer sso-token-1')
    expect(origins).toEqual([new URL(server.url).origin])
  })

  it('fails with ACCOUNT_SIGN_IN_REQUIRED when the account resolves no token', async () => {
    const server = await mockServer([])
    const ctx = await harness(server.url, undefined)

    // The credential resolves inside the stream operation, so the failure
    // arrives as the stream's terminal error rather than a rejected call.
    const result = await assemble(ctx, { provider: 'acme-gateway', model: 'acme-large', messages: prompt })
    expect(result.finish.kind).toBe('error')
    expect(JSON.stringify(result.finish)).toContain('ACCOUNT_SIGN_IN_REQUIRED')
    expect(server.paths).toEqual([])
  })

  it('requires an explicit baseURL so the account origin check cannot be bypassed', async () => {
    const server = await mockServer([])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    provideAccount(ctx, 'sso-token-1', [])
    await ctx.plugin(LlmPiAiAccount, {
      providers: {
        'acme-gateway': { api: 'openai-completions', baseURL: server.url, models: [{ id: 'acme-large' }] },
      },
    })
    const models = await ctx.llm.listModels('acme-gateway')
    expect(models.map(model => model.id)).toEqual(['acme-large'])
  })
})
