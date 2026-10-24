import { defaultColors, useAutoPaperTheme } from '@rific/auto-paper'
import { IconButton, Pressable } from '@rific/feedback-press'
import { FakeLandscapeView, rotateInsets, useRotation } from '@tastic/core'
import { PressAwayOverlay, usePopoverHost, useWellColors, WELL_SHADOW } from '@tastic/hud'
import { type Profile, ProfilePicker } from '@tastic/profile'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useGameGuide } from '@/shell/components/GuideHost'
import { HeroTitle } from '@/shell/components/HeroTitle'
import { SettingsDialog } from '@/shell/components/SettingsDialog'
import { useOpponent } from '@/shell/hooks/useOpponent'
import { useProfiles } from '@/shell/hooks/useProfiles'
import { useSeatColors } from '@/shell/hooks/useSeatColors'
import { usePack } from '@/shell/PackContext'
import type { GameDefinition } from '@/shell/types'

// Home: who's playing (seat 1, the same seat 1 every loadout starts with), then every game in the
// pack as a row in a fixed order, Solitaire's list: each game on its own well, its small app icon
// beside its name and blurb. A tap opens that game's loadout, after its How to Play cards the
// first time it's picked. Seat 2 is chosen in the loadout, from seat 2's own button.
export function HomeScreen() {
  const pack = usePack()
  const rotation = useRotation()
  const insets = rotateInsets(useSafeAreaInsets(), rotation)
  const { dark } = useAutoPaperTheme()
  const { openFirstTime, openFor } = useGameGuide()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { profiles, lastSelected, selectProfile } = useProfiles()
  const { seatTwo } = useOpponent()
  const { p1Color, p2Color, handleP1ColorChange } = useSeatColors(seatTwo === 'person')
  const pickerHost = usePopoverHost()
  const selectedProfile = profiles.find((p) => p.id === lastSelected[1]) ?? null

  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'

  const openGame = useCallback((game: GameDefinition) => openFirstTime(game.id, () => router.push({ pathname: '/[game]/loadout', params: { game: game.id } })), [openFirstTime])

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Reads correctly however the phone is held: see @tastic/core's FakeLandscapeView. The
      Settings dialog stays outside it: it renders through a Portal, turned by its own `rotation`. */}
      <FakeLandscapeView style={styles.rotatable}>
        <PressAwayOverlay active={pickerHost.openId !== null} onPress={pickerHost.close} />
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: 56 + insets.top, paddingBottom: 24 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }]}>
          <HeroTitle words={pack.wordmark} color={fg} p1Color={p1Color} p2Color={p2Color} />

          {/* Who's playing: seat 1's button, the same one each loadout starts with. Lifted above the
          tiles while its menu is open, so the menu paints over them. */}
          <View style={[styles.picker, pickerHost.openId !== null && styles.pickerOpen]}>
            <ProfilePicker idPrefix='home-p1' host={pickerHost} profiles={profiles} selectedId={lastSelected[1]} color={p1Color} dark={dark} guestLabel='P1' onSelect={(profile: Profile | null) => selectProfile(1, profile?.id ?? null)} onManage={() => router.push('/profiles')} colorSection={{ value: p1Color, onChange: handleP1ColorChange, swatches: defaultColors, caption: selectedProfile ? pack.colorCaption : undefined }} />
          </View>

          <View style={styles.list}>
            {pack.games.map((game) => (
              <GameRow key={game.id} game={game} dark={dark} onPress={() => openGame(game)} onRules={() => openFor(game.id)} />
            ))}
          </View>
        </ScrollView>

        <IconButton icon='trophy' iconColor={fg} size={24} style={[styles.corner, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={() => router.push('/stats')} accessibilityLabel='Stats & Achievements' />
        <IconButton icon='cog' iconColor={fg} size={24} style={[styles.corner, { top: 8 + insets.top, right: 8 + insets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotation} />
    </View>
  )
}

interface GameRowProps {
  game: GameDefinition
  dark: boolean
  onPress: () => void
  onRules: () => void
}

// One game on its own well: its icon at app-icon size (the art was drawn as an app icon), its name
// and one-line blurb, and a rules button at the end that shows its How to Play cards without
// opening the game.
function GameRow({ game, dark, onPress, onRules }: GameRowProps) {
  const well = useWellColors()
  return (
    // The rules button sits beside the row's own button, laid over its end, not inside it: a button
    // inside a button is invalid on the web.
    <View>
      <Pressable onPress={onPress} style={[styles.row, { backgroundColor: well.bg }]} accessibilityRole='button' accessibilityLabel={game.title}>
        <Image source={dark ? game.icon.dark : game.icon.light} style={styles.rowIcon} accessibilityIgnoresInvertColors />
        <View style={styles.rowText}>
          <Text variant='titleLarge' style={[styles.rowTitle, { color: well.fg }]} numberOfLines={1}>
            {game.title}
          </Text>
          <Text variant='bodyMedium' style={{ color: well.fgMuted }} numberOfLines={2}>
            {game.blurb}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={onRules} style={styles.rulesButton} hitSlop={12} accessibilityRole='button' accessibilityLabel={`${game.title} rules`}>
        <Icon source='information-outline' size={22} color={well.fgMuted} />
      </Pressable>
    </View>
  )
}

// The icon's size on a row: an app icon's, with its rounding.
const ROW_ICON_SIZE = 56
// Room at a row's end for the rules button laid over it.
const RULES_BUTTON_SPACE = 44

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    alignItems: 'center',
    gap: 24
  },
  corner: {
    position: 'absolute'
  },
  // Solitaire's list: one column, never wider than a phone's, centred on a wide screen.
  list: {
    gap: 14,
    maxWidth: 480,
    width: '100%'
  },
  picker: {
    alignItems: 'center'
  },
  pickerOpen: {
    zIndex: 100
  },
  rotatable: {
    flex: 1
  },
  // A well (@tastic/hud's wellSurface): the theme's surface on MD3's level-1 shadow, the same surface
  // as Solitaire's game rows, the stats screen's sections and every dialog.
  row: {
    alignItems: 'center',
    borderRadius: 12,
    boxShadow: WELL_SHADOW,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    paddingRight: RULES_BUTTON_SPACE
  },
  rowIcon: {
    borderRadius: ROW_ICON_SIZE * 0.22,
    height: ROW_ICON_SIZE,
    width: ROW_ICON_SIZE
  },
  rowText: {
    flex: 1,
    gap: 2
  },
  rowTitle: {
    fontWeight: 'bold'
  },
  rulesButton: {
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 14,
    top: 0
  },
  scroll: {
    flex: 1
  }
})
