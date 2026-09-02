import { SCORE_TO_WIN } from '@/constants/game'
import { GameSettings } from '@/types'

// Pulled out of hooks/useGameSettings.tsx specifically so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment (its native module is never linked there) — see useGameSettings.tsx's own import.
export const DEFAULT_SETTINGS: GameSettings = {
  gameMode: 'twoPlayer',
  boardVariant: 'classic',
  scoreToWin: SCORE_TO_WIN,
  aiDifficulty: 'medium',
  lockOrientation: false,
  // The real hockey rule, and the more distinctive of the two — the user wants it to be what new
  // players see first rather than the plainer coin-flip fallback.
  tipoffMode: 'faceoff',
  friction: 'medium',
  // 'off' by default — the game is meant to reward aiming BY FEEL, not by reading a predicted
  // bounce trajectory (the "old top-down pool game" look this default deliberately moves away
  // from). 'short'/'medium'/'long' stay fully available in the loadout for players who want the
  // assist; nothing about the setting itself was removed, only its default.
  shotPreviewLength: 'off',
  puckSize: 'medium',
  // 'low' matches STOP_THRESHOLD exactly (see INTERCEPT_SPEED_THRESHOLDS in constants/game.ts) —
  // mathematically an empty intercept window, so an existing stored settings blob (or a fresh
  // install) behaves exactly as before by default.
  interceptSpeed: 'low',
  // Both start on 'push' — swipe toward your shot, matching the new "swipe to hit, aim by feel"
  // default philosophy (see shotPreviewLength above). 'pull' (the original slingshot mechanic)
  // stays fully available per-player in the loadout for anyone who prefers it.
  controlScheme: { 1: 'push', 2: 'push' },
  // Off by default, matching every variant's original, pre-rink-work behavior — see its own doc
  // comment on GameSettings.
  rink: false,
  deferBottomEdgeGestures: false
}

function isValidControlScheme(value: unknown): value is 'pull' | 'push' {
  return value === 'pull' || value === 'push'
}

export function isValidSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<GameSettings>
  return (v.gameMode === 'twoPlayer' || v.gameMode === 'vsCpu') && (v.boardVariant === 'classic' || v.boardVariant === 'gauntlet' || v.boardVariant === 'gravity') && typeof v.scoreToWin === 'number' && (v.aiDifficulty === 'easy' || v.aiDifficulty === 'medium' || v.aiDifficulty === 'hard') && typeof v.lockOrientation === 'boolean' && (v.tipoffMode === 'coinFlip' || v.tipoffMode === 'faceoff') && (v.friction === 'low' || v.friction === 'medium' || v.friction === 'high') && (v.shotPreviewLength === 'off' || v.shotPreviewLength === 'short' || v.shotPreviewLength === 'medium' || v.shotPreviewLength === 'long') && (v.puckSize === 'small' || v.puckSize === 'medium' || v.puckSize === 'large') && (v.interceptSpeed === 'low' || v.interceptSpeed === 'medium' || v.interceptSpeed === 'high') && !!v.controlScheme && isValidControlScheme(v.controlScheme[1]) && isValidControlScheme(v.controlScheme[2]) && typeof v.rink === 'boolean' && typeof v.deferBottomEdgeGestures === 'boolean'
}
