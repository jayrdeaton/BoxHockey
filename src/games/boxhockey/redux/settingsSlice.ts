import { SCORE_TO_WIN } from '@/games/boxhockey/constants/game'
import type { ControlScheme, Settings } from '@/games/boxhockey/types'
import { createPlayerSettings } from '@/shared/playerSettings'

// What a player who hasn't changed a thing plays with. Each player's own changes are saved over it
// (see below), so a field added later starts at its default for everyone.
export const DEFAULT_SETTINGS: Settings = {
  boardVariant: 'classic',
  scoreToWin: SCORE_TO_WIN,
  aiDifficulty: 'medium',
  // The real hockey rule, and the more distinctive of the two - the user wants it to be what new
  // players see first rather than the plainer coin-flip fallback.
  tipoffMode: 'faceoff',
  friction: 'medium',
  // 'off' by default - the game is meant to reward aiming BY FEEL, not by reading a predicted
  // bounce trajectory (the "old top-down pool game" look this default deliberately moves away
  // from). 'short'/'medium'/'long' stay fully available in the loadout for players who want the
  // assist; nothing about the setting itself was removed, only its default.
  shotPreviewLength: 'off',
  puckSize: 'medium',
  // 'low' matches STOP_THRESHOLD exactly (see INTERCEPT_SPEED_THRESHOLDS in constants/game.ts) -
  // mathematically an empty intercept window, so an existing stored settings blob (or a fresh
  // install) behaves exactly as before by default.
  interceptSpeed: 'low',
  // Both start on 'flick' - swipe fast to fire, matching the new "swipe to hit, aim by feel"
  // default philosophy (see shotPreviewLength above). 'pull' (the original slingshot mechanic) and
  // 'push' (the same distance-based mechanic, opposite direction) both stay fully available
  // per-player in the loadout for anyone who prefers a stick-and-drag feel over a flick.
  controlScheme: { 1: 'flick', 2: 'flick' },
  // Off by default, matching every variant's original, pre-rink-work behavior - see its own doc
  // comment on Settings.
  rink: false
}

// Box Hockey's loadout, per player (shared/playerSettings.ts): the match settings seat 1's player
// last set up, under boxhockeySettings, and the shot style each player last picked, under
// boxhockeyControls. Shot styles aren't a shared resource the way a keyboard's key clusters are,
// so both seats can play the same one.
export const playerSettings = createPlayerSettings<Settings, ControlScheme>({ id: 'boxhockey', defaults: DEFAULT_SETTINGS })
