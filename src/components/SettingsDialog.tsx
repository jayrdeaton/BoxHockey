import { AutoAppearancePicker, Dialog, useAutoPaperTheme } from '@rific/auto-paper'
import { Button, Switch, useHapticSettings } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { useUpdater } from '@rific/updater'
import { Platform, StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import { useSoundSettings } from '@/components/Sound'
import { release } from '@/constants/release'

interface SettingIconProps {
  source: string
  color: string
  containerColor: string
}

// Small colored badge per row (icon tinted on its own MD3 container color) — echoes the
// primary/secondary/tertiary triad that's already the app's own identity (derived from the two
// players' colors, see Theme.tsx), so the settings list picks up that same palette.
function SettingIcon({ source, color, containerColor }: SettingIconProps) {
  return (
    <View style={[styles.iconBadge, { backgroundColor: containerColor }]}>
      <Icon source={source} size={18} color={color} />
    </View>
  )
}

export interface SettingsDialogProps {
  visible: boolean
  onDismiss: () => void
}

export function SettingsDialog({ visible, onDismiss }: SettingsDialogProps) {
  const { colors } = useAutoPaperTheme()
  const { settings: hapticSettings, set: setHapticSettings } = useHapticSettings()
  const { settings: soundSettings, set: setSoundSettings } = useSoundSettings()
  const { error } = useToast()
  // autoCheck: false — the root layout (_layout.tsx) already runs the silent background check via
  // its own useUpdater() instance; a second instance with autoCheck's default (true) would set up
  // a second AppState listener and double every foreground-resume update check. This instance only
  // ever checks on an explicit tap of the button below.
  const { check, checking, updateReady } = useUpdater({ autoCheck: false, autoPrompt: false, onError: (message) => error('Update check failed', message) })

  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.Content style={styles.content}>
        <View style={styles.section}>
          <Text variant='labelMedium' style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
            APPEARANCE
          </Text>
          <AutoAppearancePicker showLabels={false} />
        </View>

        {Platform.OS !== 'web' && (
          <View style={styles.row}>
            <View style={styles.rowStart}>
              <SettingIcon source='vibrate' color={colors.secondary} containerColor={colors.secondaryContainer} />
              <Text variant='bodyLarge' style={{ color: colors.onSurface }}>
                Haptics
              </Text>
            </View>
            <Switch value={hapticSettings.vibrate} onValueChange={(value) => setHapticSettings({ vibrate: value })} />
          </View>
        )}

        <View style={styles.row}>
          <View style={styles.rowStart}>
            <SettingIcon source='volume-high' color={colors.tertiary} containerColor={colors.tertiaryContainer} />
            <Text variant='bodyLarge' style={{ color: colors.onSurface }}>
              Sound
            </Text>
          </View>
          <Switch value={soundSettings.enabled} onValueChange={(value) => setSoundSettings({ enabled: value })} />
        </View>

        <View style={styles.section}>
          <Text variant='labelSmall' style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
            VERSION {release.otaVersion}
            {updateReady ? ' · UPDATE READY' : ''}
          </Text>
          <Button mode='outlined' onPress={check} loading={checking} disabled={checking}>
            Check for Updates
          </Button>
        </View>
      </Dialog.Content>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 24
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  rowStart: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  section: {
    gap: 12
  },
  sectionLabel: {
    letterSpacing: 2
  }
})
