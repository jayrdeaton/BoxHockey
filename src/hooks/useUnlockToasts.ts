import { useToast } from '@rific/toaster'
import type { AchievementTier } from '@tastic/achievements'
import { useCallback } from 'react'

import { ACHIEVEMENT_TIER_COLORS } from '@/constants/achievements'

// The only fields a toast reads, so this game's own AchievementDefinition<StatsState> fits as is.
interface UnlockedAchievement {
  id: string
  icon: string
  tier: AchievementTier
  title: string
}

export interface UnlockToast {
  caption: string
  color: string
  icon: string
  /** The @rific/toaster stack it goes to (one of SeatToasters', in its seat's half of the screen, facing them), absent for the app's main Toaster. */
  stack?: string
  title: string
}

/** Seat -> the profile name sitting there, null or absent for a guest. */
export type SeatOwnerNames<Seat extends number> = Partial<Record<Seat, string | null>>

/** Seat -> the @rific/toaster stack its unlocks go to, absent for the app's main Toaster. */
export type SeatStacks<Seat extends number> = Partial<Record<Seat, string>>

/** 2 Player's two stacks, each shown by one of SeatToasters' Toasters, in its seat's half of the screen, facing them. */
export const SEAT_TOAST_STACKS = { 1: 'seat-1', 2: 'seat-2' } as const

/** The line under an unlock toast's title: whose unlock it is, "<Name> unlocked" for a profile and the fleet's plain "Achievement unlocked" for a
 * guest (a guest's progress is the device's). */
export const unlockCaption = (profileName?: string | null): string => (profileName ? `${profileName} unlocked` : 'Achievement unlocked')

/** One toast per unlock, seat by seat in `seats` order and each seat's in the order broadcastDeviceUnlocks lists them (its own, then the
 * device's), in the achievement's tier color with its own icon, on the seat's stack in `stacks` (the main Toaster without one). The same
 * achievement under the same caption on the same stack is one toast, so two guest seats handed the same device-wide unlock on a draw are told
 * once on one screen-fixed stack, and each on their own seat's stack. */
export function unlockToasts<Seat extends number>(unlocks: Partial<Record<Seat, UnlockedAchievement[]>>, seats: readonly Seat[], owners: SeatOwnerNames<Seat>, stacks: SeatStacks<Seat> = {}): UnlockToast[] {
  const seen = new Set<string>()
  return seats.flatMap((seat) => {
    const caption = unlockCaption(owners[seat])
    const stack = stacks[seat]
    return (unlocks[seat] ?? []).flatMap((achievement) => {
      const key = `${achievement.id}\n${caption}\n${stack ?? ''}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ caption, color: ACHIEVEMENT_TIER_COLORS[achievement.tier], icon: achievement.icon, ...(stack ? { stack } : {}), title: achievement.title }]
    })
  })
}

export type ShowUnlockToasts = <Seat extends number>(unlocks: Partial<Record<Seat, UnlockedAchievement[]>>, seats: readonly Seat[], owners: SeatOwnerNames<Seat>, stacks?: SeatStacks<Seat>) => void

/** The fleet's achievement toast (@rific/toaster's success toast), one per unlock. The modes with one human (Vs CPU, Solo) pass no `stacks`,
 * so theirs show on the app's one screen-fixed <Toaster/>. 2 Player passes SEAT_TOAST_STACKS, so each seat's show in their own half of the
 * screen, turned to face them (SeatToasters, on the game screen): the player across the table reads their own the right way up, and players
 * side by side each get their own stack on their own side (Jay, 2026-10-20).
 * Stable for the toaster's life. */
export function useUnlockToasts(): ShowUnlockToasts {
  const { success } = useToast()
  return useCallback<ShowUnlockToasts>(
    (unlocks, seats, owners, stacks) => {
      for (const toast of unlockToasts(unlocks, seats, owners, stacks)) success(toast.title, toast.caption, undefined, { color: toast.color, icon: toast.icon, stack: toast.stack })
    },
    [success]
  )
}
