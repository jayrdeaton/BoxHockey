import { useToast } from '@rific/toaster'
import { UpdateDialog as SharedUpdateDialog } from '@tastic/hud'

// Thin bridge onto the fleet-shared @tastic/hud UpdateDialog, which now owns the useUpdater()
// instance, the manifest/confirm bridging, and the themed ConfirmDialog rendering this file used
// to hand-roll itself. Kept as its own named export (rather than importing SharedUpdateDialog
// directly in _layout.tsx) purely so this app's own onError -> toast wiring has one place to live.
export function UpdateDialog() {
  const { error } = useToast()
  return <SharedUpdateDialog onError={(message) => error('Update check failed', message)} />
}
