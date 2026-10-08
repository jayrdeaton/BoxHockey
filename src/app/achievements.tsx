import { useAutoPaperTheme } from '@rific/auto-paper'
import { getAchievementCatalogRows } from '@tastic/achievements'
import { FakeLandscapeView, rotateInsets, useRotation } from '@tastic/core'
import { AchievementCatalogSection, ActivityStatSection, BaseStatsScreen, StatRow, StatSection, usePopoverHost } from '@tastic/hud'
import { ProfileChip, ProfilePicker } from '@tastic/profile'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { MONO_FONT } from '@/constants/fonts'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { safeBack } from '@/utils/navigation'
import { getOverallTotals, getProfileRankings, getProfileStatsView, ProfileRanking } from '@/utils/statsEngine'
import { DEFAULT_PROFILE_STATS } from '@/utils/statsValidation'

interface ProfileRankingRowProps {
  ranking: ProfileRanking
  fg: string
  fgMuted: string
}

// One row per saved profile — a ProfileChip (that profile's own saved color and tag) plus its name
// and record. Stays BoxHockey-local: @tastic/hud's StatRow has no notion of a leading identity chip.
function ProfileRankingRow({ ranking, fg, fgMuted }: ProfileRankingRowProps) {
  const { profile, wins, losses, played } = ranking
  return (
    <View style={styles.statRow}>
      <View style={styles.profileValue}>
        <ProfileChip profile={profile} />
        <Text variant='bodyMedium' style={[styles.boldText, { color: fg, fontFamily: MONO_FONT }]} numberOfLines={1}>
          {profile.name}
        </Text>
      </View>
      <Text variant='bodyMedium' style={{ color: fgMuted, fontFamily: MONO_FONT }}>
        {wins}-{losses}
        <Text style={{ color: fgMuted, fontFamily: MONO_FONT }}> ({played} played)</Text>
      </Text>
    </View>
  )
}

export default function AchievementsScreen() {
  const { dark, colors: themeColors } = useAutoPaperTheme()
  // Unlike index.tsx/loadout.tsx, this screen previously had no orientation handling at all — it
  // always rendered right-side-up regardless of how the phone was actually being held, the one
  // screen in the app that didn't rotate along with everywhere else. rotateInsets remaps the
  // device's own raw (never-rotated) safe-area reading onto whichever edge it actually corresponds
  // to once FakeLandscapeView below visually rotates the content — see index.tsx's identical
  // comment for the full reasoning.
  const rotation = useRotation()
  const insets = rotateInsets(useSafeAreaInsets(), rotation)
  const { stats, unlockedAchievements, resetAll } = useGameStats()
  const { profiles } = useProfiles()
  const profilePickerHost = usePopoverHost()
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  // null = "All Profiles" (device-wide). Self-heals to null if the selected profile is deleted from
  // another still-mounted screen — effectiveProfileId simply stops matching any entry in `profiles`.
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const effectiveProfileId = selectedProfileId && profiles.some((p) => p.id === selectedProfileId) ? selectedProfileId : null
  const profileBucket = effectiveProfileId ? (stats.profiles[effectiveProfileId] ?? DEFAULT_PROFILE_STATS) : null
  // The same StatsState-shaped object every predicate and helper already reads — statsView === stats
  // for "All Profiles", so every section collapses to the device-wide view in that case.
  const statsView = profileBucket ? getProfileStatsView(profileBucket) : stats

  const overall = useMemo(() => getOverallTotals(statsView), [statsView])
  const rankings = useMemo(() => getProfileRankings(profiles, stats.profiles), [profiles, stats.profiles])
  const goalDiff = statsView.goals.scored - statsView.goals.conceded

  return (
    <FakeLandscapeView style={styles.rotatable}>
      <BaseStatsScreen onBack={safeBack} insets={insets} onReset={resetAll} rotation={rotation}>
        {profiles.length > 0 && <ProfilePicker idPrefix='achievements' host={profilePickerHost} profiles={profiles} selectedId={effectiveProfileId} color={themeColors.primary} dark={dark} guestLabel='All Profiles' nullLabel='All Profiles' nullIcon='account-group' onSelect={(profile) => setSelectedProfileId(profile?.id ?? null)} />}

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

        {/* All Profiles keeps the seat framing (whoever sat where); a selected profile switches to
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

        {/* A leaderboard across profiles is inherently a cross-profile question, so it only appears
      on "All Profiles" — once you've drilled into one profile it answers a different question. */}
        {effectiveProfileId === null && rankings.length > 0 && (
          <StatSection label='PLAYER RANKINGS'>
            {rankings.map((ranking) => (
              <ProfileRankingRow key={ranking.profile.id} ranking={ranking} fg={fg} fgMuted={fgMuted} />
            ))}
          </StatSection>
        )}

        <ActivityStatSection stats={statsView} />

        <AchievementCatalogSection rows={getAchievementCatalogRows(ACHIEVEMENT_CATALOG, stats, statsView, unlockedAchievements, effectiveProfileId)} />
      </BaseStatsScreen>
    </FakeLandscapeView>
  )
}

const styles = StyleSheet.create({
  boldText: {
    fontWeight: 'bold'
  },
  profileValue: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  // Everything visible sits inside FakeLandscapeView now, which needs a real (not shrink-wrapped)
  // full-bleed box to size its own ±90° dimension-swap math against correctly — see index.tsx's
  // identical style/comment.
  rotatable: {
    flex: 1
  },
  statRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  }
})
