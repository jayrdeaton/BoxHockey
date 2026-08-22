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
  orientationMode: 'portrait'
}

export function isValidSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<GameSettings>
  return (v.gameMode === 'twoPlayer' || v.gameMode === 'vsCpu') && (v.boardVariant === 'classic' || v.boardVariant === 'open' || v.boardVariant === 'gauntlet' || v.boardVariant === 'gravity') && typeof v.scoreToWin === 'number' && (v.aiDifficulty === 'easy' || v.aiDifficulty === 'medium' || v.aiDifficulty === 'hard') && (v.orientationMode === 'portrait' || v.orientationMode === 'landscape')
}
