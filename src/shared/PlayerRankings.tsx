import { StatSection, useWellColors } from '@tastic/hud'
import { type Profile, ProfileChip } from '@tastic/profile'
import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

import { MONO_FONT } from '@/shell/fonts'

export interface ProfileRanking {
  profile: Profile
  played: number
  wins: number
  losses: number
  winRate: number
}

// Every saved profile's record in one game, most wins first (then best win rate), from the game's
// own per-profile totals.
export function rankProfiles(profiles: Profile[], totalsFor: (profileId: string) => { played: number; wins: number; losses: number }): ProfileRanking[] {
  return profiles
    .map((profile) => {
      const totals = totalsFor(profile.id)
      return { profile, ...totals, winRate: totals.played > 0 ? totals.wins / totals.played : 0 }
    })
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
}

// A game's PLAYER RANKINGS section on the stats screen: one row per saved profile, a ProfileChip
// (the profile's own color and tag) plus its name and record. A leaderboard across profiles answers
// a cross-profile question, so a game shows it only on Everyone. @tastic/hud's StatRow has no
// leading identity chip, hence a row of its own. The text sits in a StatSection well, so it takes
// the well's own colors (useWellColors: onSurface, onSurfaceVariant), as StatRow does.
export function PlayerRankingsSection({ rankings }: { rankings: ProfileRanking[] }) {
  const { fg, fgMuted } = useWellColors()
  if (rankings.length === 0) return null
  return (
    <StatSection label='PLAYER RANKINGS'>
      {rankings.map(({ profile, wins, losses, played }) => (
        <View key={profile.id} style={styles.statRow}>
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
      ))}
    </StatSection>
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
  statRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  }
})
