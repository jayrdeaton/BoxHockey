import { createAchievementsSlice } from '@tastic/achievements'

import type { StatsState } from '@/types'
import { DEFAULT_STATS, isValidStats } from '@/utils/statsValidation'

// This game's stats and unlocked achievements, persisted with the rest of the store and read and
// written only through hooks/useGameStats.tsx (@tastic/achievements' useAchievements). On rehydrate,
// stats that fail isValidStats fall back to DEFAULT_STATS, and migrateStats backfills `profiles` onto
// stats saved without it.
const { actions, reducer } = createAchievementsSlice<StatsState>({
  defaultStats: DEFAULT_STATS,
  isValidStats,
  migrateStats: (stored) => ({ ...stored, profiles: stored.profiles ?? {} })
})

export const achievementsActions = actions
export default reducer
