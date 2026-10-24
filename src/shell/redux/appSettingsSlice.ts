import { createSettingsSlice } from '@rific/core'
import type { ViewRotation } from '@tastic/core'

// Settings that apply to the whole pack rather than one game. A game's own rules (board, score to
// win, controls) live in that game's own settings slice.
export interface AppSettings {
  // Lock Orientation: RootLayout's OrientationBridge hands it to @tastic/core's OrientationProvider
  // (freezeWhileLocked), which freezes the one shared orientation reading for every screen, every
  // board, dialogs and the status bar alike. Off by default: all of those just follow however the
  // device is actually being held.
  lockOrientation: boolean
  // The angle the lock is holding. Written by OrientationProvider's onLockChange (recorded on lock,
  // cleared on unlock) and handed back as lockInitialValue, so a relaunch reopens in the locked
  // orientation instead of portrait. Never set by the UI directly; absent while unlocked.
  lockedRotation?: ViewRotation
  // Edge Guard's opt-in (see Providers.tsx's EdgeGuardBridge).
  deferBottomEdgeGestures: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  lockOrientation: false,
  deferBottomEdgeGestures: false
}

// Merge mode, like every settings slice in the pack: REHYDRATE fills any field added since a
// player's settings were saved from the defaults.
const { actions, reducer } = createSettingsSlice<AppSettings, 'merge', never>('appSettings', {
  initialState: DEFAULT_APP_SETTINGS,
  initializeMode: 'merge',
  fieldSetters: []
})

export const appSettingsActions = actions
export default reducer
