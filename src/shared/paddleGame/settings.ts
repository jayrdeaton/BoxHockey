import { SCORE_TO_WIN } from '@/shared/paddleGame/constants/game'
import type { ControlScheme, Settings } from '@/shared/paddleGame/types'
import { createPlayerSettings } from '@/shared/playerSettings'

// Pong's defaults, minus what the shell keeps pack-wide (seat 2, Lock Orientation, Edge Guard) and
// what the game decides (bricks): what a player who hasn't changed a thing plays with.
export const DEFAULT_SETTINGS: Settings = {
  scoreToWin: SCORE_TO_WIN,
  aiDifficulty: 'medium',
  paddleSize: 'medium',
  ballSpeed: 'medium',
  // Asymmetric defaults (not both 'mouse') so two seats sharing one desktop's keyboard and mouse
  // don't start out colliding.
  controlScheme: { 1: 'mouse', 2: 'wasd' },
  tiltControlEnabled: false
}

// One paddle game's loadout, per player (shared/playerSettings.ts), under its own store keys: the
// match settings seat 1's player last set up (Paddles' paddlesSettings, Breaker's breakerSettings)
// and the controls each player last picked (paddlesControls, breakerControls). Two seats can't
// share the mouse or a key cluster, so when both players saved the same one, seat 2 takes the next
// free one in the loadout's menu order for that match.
export function createPaddleSettings(id: string) {
  return createPlayerSettings<Settings, ControlScheme>({ id, defaults: DEFAULT_SETTINGS, distinctControls: ['mouse', 'wasd', 'arrows', 'ijkl', 'numpad'] })
}
