import { useUpdateErrorToast } from '@rific/toaster'
import { ViewRotation } from '@tastic/core'
import { BaseSettingsDialog } from '@tastic/hud'

import { release } from '@/constants/release'
import { useAppSettings } from '@/shell/hooks/useAppSettings'

export interface SettingsDialogProps {
  visible: boolean
  onDismiss: () => void
  // Live physical-hold rotation (see @tastic/core's useRotation). BaseSettingsDialog lays the sheet
  // out in its own frame turned by this (see @tastic/hud's RotatedFrame), so it reads right-side-up
  // and fits the short edge however the phone is held. Defaults to 0 for a call site that doesn't
  // track one.
  rotation?: ViewRotation
  // Shows the How to Play row, which opens this game's cards (a loadout passes its game's opener).
  // Left out on Home, where each tile's rules button does it, and in a match, where opening
  // Settings pauses play.
  onShowHowToPlay?: () => void
}

// The pack-wide Settings dialog: everything in it applies to every game (Lock Orientation, Edge
// Guard, theme, sound, haptics, Keep Awake), so it reads and writes the app settings itself.
export function SettingsDialog({ visible, onDismiss, rotation = 0, onShowHowToPlay }: SettingsDialogProps) {
  const onUpdateError = useUpdateErrorToast()
  const { settings, setSettings } = useAppSettings()

  return <BaseSettingsDialog visible={visible} onDismiss={onDismiss} rotation={rotation} version={release.otaVersion} lockOrientation={settings.lockOrientation} onLockOrientationChange={(value) => setSettings({ lockOrientation: value })} deferBottomEdgeGestures={settings.deferBottomEdgeGestures} onDeferBottomEdgeGestures={(value) => setSettings({ deferBottomEdgeGestures: value })} onUpdateError={onUpdateError} onShowHowToPlay={onShowHowToPlay} />
}
