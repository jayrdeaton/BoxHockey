import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton } from '@rific/feedback-press'
import { FakeLandscapeView, rotateInsets, useRotation } from '@tastic/core'
import { useAutoShowGuide } from '@tastic/hud/guide'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HeroTitle } from '@/components/HeroTitle'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useSettings } from '@/hooks/useSettings'
import { GameMode } from '@/types'

export default function HomeScreen() {
  const { settings, setSettings } = useSettings()
  // Follows the device's current physical tilt (see @tastic/core's useOrientationState, which
  // useRotation reads internally), so the title screen rotates along with everywhere else as soon
  // as the phone is turned. Lock Orientation (see SettingsDialog) pins it app-wide by freezing the
  // shared reading itself (OrientationProvider's freezeWhileLocked in _layout.tsx), so neither this
  // nor FakeLandscapeView below takes a `locked` argument.
  // app.json is portrait-locked at the OS level now (no more real OS rotation to rely on) — see
  // FakeLandscapeView below, which fakes the rest entirely in JS from this hook's live
  // accelerometer reading.
  const rotation = useRotation()

  const [settingsOpen, setSettingsOpen] = useState(false)
  // First launch only (and once per session): opens the how-to-play cards over this screen. Called
  // here and nowhere else so it can never fire over a live match or a two-seat loadout. Home is the
  // one screen with a single reader, before any seating. See GuideHost / @tastic/hud/guide.
  useAutoShowGuide()
  const { colors, dark } = useAutoPaperTheme()
  // react-native-safe-area-context always reports insets relative to the device's own fixed
  // physical frame (the OS thinks the interface is still portrait-locked and never rotates, so it
  // has no idea FakeLandscapeView below is rotating the content) — rotateInsets remaps them onto
  // whichever edge they actually correspond to once visually rotated, using the same rotation
  // FakeLandscapeView itself renders with, so `top`/`right` below always mean the screen's real,
  // visual edges regardless of how the phone is being held.
  const insets = rotateInsets(useSafeAreaInsets(), rotation)

  // High-contrast retro look: literal black/white, flipped by appearance, rather than auto-paper's
  // own (slightly tinted) background role.
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'

  const chooseMode = useCallback(
    (gameMode: GameMode) => {
      setSettings({ gameMode })
      router.push({ pathname: '/loadout', params: { mode: gameMode } })
    },
    [setSettings]
  )

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Everything below reads correctly no matter which way the phone is actually being held —
      see @tastic/split-screen's FakeLandscapeView for why this is needed at all now that the app is
      portrait-locked at the OS level (no more real OS rotation to rely on). SettingsDialog is
      deliberately left outside this wrapper — it renders as a centered modal overlay via Portal,
      unaffected by (and not needing) this transform. */}
      <FakeLandscapeView style={styles.rotatable}>
        {/* Same top-left slot every @tastic title screen uses for this — see LightCycles' own
        identical trophy IconButton. */}
        <IconButton icon='trophy' iconColor={fg} size={24} style={[styles.topLeft, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={() => router.push('/achievements')} accessibilityLabel='Stats & Achievements' />
        <IconButton icon='cog' iconColor={fg} size={24} style={[styles.topRight, { top: 8 + insets.top, right: 8 + insets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

        <HeroTitle color={fg} p1Color={colors.primary} p2Color={colors.secondary} />

        <View style={styles.actions}>
          <Button mode='contained' icon='account' onPress={() => chooseMode('vsCpu')} style={styles.actionButton}>
            One Player
          </Button>
          <Button mode='contained' icon='account-multiple' onPress={() => chooseMode('twoPlayer')} style={styles.actionButton} buttonColor={colors.secondary} textColor={colors.onSecondary}>
            Two Player
          </Button>
        </View>
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotation} settings={settings} setSettings={setSettings} showHowToPlay />
    </View>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    minWidth: 180
  },
  actions: {
    alignItems: 'center',
    gap: 16
  },
  container: {
    flex: 1
  },
  // Owns the flex-centering layout `container` used to apply directly — now one level deeper, since
  // everything visible sits inside FakeLandscapeView, which needs a real (not shrink-wrapped)
  // full-bleed box to size its own absolutely-positioned children (the settings cog) against
  // correctly.
  rotatable: {
    alignItems: 'center',
    flex: 1,
    gap: 48,
    justifyContent: 'center'
  },
  topLeft: {
    left: 8,
    position: 'absolute',
    top: 8
  },
  topRight: {
    position: 'absolute',
    right: 8,
    top: 8
  }
})
