// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { BrandMark, BrandName, HeroBrandMark } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries([...HOLES, HERO_HOLE].map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('PureHub browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('leaves every slot empty outside the official build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of [...HOLES, HERO_HOLE] as const) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of [...HOLES, HERO_HOLE] as const) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of [...HOLES, HERO_HOLE] as const) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of [...HOLES, HERO_HOLE] as const) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of [...HOLES, HERO_HOLE] as const) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of [...HOLES, HERO_HOLE] as const) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of [...HOLES, HERO_HOLE] as const) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('takes over the conversation hero mark in official builds', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(HERO_HOLE)).toHaveLength(1)
  })

  it('renders the name text and scales the mark with the requested size', () => {
    const name = render(<BrandName />)
    expect(name.container.textContent).toBe('PureHub')
    name.unmount()

    const mark = render(<BrandMark size={34} />)
    const markNode = mark.container.firstElementChild
    expect(markNode?.tagName).toBe('SPAN')
    expect(markNode?.getAttribute('aria-hidden')).toBe('true')
    expect((markNode as HTMLElement | null)?.style.maskImage).toContain('data:image/png;base64,')
    expect((markNode as HTMLElement | null)?.style.height).toBe('34px')
    mark.rerender(<BrandMark size={24} />)
    expect((mark.container.firstElementChild as HTMLElement | null)?.style.height).toBe('24px')

    const hero = render(<HeroBrandMark size={34} className="hero" />)
    expect(hero.container.firstElementChild?.className).toBe('hero')
    hero.unmount()
  })
})
