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
  shotPreviewLength: 'medium',
  puckSize: 'medium'
}

export function isValidSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<GameSettings>
  return (v.gameMode === 'twoPlayer' || v.gameMode === 'vsCpu') && (v.boardVariant === 'classic' || v.boardVariant === 'gauntlet' || v.boardVariant === 'gravity') && typeof v.scoreToWin === 'number' && (v.aiDifficulty === 'easy' || v.aiDifficulty === 'medium' || v.aiDifficulty === 'hard') && typeof v.lockOrientation === 'boolean' && (v.tipoffMode === 'coinFlip' || v.tipoffMode === 'faceoff') && (v.friction === 'low' || v.friction === 'medium' || v.friction === 'high') && (v.shotPreviewLength === 'off' || v.shotPreviewLength === 'short' || v.shotPreviewLength === 'medium' || v.shotPreviewLength === 'long') && (v.puckSize === 'small' || v.puckSize === 'medium' || v.puckSize === 'large')
}
