import { ToastProvider, useToast } from '@rific/toaster'
import { ACHIEVEMENT_TIER_COLORS, type AchievementTier } from '@tastic/achievements'
import { act, renderHook } from '@testing-library/react-native'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { ReactNode } from 'react'

import { SEAT_TOAST_STACKS, unlockCaption, unlockToasts, useUnlockToasts } from '@/hooks/useUnlockToasts'
import type { Player } from '@/types'

// Every unlock is a toast named for the profile: Vs CPU's on the app's main Toaster, 2 Player's on a Toaster per seat in that seat's half
// of the screen, turned to face it (SeatToasters), so none is listed on the Game Over card.

const achievement = (id: string, tier: AchievementTier = 'bronze') => ({ id, icon: `icon-${id}`, tier, title: `Title ${id}` })
const SEATS: readonly Player[] = [1, 2]

describe('unlockCaption', () => {
  it("names a profile's unlock and leaves a guest's plain", () => {
    expect(unlockCaption('Alice')).toBe('Alice unlocked')
    expect(unlockCaption(null)).toBe('Achievement unlocked')
    expect(unlockCaption(undefined)).toBe('Achievement unlocked')
  })
})

describe('unlockToasts', () => {
  it('makes one toast per unlock, seat by seat, in its tier color with its own icon', () => {
    const toasts = unlockToasts({ 1: [achievement('a', 'gold')], 2: [achievement('b', 'silver'), achievement('c')] }, SEATS, { 1: 'Alice' })
    expect(toasts).toEqual([
      { caption: 'Alice unlocked', color: ACHIEVEMENT_TIER_COLORS.gold, icon: 'icon-a', title: 'Title a' },
      { caption: 'Achievement unlocked', color: ACHIEVEMENT_TIER_COLORS.silver, icon: 'icon-b', title: 'Title b' },
      { caption: 'Achievement unlocked', color: ACHIEVEMENT_TIER_COLORS.bronze, icon: 'icon-c', title: 'Title c' }
    ])
  })

  it('tells two guest seats about the same device-wide unlock once', () => {
    const shared = achievement('first_draw')
    expect(unlockToasts({ 1: [shared], 2: [shared] }, SEATS, {})).toHaveLength(1)
  })

  it('tells each profile about an unlock they both earned', () => {
    const shared = achievement('first_draw')
    expect(unlockToasts({ 1: [shared], 2: [shared] }, SEATS, { 1: 'Alice', 2: 'Bob' }).map((toast) => toast.caption)).toEqual(['Alice unlocked', 'Bob unlocked'])
  })

  it("sends each seat's unlocks to its stack, and tells two guest seats each on their own", () => {
    const shared = achievement('first_draw')
    expect(unlockToasts({ 1: [shared], 2: [shared] }, SEATS, {}, SEAT_TOAST_STACKS).map((toast) => toast.stack)).toEqual(['seat-1', 'seat-2'])
  })

  it('tells two guest seats once on one stack', () => {
    const shared = achievement('first_draw')
    expect(unlockToasts({ 1: [shared], 2: [shared] }, SEATS, {}, { 1: 'seat-1', 2: 'seat-1' })).toHaveLength(1)
  })

  it('leaves out a seat that is not playing', () => {
    expect(unlockToasts({ 1: [achievement('a')], 2: [achievement('b')] }, [1] as Player[], {})).toHaveLength(1)
  })
})

describe('useUnlockToasts', () => {
  it('shows each unlock as a success toast with its caption, tier color and icon', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>
    const { result } = await renderHook(() => ({ show: useUnlockToasts(), toaster: useToast() }), { wrapper })
    await act(async () => result.current.show({ 1: [achievement('a', 'gold')], 2: [achievement('b')] }, SEATS, { 2: 'Bob' }))
    expect(result.current.toaster.toasts.map(({ caption, color, icon, level, title }) => ({ caption, color, icon, level, title }))).toEqual([
      { caption: 'Achievement unlocked', color: ACHIEVEMENT_TIER_COLORS.gold, icon: 'icon-a', level: 'success', title: 'Title a' },
      { caption: 'Bob unlocked', color: ACHIEVEMENT_TIER_COLORS.bronze, icon: 'icon-b', level: 'success', title: 'Title b' }
    ])
  })

  it("sends a seat's toasts to its stack", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>
    const { result } = await renderHook(() => ({ show: useUnlockToasts(), toaster: useToast() }), { wrapper })
    await act(async () => result.current.show({ 1: [achievement('a')], 2: [achievement('b')] }, SEATS, {}, SEAT_TOAST_STACKS))
    expect(result.current.toaster.toasts.map(({ stack, title }) => ({ stack, title }))).toEqual([
      { stack: 'seat-1', title: 'Title a' },
      { stack: 'seat-2', title: 'Title b' }
    ])
  })

  it("leaves a toast with no stack on the app's main Toaster", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>
    const { result } = await renderHook(() => ({ show: useUnlockToasts(), toaster: useToast() }), { wrapper })
    await act(async () => result.current.show({ 1: [achievement('a')] }, SEATS, {}))
    expect(result.current.toaster.toasts.map((toast) => toast.stack)).toEqual([null])
  })

  it('shows nothing for a round with no unlocks', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>
    const { result } = await renderHook(() => ({ show: useUnlockToasts(), toaster: useToast() }), { wrapper })
    await act(async () => result.current.show({}, SEATS, {}))
    expect(result.current.toaster.toasts).toEqual([])
  })
})

describe('the result cards', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === '__tests__' || name === '__mocks__' ? [] : sourceFiles(path)
      return /\.tsx?$/.test(name) ? [path] : []
    })

  // An unlock list (hud's AchievementUnlockList) or a seat's one-line "<title> unlocked!" badge.
  it('list no unlocks: every unlock is a toast', () => {
    const srcDir = __dirname.slice(0, __dirname.lastIndexOf('__tests__'))
    expect(sourceFiles(srcDir).filter((path) => /AchievementUnlockList|unlocked!/.test(readFileSync(path, 'utf8')))).toEqual([])
  })
})
