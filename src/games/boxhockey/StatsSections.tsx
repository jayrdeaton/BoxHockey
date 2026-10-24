import { getAchievementCatalogRows } from '@tastic/achievements'
import { AchievementCatalogSection, ActivityStatSection, StatRow, StatSection } from '@tastic/hud'
import { useMemo } from 'react'

import { ACHIEVEMENT_CATALOG } from '@/games/boxhockey/constants/achievements'
import { useGameStats } from '@/games/boxhockey/hooks/useGameStats'
import { getOverallTotals, getProfileRankings, getProfileStatsView } from '@/games/boxhockey/utils/statsEngine'
import { DEFAULT_PROFILE_STATS } from '@/games/boxhockey/utils/statsValidation'
import { PlayerRankingsSection } from '@/shared/PlayerRankings'
import { useProfiles } from '@/shell/hooks/useProfiles'

// The stats for one profile (a profile id) or every player (null): its own bucket viewed through the
// same StatsState shape every predicate already reads, or the device-wide stats themselves.
function useStatsView(profileId: string | null) {
  const { stats } = useGameStats()
  const profileBucket = profileId ? (stats.profiles[profileId] ?? DEFAULT_PROFILE_STATS) : null
  return { stats, profileBucket, statsView: profileBucket ? getProfileStatsView(profileBucket) : stats }
}

// Box Hockey's sections on the shared stats screen (shell/screens/StatsScreen.tsx).
export function StatsSections({ profileId }: { profileId: string | null }) {
  const { stats, profileBucket, statsView } = useStatsView(profileId)
  const { profiles } = useProfiles()

  const overall = useMemo(() => getOverallTotals(statsView), [statsView])
  const rankings = useMemo(() => getProfileRankings(profiles, stats.profiles), [profiles, stats.profiles])
  const goalDiff = statsView.goals.scored - statsView.goals.conceded

  return (
    <>
      <StatSection label='OVERALL'>
        <StatRow label='Played' value={String(overall.played)} />
        <StatRow label='Wins' value={String(overall.wins)} />
        <StatRow label='Losses' value={String(overall.losses)} />
      </StatSection>

      <StatSection label='GOALS'>
        <StatRow label='Scored' value={String(statsView.goals.scored)} />
        <StatRow label='Conceded' value={String(statsView.goals.conceded)} />
        <StatRow label='Difference' value={goalDiff > 0 ? `+${goalDiff}` : String(goalDiff)} />
        <StatRow label='Shutouts' value={String(statsView.shutouts)} />
        <StatRow label='Best Win Margin' value={String(statsView.bestWinMargin)} />
      </StatSection>

      <StatSection label='VS CPU'>
        <StatRow label='Record (W-L)' value={`${statsView.vsCpu.wins}-${statsView.vsCpu.losses}`} />
        <StatRow label='Current Streak' value={String(statsView.vsCpu.currentWinStreak)} />
        <StatRow label='Best Streak' value={String(statsView.vsCpu.bestWinStreak)} />
      </StatSection>

      {/* Everyone keeps the seat framing (whoever sat where); a selected profile switches to
  that profile's own record, where p1Wins+p2Wins is always THIS profile's own win count. */}
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

      <StatSection label='BOARDS (W-L)'>
        {(['classic', 'gauntlet', 'gravity'] as const).map((variant) => (
          <StatRow key={variant} label={variant[0].toUpperCase() + variant.slice(1)} value={`${statsView.variants[variant].wins}-${statsView.variants[variant].losses}`} />
        ))}
      </StatSection>

      {profileId === null && <PlayerRankingsSection rankings={rankings} />}

      <ActivityStatSection stats={statsView} />
    </>
  )
}

// Box Hockey's achievements on the shared stats screen.
export function AchievementList({ profileId }: { profileId: string | null }) {
  const { unlockedAchievements } = useGameStats()
  const { stats, statsView } = useStatsView(profileId)
  return <AchievementCatalogSection rows={getAchievementCatalogRows(ACHIEVEMENT_CATALOG, stats, statsView, unlockedAchievements, profileId)} />
}
