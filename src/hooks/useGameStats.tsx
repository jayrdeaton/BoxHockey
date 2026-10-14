import { mapUnlocksBySeat, useAchievements } from '@tastic/achievements'
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { achievementsActions } from '@/redux/achievementsSlice'
import type { RootState } from '@/redux/store'
import { AchievementDefinition, Player, StatsState, UnlockedAchievementsState } from '@/types'
import { applyMatchOutcome, getProfileStatsView, MatchContext, MatchOutcome } from '@/utils/statsEngine'

export interface RecordMatchResult {
  // Device-wide newly-unlocked achievements (bare-id keyed).
  device: AchievementDefinition[]
  // Per-seat breakdown of what that seat's OWN saved profile newly unlocked - only seats with a
  // profile selected ever get an entry.
  profiles: Partial<Record<Player, AchievementDefinition[]>>
}

interface GameStatsContextValue {
  stats: StatsState
  unlockedAchievements: UnlockedAchievementsState
  recordMatchOutcome: (outcome: MatchOutcome, context: MatchContext) => RecordMatchResult
  // Wipes both stored keys back to defaults - irreversible, so callers confirm with the player
  // first (see achievements.tsx's reset confirmation).
  resetAll: () => void
  // Drops one profile's stats bucket and its unlock history, so a deleted profile leaves nothing
  // orphaned behind.
  removeProfileStats: (profileId: string) => void
}

const GameStatsContext = createContext<GameStatsContextValue | null>(null)

interface Props {
  children: ReactNode
}

function profileViews(stats: StatsState): Record<string, StatsState> {
  return Object.fromEntries(Object.entries(stats.profiles).map(([profileId, bucket]) => [profileId, getProfileStatsView(bucket)]))
}

// Single source of truth for local stats/achievements (the store's `achievements` slice, see
// redux/achievementsSlice.ts), mounted once in _layout.tsx so useAchievements' mount-time unlock
// re-sweep runs once and every screen shares the same callbacks.
export function GameStatsProvider({ children }: Props) {
  const { stats, unlockedAchievements, recordOutcome, resetAll, removeProfile } = useAchievements<StatsState, RootState>({
    catalog: ACHIEVEMENT_CATALOG,
    select: (state) => state.achievements,
    actions: achievementsActions,
    profileViews
  })

  const recordMatchOutcome = useCallback(
    (outcome: MatchOutcome, context: MatchContext): RecordMatchResult => {
      const result = recordOutcome((prev) => applyMatchOutcome(prev, outcome, context))

      // The package keys per-profile unlocks by profile id; this app thinks in seats, so translate
      // back through the same profileIds map that produced them.
      const profiles = mapUnlocksBySeat([1, 2] as Player[], context.profileIds, result.profiles)

      return { device: result.device, profiles }
    },
    [recordOutcome]
  )

  const removeProfileStats = useCallback(
    (profileId: string) => {
      removeProfile(profileId, (prev) => {
        if (!(profileId in prev.profiles)) return prev
        const { [profileId]: _removed, ...rest } = prev.profiles
        return { ...prev, profiles: rest }
      })
    },
    [removeProfile]
  )

  const value = useMemo(() => ({ stats, unlockedAchievements, recordMatchOutcome, resetAll, removeProfileStats }), [stats, unlockedAchievements, recordMatchOutcome, resetAll, removeProfileStats])

  return <GameStatsContext.Provider value={value}>{children}</GameStatsContext.Provider>
}

export function useGameStats() {
  const ctx = useContext(GameStatsContext)
  if (!ctx) throw new Error('useGameStats must be used within a GameStatsProvider')
  return ctx
}
