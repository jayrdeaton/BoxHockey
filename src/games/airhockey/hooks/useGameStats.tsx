import { useCallback } from 'react'

import { ACHIEVEMENT_CATALOG } from '@/games/airhockey/constants/achievements'
import type { ProfileStats, StatsState } from '@/games/airhockey/types'
import { applyMatchOutcome, getProfileStatsView, type MatchContext, type MatchOutcome } from '@/games/airhockey/utils/statsEngine'
import { DEFAULT_STATS, isValidStats } from '@/games/airhockey/utils/statsValidation'
import { createGameStats } from '@/shared/gameStats'

// Air Hockey's stats and achievements, under its own store key (see the shared createGameStats).
const gameStats = createGameStats<StatsState, ProfileStats>({ key: 'airhockeyAchievements', defaultStats: DEFAULT_STATS, isValidStats, catalog: ACHIEVEMENT_CATALOG, getProfileStatsView })

export const achievementsReducer = gameStats.reducer
export const achievementsActions = gameStats.actions
export const GameStatsProvider = gameStats.Provider

export function useGameStats() {
  const { stats, unlockedAchievements, record, resetAll } = gameStats.useStats()
  // Records one finished match: who sat where (context.profileIds) gives the per-seat unlocks.
  const recordMatchOutcome = useCallback((outcome: MatchOutcome, context: MatchContext) => record((prev) => applyMatchOutcome(prev, outcome, context), context.profileIds), [record])
  return { stats, unlockedAchievements, recordMatchOutcome, resetAll }
}
