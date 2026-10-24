import { getAchievementCatalogRows } from '@tastic/achievements'
import { AchievementCatalogSection, ActivityStatSection, StatRow, StatSection } from '@tastic/hud'
import { useCallback, useMemo } from 'react'

import { createGameStats, type RecordResult } from '@/shared/gameStats'
import { paddleGameCatalog } from '@/shared/paddleGame/constants/achievements'
import type { ProfileStats, StatsState } from '@/shared/paddleGame/types'
import { applyMatchOutcome, applySoloOutcome, getOverallTotals, getProfileRankings, getProfileStatsView, type MatchContext, type MatchOutcome } from '@/shared/paddleGame/utils/statsEngine'
import { DEFAULT_PROFILE_STATS, DEFAULT_STATS, isValidStats } from '@/shared/paddleGame/utils/statsValidation'
import { PlayerRankingsSection } from '@/shared/PlayerRankings'
import { useProfiles } from '@/shell/hooks/useProfiles'

const SPEEDS = ['slow', 'medium', 'fast'] as const

// What a paddle game's play screen records a finished round through.
export interface PaddleGameRecorders {
  recordMatchOutcome: (outcome: MatchOutcome, context: MatchContext) => RecordResult<StatsState>
  // A solo round (Breaker with seat 2 set to Nobody): seat 1 is the only player.
  recordSoloOutcome: (result: { cleared: boolean; bricksDestroyed: number }, profileId?: string) => RecordResult<StatsState>
}

// One paddle game's stats and achievements, under its own store key (Paddles' paddlesAchievements,
// Breaker's breakerAchievements): the store slice and context (the shared createGameStats), the
// recorders its play screen calls, and its sections on the shared stats screen. Both games save the
// same stats shape; Paddles' solo record and brick count just stay at zero, and only a game with
// bricks shows them or has their achievements.
export function createPaddleGameStats({ key, hasBricks }: { key: string; hasBricks: boolean }) {
  const catalog = paddleGameCatalog({ hasBricks })
  const gameStats = createGameStats<StatsState, ProfileStats>({ key, defaultStats: DEFAULT_STATS, isValidStats, catalog, getProfileStatsView })

  function useGameStats() {
    const { stats, unlockedAchievements, record, resetAll } = gameStats.useStats()
    // One finished match: who sat where (context.profileIds) gives the per-seat unlocks.
    const recordMatchOutcome: PaddleGameRecorders['recordMatchOutcome'] = useCallback((outcome, context) => record((prev) => applyMatchOutcome(prev, outcome, context), context.profileIds), [record])
    const recordSoloOutcome: PaddleGameRecorders['recordSoloOutcome'] = useCallback((result, profileId) => record((prev) => applySoloOutcome(prev, result, profileId), profileId ? { 1: profileId } : undefined), [record])
    return { stats, unlockedAchievements, recordMatchOutcome, recordSoloOutcome, resetAll }
  }

  // The stats for one profile (a profile id) or every player (null): its own bucket viewed through
  // the same StatsState shape every predicate already reads, or the device-wide stats themselves.
  function useStatsView(profileId: string | null) {
    const { stats } = useGameStats()
    const profileBucket = profileId ? (stats.profiles[profileId] ?? DEFAULT_PROFILE_STATS) : null
    return { stats, profileBucket, statsView: profileBucket ? getProfileStatsView(profileBucket) : stats }
  }

  function StatsSections({ profileId }: { profileId: string | null }) {
    const { stats, profileBucket, statsView } = useStatsView(profileId)
    const { profiles } = useProfiles()

    const overall = useMemo(() => getOverallTotals(statsView), [statsView])
    const rankings = useMemo(() => getProfileRankings(profiles, stats.profiles), [profiles, stats.profiles])
    const pointDiff = statsView.points.scored - statsView.points.conceded

    return (
      <>
        <StatSection label='OVERALL'>
          <StatRow label='Played' value={String(overall.played)} />
          <StatRow label='Wins' value={String(overall.wins)} />
          <StatRow label='Losses' value={String(overall.losses)} />
        </StatSection>

        <StatSection label='POINTS'>
          <StatRow label='Scored' value={String(statsView.points.scored)} />
          <StatRow label='Conceded' value={String(statsView.points.conceded)} />
          <StatRow label='Difference' value={pointDiff > 0 ? `+${pointDiff}` : String(pointDiff)} />
          <StatRow label='Shutouts' value={String(statsView.shutouts)} />
          <StatRow label='Best Win Margin' value={String(statsView.bestWinMargin)} />
        </StatSection>

        <StatSection label='VS CPU'>
          <StatRow label='Record (W-L)' value={`${statsView.vsCpu.wins}-${statsView.vsCpu.losses}`} />
          <StatRow label='Current Streak' value={String(statsView.vsCpu.currentWinStreak)} />
          <StatRow label='Best Streak' value={String(statsView.vsCpu.bestWinStreak)} />
        </StatSection>

        {/* Everyone keeps the seat framing (whoever sat where); a selected profile switches to that
        profile's own record, where p1Wins+p2Wins is always THIS profile's own win count. */}
        <StatSection label='TWO PLAYER (LOCAL)'>
          {profileBucket ? (
            <>
              <StatRow label='Played' value={String(statsView.twoPlayer.played)} />
              <StatRow label='Wins' value={String(statsView.twoPlayer.p1Wins + statsView.twoPlayer.p2Wins)} />
              <StatRow label='Losses' value={String(statsView.twoPlayer.played - statsView.twoPlayer.p1Wins - statsView.twoPlayer.p2Wins)} />
            </>
          ) : (
            <>
              <StatRow label='Played' value={String(stats.twoPlayer.played)} />
              <StatRow label='Seat 1 Wins' value={String(stats.twoPlayer.p1Wins)} />
              <StatRow label='Seat 2 Wins' value={String(stats.twoPlayer.p2Wins)} />
            </>
          )}
        </StatSection>

        {hasBricks && (
          <StatSection label='BRICKS'>
            <StatRow label='Played Alone' value={String(statsView.solo.played)} />
            <StatRow label='Cleared Alone' value={String(statsView.solo.cleared)} />
            <StatRow label='Bricks Broken' value={String(statsView.bricksDestroyed)} />
          </StatSection>
        )}

        <StatSection label='PUCK SPEED (W-L)'>
          {SPEEDS.map((speed) => (
            <StatRow key={speed} label={speed[0].toUpperCase() + speed.slice(1)} value={`${statsView.bySpeed[speed].wins}-${statsView.bySpeed[speed].losses}`} />
          ))}
        </StatSection>

        {/* A leaderboard across profiles answers a cross-profile question, so it only appears on
        Everyone. */}
        {profileId === null && <PlayerRankingsSection rankings={rankings} />}

        <ActivityStatSection stats={statsView} />
      </>
    )
  }

  function AchievementList({ profileId }: { profileId: string | null }) {
    const { unlockedAchievements } = useGameStats()
    const { stats, statsView } = useStatsView(profileId)
    return <AchievementCatalogSection rows={getAchievementCatalogRows(catalog, stats, statsView, unlockedAchievements, profileId)} />
  }

  return { reducer: gameStats.reducer, actions: gameStats.actions, Provider: gameStats.Provider, useGameStats, StatsSections, AchievementList, catalog }
}
