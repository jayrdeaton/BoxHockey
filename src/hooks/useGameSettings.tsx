import { createGameSettingsProvider } from '@tastic/core'

import { GameSettings } from '@/types'
import { DEFAULT_SETTINGS, isValidSettings } from '@/utils/gameSettingsValidation'

// Hand-rolled GameSettingsProvider/useGameSettings replaced by @tastic/core's shared factory — see
// its own doc comment on createGameSettingsProvider for the full behavior (AsyncStorage-backed
// settings + setSettings, activeRoundSettings/commitRoundSettings round-start snapshot,
// isActivelyPlaying wired into @tastic/edge-guard's useEdgeGestureGuard). Confirmed byte-for-byte
// equivalent to this app's own prior implementation — nothing app-specific was lost in the move.
export const { GameSettingsProvider, useGameSettings } = createGameSettingsProvider<GameSettings>({
  storageKey: 'boxhockey.settings',
  defaultSettings: DEFAULT_SETTINGS,
  isValidSettings
})
