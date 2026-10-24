import { SCORE_TO_WIN } from '@/games/airhockey/constants/game'
import type { ControlScheme, Settings } from '@/games/airhockey/types'
import { createPlayerSettings } from '@/shared/playerSettings'

// What a player who hasn't changed a thing plays with. Each player's own changes are saved over it
// (see below), so a field added later starts at its default for everyone.
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

// Air Hockey's loadout, per player (shared/playerSettings.ts): the match settings seat 1's player
// last set up, under airhockeySettings, and the controls each player last picked, under
// airhockeyControls. Two seats can't share the mouse or a key cluster, so when both players saved
// the same one, seat 2 takes the next free one in the loadout's menu order for that match.
export const playerSettings = createPlayerSettings<Settings, ControlScheme>({ id: 'airhockey', defaults: DEFAULT_SETTINGS, distinctControls: ['mouse', 'wasd', 'arrows', 'ijkl', 'numpad'] })
