import { useToast } from '@rific/toaster'
import { BaseSettingsDialog } from '@tastic/hud'

import { release } from '@/constants/release'
import { useGameSettings } from '@/hooks/useGameSettings'

export interface SettingsDialogProps {
  visible: boolean
  onDismiss: () => void
  // Live physical-hold rotation (see @tastic/split-screen's getViewRotation) — this dialog renders
  // as a centered Portal modal, unaffected by whichever screen's own FakeLandscapeView wraps its
  // trigger, so it has to rotate its own card content to read right-side-up for whichever way the
  // phone is actually being held. Defaults to 0 (unrotated) for any caller that doesn't track it.
  rotation?: number
}

// Thin adapter over @tastic/hud's shared settings shell — BoxHockey's own GameSettings (lock
// orientation, edge guard) is the only thing that varies here; everything else (sound, haptics,
// appearance, update checking) is identical across every app using BaseSettingsDialog and lives
// entirely inside that package now. Keeps this file's own external props unchanged so none of its
// three call sites (index.tsx, game.tsx, loadout.tsx) needed to change.
export function SettingsDialog({ visible, onDismiss, rotation = 0 }: SettingsDialogProps) {
  const { settings, setSettings } = useGameSettings()
  const { error } = useToast()

  return <BaseSettingsDialog visible={visible} onDismiss={onDismiss} rotation={rotation} version={release.otaVersion} lockOrientation={settings.lockOrientation} onLockOrientationChange={(value) => setSettings({ lockOrientation: value })} deferBottomEdgeGestures={settings.deferBottomEdgeGestures} onDeferBottomEdgeGestures={(value) => setSettings({ deferBottomEdgeGestures: value })} onUpdateError={(message) => error('Update check failed', message)} />
}
