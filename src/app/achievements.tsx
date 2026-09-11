import { useAutoPaperTheme } from '@rific/auto-paper'
import { ACHIEVEMENT_TIER_COLORS, unlockedKey } from '@tastic/achievements'
import { rotateInsets, useRotation } from '@tastic/core'
import { AchievementRow, BaseStatsScreen, LOCKED_BADGE_COLOR, StatRow, StatSection, usePopoverHost } from '@tastic/hud'
import { ProfileChip, ProfilePicker } from '@tastic/profile'
import { FakeLandscapeView } from '@tastic/split-screen'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ActivityIndicator, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { MONO_FONT } from '@/constants/fonts'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { safeBack } from '@/utils/navigation'
import { getOverallTotals, getProfileRankings, getProfileStatsView, ProfileRanking } from '@/utils/statsEngine'
import { DEFAULT_PROFILE_STATS } from '@/utils/statsValidation'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Calendar-day difference, not raw elapsed time, so an achievement unlocked at 11pm reads as "1 day
// ago" once the date rolls over rather than 24 hours later. Stays local: @tastic/hud's
// AchievementRow takes a precomputed label, since date conventions vary per app.
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function unlockedLabel(unlockedAt: number): string {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(unlockedAt))) / MS_PER_DAY)
  if (days <= 0) return 'Unlocked today'
  if (days === 1) return 'Unlocked 1 day ago'
  return `Unlocked ${days} days ago`
}

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
  const { stats, unlockedAchievements, loaded, resetAll } = useGameStats()
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

  // Every computation above already reads cleanly off useAchievements' own zeroed defaultStats
  // while still loading, so nothing above needs to change — but rendering the real sections over
  // that zeroed data would flash "0 games played" for a beat on every launch. onReset is withheld
  // here too: resetting stats that haven't actually been read back from storage yet has nothing
  // real to confirm against.
  if (!loaded) {
    return (
      <FakeLandscapeView style={styles.rotatable}>
        <BaseStatsScreen onBack={safeBack} insets={insets} rotation={rotation}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={themeColors.primary} />
          </View>
        </BaseStatsScreen>
      </FakeLandscapeView>
    )
  }

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

        <StatSection label='ACTIVITY'>
          <StatRow label='Days Played' value={String(statsView.distinctDaysPlayed)} />
          <StatRow label='Day Streak' value={String(statsView.currentDayStreak)} />
          <StatRow label='Best Day Streak' value={String(statsView.bestDayStreak)} />
        </StatSection>

        <Text variant='labelMedium' style={[styles.listLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
          ALL ACHIEVEMENTS
        </Text>
        {ACHIEVEMENT_CATALOG.map((achievement) => {
          // scope:'device' always evaluates against the real device stats and its bare-id key,
          // regardless of which tab is active; everything else follows the selected view. On "All
          // Profiles" both branches collapse to the same thing.
          const scope = achievement.scope ?? 'profile'
          const evalStats = scope === 'device' ? stats : statsView
          const key = unlockedKey(achievement.id, scope === 'device' ? null : effectiveProfileId)
          const unlockedAt = unlockedAchievements[key]
          const progress = unlockedAt === undefined ? achievement.progress?.(evalStats) : undefined
          const tierColor = ACHIEVEMENT_TIER_COLORS[achievement.tier]
          return <AchievementRow key={achievement.id} icon={achievement.icon} title={achievement.title} description={achievement.description} badgeColor={unlockedAt !== undefined ? tierColor : LOCKED_BADGE_COLOR} checkColor={tierColor} unlockedLabel={unlockedAt !== undefined ? unlockedLabel(unlockedAt) : undefined} progress={progress} deviceMarker={effectiveProfileId !== null && scope === 'device'} />
        })}
      </BaseStatsScreen>
    </FakeLandscapeView>
  )
}

const styles = StyleSheet.create({
  boldText: {
    fontWeight: 'bold'
  },
  listLabel: {
    letterSpacing: 2,
    marginTop: 8
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48
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
