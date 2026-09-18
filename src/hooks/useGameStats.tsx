import { mapUnlocksBySeat, useAchievements } from '@tastic/achievements'
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { AchievementDefinition, Player, StatsState, UnlockedAchievementsState } from '@/types'
import { applyMatchOutcome, getProfileStatsView, MatchContext, MatchOutcome } from '@/utils/statsEngine'
import { DEFAULT_STATS, isValidStats } from '@/utils/statsValidation'

// Produces 'boxhockey.stats' and 'boxhockey.achievements'.
const STORAGE_NAMESPACE = 'boxhockey'

export interface RecordMatchResult {
  // Device-wide newly-unlocked achievements (bare-id keyed).
  device: AchievementDefinition[]
  // Per-seat breakdown of what that seat's OWN saved profile newly unlocked — only seats with a
  // profile selected ever get an entry.
  profiles: Partial<Record<Player, AchievementDefinition[]>>
}

interface GameStatsContextValue {
  stats: StatsState
  unlockedAchievements: UnlockedAchievementsState
  // False until the stored blobs have been read (or failed to read) — see @tastic/achievements' own
  // useAchievements doc: lets achievements.tsx hold off rendering "0 games played" over real,
  // still-loading data.
  loaded: boolean
  recordMatchOutcome: (outcome: MatchOutcome, context: MatchContext) => RecordMatchResult
  // Wipes both stored keys back to defaults — irreversible, so callers confirm with the player
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

// Single source of truth for local stats/achievements, mounted once in _layout.tsx — expo-router
// keeps prior screens mounted, so a per-screen AsyncStorage-backed copy could go stale or clobber
// a concurrent update.
export function GameStatsProvider({ children }: Props) {
  const { stats, unlockedAchievements, loaded, recordOutcome, resetAll, removeProfile } = useAchievements<StatsState>({
    namespace: STORAGE_NAMESPACE,
    catalog: ACHIEVEMENT_CATALOG,
    defaultStats: DEFAULT_STATS,
    isValidStats,
    profileViews,
    migrateStats: (stored) => ({ ...stored, profiles: stored.profiles ?? {} })
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

  const value = useMemo(() => ({ stats, unlockedAchievements, loaded, recordMatchOutcome, resetAll, removeProfileStats }), [stats, unlockedAchievements, loaded, recordMatchOutcome, resetAll, removeProfileStats])

  return <GameStatsContext.Provider value={value}>{children}</GameStatsContext.Provider>
}

export function useGameStats() {
  const ctx = useContext(GameStatsContext)
  if (!ctx) throw new Error('useGameStats must be used within a GameStatsProvider')
  return ctx
}
