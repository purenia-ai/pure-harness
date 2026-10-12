/** The account route sends the resolved token under the configured authentication scheme. */
import { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import { afterEach, expect, it, vi } from 'vitest'
import * as Account from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

it.each([
  { authScheme: undefined, header: 'x-dsh-auth-token', expected: 'account-token', absent: 'authorization' },
  { authScheme: 'bearer', header: 'authorization', expected: 'Bearer account-token', absent: 'x-dsh-auth-token' },
] as const)('sends the account token as $header with authScheme "$authScheme"', async ({ authScheme, header, expected, absent }) => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  ctx.provide('deepseekAccount', {
    resolveToken: async (_baseURL: string): Promise<string | undefined> => 'account-token',
    rejectToken: async (_token: string): Promise<void> => {},
  } as DeepSeekAccount)
  await ctx.plugin(Account, authScheme === undefined ? {} : { authScheme })
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }))
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({ provider: 'deepseek-account', model: 'deepseek-flash', messages: [] })) assembler.push(chunk)
  expect(assembler.finish).toMatchObject({ kind: 'error' })
  const init = fetchSpy.mock.calls[0]?.[1]
  const headers = new Headers(init?.headers)
  expect(headers.get(header)).toBe(expected)
  expect(headers.get(absent)).toBeNull()
})
