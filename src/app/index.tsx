import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton } from '@rific/feedback-press'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HeroTitle } from '@/components/HeroTitle'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useOrientationLock } from '@/hooks/useOrientationLock'
import { GameMode } from '@/types'

export default function HomeScreen() {
  const { settings, setSettings } = useGameSettings()
  // orientationMode just follows the device's current physical shape (see useDeviceOrientation),
  // so the title screen rotates along with everywhere else as soon as the phone is turned — Lock
  // Orientation (see SettingsDialog) is the opt-in for pinning it.
  const orientationMode = useDeviceOrientation()
  useOrientationLock(settings.lockOrientation, orientationMode)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const { colors, dark } = useAutoPaperTheme()
  const insets = useSafeAreaInsets()

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

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} />
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
    alignItems: 'center',
    flex: 1,
    gap: 48,
    justifyContent: 'center'
  },
  topRight: {
    position: 'absolute',
    right: 8,
    top: 8
  }
})
