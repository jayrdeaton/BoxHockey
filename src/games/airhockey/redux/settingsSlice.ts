import { createSettingsSlice } from '@rific/core'

import { SCORE_TO_WIN } from '@/games/airhockey/constants/game'
import type { Settings } from '@/games/airhockey/types'

// The persisted settings: a Redux slice like every other persisted value in this app, read and
// written only through hooks/useSettings.ts. Built on @rific/core's createSettingsSlice: `initialize`
// in 'merge' mode is the single write path (setSettings' partial patch), and its REHYDRATE handling
// fills any field added after a player's settings were saved from DEFAULT_SETTINGS, so no
// validation or migration is needed.
export const DEFAULT_SETTINGS: Settings = {
  scoreToWin: SCORE_TO_WIN,
  aiDifficulty: 'medium',
  friction: 'medium',
  puckSize: 'medium',
  paddleSize: 'medium',
  // On by default - see its own doc comment on Settings.
  rink: true,
  // Asymmetric defaults (not both 'mouse') so two seats sharing one desktop's keyboard/mouse don't
  // start out colliding - mirrors Snake's/Pong's identical reasoning for the same field.
  controlScheme: { 1: 'mouse', 2: 'wasd' }
}

const { actions, reducer } = createSettingsSlice<Settings, 'merge', never>('airhockeySettings', {
  initialState: DEFAULT_SETTINGS,
  initializeMode: 'merge',
  fieldSetters: []
})

export const settingsActions = actions
export default reducer
