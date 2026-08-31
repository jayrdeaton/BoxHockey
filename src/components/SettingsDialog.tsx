import { AutoAppearancePicker, Dialog, useAutoPaperTheme } from '@rific/auto-paper'
import { Button, SoundContext, TouchableRipple, useHapticSettings, useSoundSettings, useVibration } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { useUpdater } from '@rific/updater'
import { useContext, useState } from 'react'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'
import { Icon, Portal, Text } from 'react-native-paper'

import { MONO_FONT } from '@/constants/fonts'
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
  // Live physical-hold rotation (see @tastic/split-screen's getViewRotation) — this dialog renders
  // as a centered Portal modal, unaffected by whichever screen's own FakeLandscapeView wraps its
  // trigger, so it has to rotate its own card content to read right-side-up for whichever way the
  // phone is actually being held. Defaults to 0 (unrotated) for any caller that doesn't track it.
  rotation?: number
}

export function SettingsDialog({ visible, onDismiss, rotation = 0 }: SettingsDialogProps) {
  const { dark, colors } = useAutoPaperTheme()
  const { settings, setSettings } = useGameSettings()
  const { settings: hapticSettings, set: setHapticSettings } = useHapticSettings()
  const { settings: soundSettings, set: setSoundSettings } = useSoundSettings()
  // Sound/Haptics toggle themselves: the ripple's automatic press feedback fires on onPressIn,
  // before onPress applies the toggle, so it reflects the OLD enabled value — backwards from what
  // a settings toggle should confirm (turning off would click/buzz, turning on would go silent).
  // Both rows disable their own automatic channel below (soundDisabled/hapticDisabled) and fire it
  // manually here instead, gated on the NEW value so it only plays when switching that channel on.
  const sound = useContext(SoundContext)
  const { forceShort: forceHapticFeedback } = useVibration()
  const { error } = useToast()
  // Covers check()'s three purely-informational cases (dev-mode disabled, web unsupported, no
  // update found) via onInfo below — same retro card treatment as UpdateDialog's confirm prompt,
  // instead of the native Alert.alert those cases fall back to by default.
  const [infoMessage, setInfoMessage] = useState<{ title: string; message: string } | null>(null)
  // autoCheck: false — the root layout (_layout.tsx) already runs the silent background check via
  // its own useUpdater() instance; a second instance with autoCheck's default (true) would set up
  // a second AppState listener and double every foreground-resume update check. This instance only
  // ever checks on an explicit tap of the button below.
  const { check, checking, updateReady } = useUpdater({
    autoCheck: false,
    autoPrompt: false,
    onError: (message) => error('Update check failed', message),
    onInfo: (title, message) => setInfoMessage({ title, message })
  })

  // High-contrast retro look, matching UpdateDialog/game.tsx: literal black/white by appearance,
  // not auto-paper's own (slightly tinted) background role.
  const fg = dark ? '#FFFFFF' : '#000000'
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'

  return (
    <>
      <Dialog visible={visible} onDismiss={onDismiss} style={[styles.dialog, rotation % 360 !== 0 && { transform: [{ rotate: `${rotation}deg` }] }]}>
        <Dialog.Title>Settings</Dialog.Title>
        {/* react-native-paper's Dialog.ScrollArea has a fixed 24px marginBottom baked in (meant to
          reserve room for a Dialog.Actions row below it) — overridden to 0 since this dialog has
          no actions row, and that gap otherwise reads as unexplained empty footer space. */}
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Grouped tightly together (styles.toggleGroup's small internal gap, not the 24px gap
              between sections below) — same bare-row shape for all three, no segmented control and
              no section heading (each row's own label already says what it is). Haptics only joins
              on native — there's nothing for it to control on web. */}
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

              {/* Side by side, not stacked — neither needs a full row's width (single-line label,
                no description under it the way Lock Orientation has), so sharing one row reads
                just as clearly and takes half the vertical space. toggleRow carries the same
                edge-alignment negative margin toggleButton normally carries itself; the buttons
                inside it use toggleButtonInRow (flex: 1) instead so the two don't double up on it. */}
              <View style={styles.toggleRow}>
                <TouchableRipple
                  soundDisabled
                  onPress={() => {
                    const enabled = !soundSettings.enabled
                    setSoundSettings({ enabled })
                    if (enabled) sound.selection?.()
                  }}
                  style={styles.toggleButtonInRow}
                  accessibilityLabel={`Sound ${soundSettings.enabled ? 'on' : 'off'}`}
                >
                  <View style={styles.toggleContent}>
                    <SettingIcon source={soundSettings.enabled ? 'volume-high' : 'volume-off'} color={soundSettings.enabled ? colors.tertiary : colors.onSurfaceVariant} containerColor={soundSettings.enabled ? colors.tertiaryContainer : colors.surfaceVariant} />
                    <Text variant='bodyLarge' style={{ color: colors.onSurface }}>
                      Sound
                    </Text>
                  </View>
                </TouchableRipple>

                {Platform.OS !== 'web' && (
                  <TouchableRipple
                    hapticDisabled
                    onPress={() => {
                      const vibrate = !hapticSettings.vibrate
                      setHapticSettings({ vibrate })
                      if (vibrate) forceHapticFeedback()
                    }}
                    style={styles.toggleButtonInRow}
                    accessibilityLabel={`Haptics ${hapticSettings.vibrate ? 'on' : 'off'}`}
                  >
                    <View style={styles.toggleContent}>
                      <SettingIcon source={hapticSettings.vibrate ? 'vibrate' : 'vibrate-off'} color={hapticSettings.vibrate ? colors.tertiary : colors.onSurfaceVariant} containerColor={hapticSettings.vibrate ? colors.tertiaryContainer : colors.surfaceVariant} />
                      <Text variant='bodyLarge' style={{ color: colors.onSurface }}>
                        Haptics
                      </Text>
                    </View>
                  </TouchableRipple>
                )}
              </View>
            </View>

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
      {infoMessage && (
        <Portal>
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <Icon source='information-outline' size={64} color={colors.secondary} />
              <Text variant='headlineLarge' style={[styles.overlayTitle, { color: colors.secondary, fontFamily: MONO_FONT }]}>
                {infoMessage.title}
              </Text>
              <Text variant='bodyLarge' style={[styles.overlayBody, { color: fg, fontFamily: MONO_FONT }]}>
                {infoMessage.message}
              </Text>
              <Button mode='contained' onPress={() => setInfoMessage(null)} style={styles.overlayButton} buttonColor={colors.primary} textColor={colors.onPrimary}>
                OK
              </Button>
            </View>
          </View>
        </Portal>
      )}
    </>
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
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  overlayBody: { textAlign: 'center' },
  overlayButton: { width: 160 },
  overlayCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    padding: 32
  },
  overlayTitle: { fontWeight: 'bold' },
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
  // Same shape as toggleButton but `flex: 1` instead of its own `marginHorizontal: -12` — two of
  // these side by side in toggleRow would otherwise both pull inward and collide in the middle.
  // toggleRow carries that edge-alignment margin once, for the row as a whole, instead.
  toggleButtonInRow: {
    borderRadius: 12,
    flex: 1,
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
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: -12
  }
})
