import { AutoAppearancePicker, Dialog, useAutoPaperTheme } from '@rific/auto-paper'
import { Button, SegmentedButtons, TouchableRipple, useHapticSettings, useSoundSettings } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { useUpdater } from '@rific/updater'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import { release } from '@/constants/release'
import { useGameSettings } from '@/hooks/useGameSettings'

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
  const { settings, setSettings } = useGameSettings()
  const { settings: hapticSettings, set: setHapticSettings } = useHapticSettings()
  const { settings: soundSettings, set: setSoundSettings } = useSoundSettings()
  const { error } = useToast()
  // autoCheck: false — the root layout (_layout.tsx) already runs the silent background check via
  // its own useUpdater() instance; a second instance with autoCheck's default (true) would set up
  // a second AppState listener and double every foreground-resume update check. This instance only
  // ever checks on an explicit tap of the button below.
  const { check, checking, updateReady } = useUpdater({ autoCheck: false, autoPrompt: false, onError: (message) => error('Update check failed', message) })

  return (
    <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
      <Dialog.Title>Settings</Dialog.Title>
      {/* react-native-paper's Dialog.ScrollArea has a fixed 24px marginBottom baked in (meant to
          reserve room for a Dialog.Actions row below it) — overridden to 0 since this dialog has
          no actions row, and that gap otherwise reads as unexplained empty footer space. */}
      <Dialog.ScrollArea style={styles.scrollArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Grouped tightly together (styles.toggleGroup's small internal gap, not the 24px gap
              between sections below) since both are the same bare-row shape — Sound only joins
              this group on web; elsewhere it's a full "SOUND & HAPTICS" section instead (see
              below), which already carries its own heading/spacing and reads fine standing apart. */}
          <View style={styles.toggleGroup}>
            <TouchableRipple onPress={() => setSettings({ lockOrientation: !settings.lockOrientation })} style={styles.toggleButton} accessibilityLabel={`Lock orientation ${settings.lockOrientation ? 'on' : 'off'}`}>
              <View style={styles.toggleContent}>
                <SettingIcon source={settings.lockOrientation ? 'lock' : 'lock-open-variant-outline'} color={settings.lockOrientation ? colors.secondary : colors.onSurfaceVariant} containerColor={settings.lockOrientation ? colors.secondaryContainer : colors.surfaceVariant} />
                <View style={styles.flexShrink}>
                  <Text variant='bodyLarge' style={{ color: colors.onSurface }}>
                    Lock Orientation
                  </Text>
                  <Text variant='bodySmall' numberOfLines={1} style={{ color: colors.onSurfaceVariant }}>
                    Pin the current layout instead of following the phone as it turns
                  </Text>
                </View>
              </View>
            </TouchableRipple>

            {Platform.OS === 'web' && (
              // No haptics on web at all — a `SegmentedButtons` with a single button renders as one
              // giant unbroken bar with no on/off contrast (nothing to segment against), which reads
              // as broken chrome rather than a toggle. A bare row matching Lock Orientation above
              // (no section heading — the row's own "Sound" label already says what it is, a
              // "SOUND" heading above it would just repeat that) reads correctly with one control.
              <TouchableRipple onPress={() => setSoundSettings({ enabled: !soundSettings.enabled })} style={styles.toggleButton} accessibilityLabel={`Sound ${soundSettings.enabled ? 'on' : 'off'}`}>
                <View style={styles.toggleContent}>
                  <SettingIcon source={soundSettings.enabled ? 'volume-high' : 'volume-off'} color={soundSettings.enabled ? colors.tertiary : colors.onSurfaceVariant} containerColor={soundSettings.enabled ? colors.tertiaryContainer : colors.surfaceVariant} />
                  <Text variant='bodyLarge' style={{ color: colors.onSurface }}>
                    Sound
                  </Text>
                </View>
              </TouchableRipple>
            )}
          </View>

          {Platform.OS !== 'web' && (
            <View style={styles.section}>
              <Text variant='labelMedium' style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
                SOUND & HAPTICS
              </Text>
              <SegmentedButtons
                multiSelect
                value={[...(soundSettings.enabled ? ['sound'] : []), ...(hapticSettings.vibrate ? ['haptics'] : [])]}
                onValueChange={(values) => {
                  setSoundSettings({ enabled: values.includes('sound') })
                  setHapticSettings({ vibrate: values.includes('haptics') })
                }}
                buttons={[
                  { value: 'sound', icon: 'volume-high' },
                  { value: 'haptics', icon: 'vibrate' }
                ]}
              />
            </View>
          )}

          <View style={styles.section}>
            <Text variant='labelMedium' style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
              APPEARANCE
            </Text>
            <AutoAppearancePicker showLabels={false} />
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
        </ScrollView>
      </Dialog.ScrollArea>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
    paddingVertical: 20
  },
  // Caps the card so it never grows past the screen — without this the dialog just keeps
  // growing to fit its content and the overflow gets clipped by the screen edge. Dialog.ScrollArea
  // + ScrollView above then take over and let the content scroll within that bound.
  dialog: {
    maxHeight: '90%'
  },
  flexShrink: {
    flexShrink: 1
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  scrollArea: {
    marginBottom: 0
  },
  section: {
    gap: 12
  },
  sectionLabel: {
    letterSpacing: 2
  },
  // Negative margin cancels the padding so the icon still lines up with APPEARANCE/SOUND &
  // HAPTICS below, while the ripple/hover highlight itself gets room to breathe on both sides
  // instead of a flush edge-to-edge slab. overflow: 'hidden' makes sure that highlight actually
  // clips to borderRadius instead of drawing as a plain rectangle.
  toggleButton: {
    borderRadius: 12,
    marginHorizontal: -12,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  toggleContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  toggleGroup: {
    gap: 4
  }
})
