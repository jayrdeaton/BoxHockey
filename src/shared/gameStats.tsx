import { type AchievementDefinition, type AchievementsState, createAchievementsSlice, mapUnlocksBySeat, type UnlockedAchievementsState, useAchievements } from '@tastic/achievements'
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react'

import { forgetProfileAchievements, onProfileRemoved } from '@/shell/redux/onProfileRemoved'
import type { Seat } from '@/shell/types'

const SEATS: readonly Seat[] = [1, 2]

// What a recorded result unlocked: device-wide, and per seat for each seat with a profile in it (the
// package keys per-profile unlocks by profile id; the games think in seats).
export interface RecordResult<TStats> {
  device: AchievementDefinition<TStats>[]
  profiles: Partial<Record<Seat, AchievementDefinition<TStats>[]>>
}

interface GameStatsContextValue<TStats> {
  stats: TStats
  unlockedAchievements: UnlockedAchievementsState
  // Applies a result to the stats and returns what it unlocked. `profileIds` maps each seat to the
  // profile in it, for the per-seat breakdown.
  record: (update: (prev: TStats) => TStats, profileIds?: Partial<Record<Seat, string>>) => RecordResult<TStats>
  // Wipes the game's stats and achievements back to defaults - irreversible, so callers confirm with
  // the player first (the shell's stats screen reset).
  resetAll: () => void
}

interface GameStatsOptions<TStats, TBucket> {
  // The store key, which is also where the stats are saved.
  key: string
  defaultStats: TStats
  isValidStats?: (value: unknown) => boolean
  catalog: AchievementDefinition<TStats>[]
  // A profile's own bucket seen through the same shape as the device-wide stats, so every
  // achievement predicate reads either.
  getProfileStatsView: (bucket: TBucket) => TStats
}

// One game's stats and achievements: its store slice (@tastic/achievements' createAchievementsSlice
// under the game's own key, with a profile deleted on the Profiles screen taking its stats bucket and
// unlocks with it), and the context every screen reads them through, mounted once at the app root
// (GameDefinition.Provider) so useAchievements' mount-time unlock re-sweep runs once. Every game keeps
// its stats with a `profiles` bucket per profile beside the device-wide totals.
export function createGameStats<TStats extends { profiles: Record<string, TBucket> }, TBucket>({ key, defaultStats, isValidStats, catalog, getProfileStatsView }: GameStatsOptions<TStats, TBucket>) {
  const { actions, reducer: sliceReducer } = createAchievementsSlice<TStats>({
    key,
    defaultStats,
    isValidStats,
    // Backfills `profiles` onto stats saved without it.
    migrateStats: (stored) => ({ ...stored, profiles: stored.profiles ?? {} })
  })

  const dropProfileStats = (stats: TStats, profileId: string): TStats => {
    if (!(profileId in stats.profiles)) return stats
    const { [profileId]: _removed, ...rest } = stats.profiles
    return { ...stats, profiles: rest }
  }
  const reducer = onProfileRemoved(sliceReducer, forgetProfileAchievements<TStats, AchievementsState<TStats>>(dropProfileStats))

  const profileViews = (stats: TStats): Record<string, TStats> => Object.fromEntries(Object.entries(stats.profiles).map(([profileId, bucket]) => [profileId, getProfileStatsView(bucket)]))

  const Context = createContext<GameStatsContextValue<TStats> | null>(null)

  function Provider({ children }: { children: ReactNode }) {
    const { stats, unlockedAchievements, recordOutcome, resetAll } = useAchievements<TStats, Record<string, AchievementsState<TStats>>>({
      catalog,
      select: (state) => state[key],
      actions,
      profileViews
    })

    const record = useCallback(
      (update: (prev: TStats) => TStats, profileIds?: Partial<Record<Seat, string>>): RecordResult<TStats> => {
        const result = recordOutcome(update)
        return { device: result.device, profiles: mapUnlocksBySeat(SEATS, profileIds, result.profiles) }
      },
      [recordOutcome]
    )

    const value = useMemo(() => ({ stats, unlockedAchievements, record, resetAll }), [stats, unlockedAchievements, record, resetAll])
    return <Context.Provider value={value}>{children}</Context.Provider>
  }

  function useStats(): GameStatsContextValue<TStats> {
    const ctx = useContext(Context)
    if (!ctx) throw new Error(`The ${key} stats are read within their game's Provider`)
    return ctx
  }

  return { reducer, actions, Provider, useStats }
}
