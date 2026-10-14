import { GameMode, Player } from '@/types'

// Extracted so /loadout can parse its own mode route param the same way, without duplicating
// this ternary.
export function parseGameMode(value: string | undefined): GameMode {
  return value === 'vsCpu' ? 'vsCpu' : 'twoPlayer'
}

// CPU always plays player 2 (see useAIOpponent) - the human is player 1 whenever gameMode is
// 'vsCpu'. Takes just the gameMode field (not the full Settings) so /loadout can call this
// before it has assembled a complete settings object of its own.
export function humanPlayersFor(gameMode: GameMode): Player[] {
  return gameMode === 'vsCpu' ? [1] : [1, 2]
}
