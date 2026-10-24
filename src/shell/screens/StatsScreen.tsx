import { useAutoPaperTheme } from '@rific/auto-paper'
import { FakeLandscapeView, rotateInsets, useRotation } from '@tastic/core'
import { BaseStatsScreen, PressAwayOverlay, usePopoverHost } from '@tastic/hud'
import { OptionPicker, type OptionPickerOption } from '@tastic/profile'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SegmentedButtons, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch } from 'react-redux'

import { useProfiles } from '@/shell/hooks/useProfiles'
import { safeBack } from '@/shell/navigation'
import { usePack } from '@/shell/PackContext'
import type { GameDefinition } from '@/shell/types'

// Two tabs, as on Solitaire's stats screen: a page with every game's stats above the achievements
// would leave the achievements out of sight at the bottom.
type StatsTab = 'stats' | 'achievements'
const TABS = [
  { value: 'stats', label: 'Stats', icon: 'chart-box-outline' },
  { value: 'achievements', label: 'Achievements', icon: 'trophy-outline' }
]

// The pickers' values for Everyone and All Games (neither is ever a profile or game id).
const EVERYONE = '__everyone__'
const ALL_GAMES = '__all__'

const PLAYER_PICKER_ID = 'stats-player'
const GAME_PICKER_ID = 'stats-game'

// Every game's stats and achievements on one screen, filtered by player (Everyone, or one profile)
// and by game (All Games, or one), like Solitaire's. Each game keeps its own stats and its own
// achievements; this screen only shows them side by side. With two seats there's no one player to
// open on, so it opens on Everyone. Guests count only toward Everyone: two guests in one match can't
// be told apart.
export function StatsScreen() {
  const pack = usePack()
  const { dark, colors } = useAutoPaperTheme()
  // Turned with the phone like every other screen: rotateInsets remaps the device's raw safe-area
  // reading onto the edges they land on once FakeLandscapeView turns the content.
  const rotation = useRotation()
  const insets = rotateInsets(useSafeAreaInsets(), rotation)
  const { profiles } = useProfiles()
  const dispatch = useDispatch()
  const pickerHost = usePopoverHost()

  const [tab, setTab] = useState<StatsTab>('stats')
  const [gameId, setGameId] = useState<string>(ALL_GAMES)
  // Self-heals to Everyone if the selected profile is deleted while this screen is mounted.
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const profileId = selectedProfileId && profiles.some((p) => p.id === selectedProfileId) ? selectedProfileId : null

  const games = gameId === ALL_GAMES ? pack.games : pack.games.filter((g) => g.id === gameId)

  const playerOptions = useMemo<OptionPickerOption<string>[]>(() => [{ value: EVERYONE, label: 'Everyone', icon: 'account-group' }, ...profiles.map((p) => ({ value: p.id, label: p.name, icon: 'account', color: p.color }))], [profiles])
  const gameOptions = useMemo<OptionPickerOption<string>[]>(() => [{ value: ALL_GAMES, label: 'All Games', icon: 'view-grid-outline' }, ...pack.games.map((g) => ({ value: g.id, label: g.title }))], [pack.games])

  // Reset clears every player's stats and achievements in the games shown (one game, or all of them).
  const resetScope = games.length === 1 ? games[0].title : 'every game'
  const onReset = () => games.forEach((g) => dispatch(g.resetStats()))

  return (
    <FakeLandscapeView style={styles.rotatable}>
      <BaseStatsScreen title={tab === 'stats' ? 'Stats' : 'Achievements'} onBack={safeBack} insets={insets} onReset={onReset} resetLabel={games.length === 1 ? `Reset ${resetScope} Stats` : 'Reset All Stats'} resetConfirmTitle='Reset Stats?' resetConfirmBody={`Erases every player's stats and achievements in ${resetScope}. This cannot be undone.`} rotation={rotation}>
        {/* Inside the page, not before it: BaseStatsScreen paints an opaque full-screen container that
        would hide a tap catcher placed underneath it. Over the stat sections and under the open
        filters (pressAway's zIndex sits below filtersOpen's), so a tap anywhere on the page but a
        menu closes it. */}
        <PressAwayOverlay active={pickerHost.openId !== null} onPress={pickerHost.close} style={styles.pressAway} />
        <SegmentedButtons value={tab} onValueChange={(value) => setTab(value as StatsTab)} buttons={TABS} style={styles.tabs} />

        <View style={[styles.filters, pickerHost.openId !== null && styles.filtersOpen]}>
          {profiles.length > 0 && <OptionPicker id={PLAYER_PICKER_ID} host={pickerHost} options={playerOptions} value={profileId ?? EVERYONE} onChange={(value) => setSelectedProfileId(value === EVERYONE ? null : value)} color={colors.primary} dark={dark} icon={profileId ? 'account' : 'account-group'} />}
          <OptionPicker id={GAME_PICKER_ID} host={pickerHost} options={gameOptions} value={gameId} onChange={setGameId} color={colors.primary} dark={dark} icon='view-grid-outline' />
        </View>

        {games.map((game) => (
          <GameStats key={game.id} game={game} tab={tab} profileId={profileId} showTitle={games.length > 1} />
        ))}
      </BaseStatsScreen>
    </FakeLandscapeView>
  )
}

// One game's part of the page: its own sections, under its name when more than one game is shown.
function GameStats({ game, tab, profileId, showTitle }: { game: GameDefinition; tab: StatsTab; profileId: string | null; showTitle: boolean }) {
  const { colors } = useAutoPaperTheme()
  const { StatsSections, AchievementList } = game
  return (
    <View style={styles.game}>
      {showTitle && (
        <Text variant='titleLarge' style={[styles.gameTitle, { color: colors.onBackground }]}>
          {game.title}
        </Text>
      )}
      {tab === 'stats' ? <StatsSections profileId={profileId} /> : <AchievementList profileId={profileId} />}
    </View>
  )
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center'
  },
  filtersOpen: {
    zIndex: 100
  },
  game: {
    gap: 16
  },
  gameTitle: {
    fontWeight: 'bold',
    marginTop: 8
  },
  pressAway: {
    zIndex: 50
  },
  // A real full-bleed box for FakeLandscapeView to size its turned content against.
  rotatable: {
    flex: 1
  },
  // SegmentedButtons' own rounding.
  tabs: {
    borderRadius: 20
  }
})
