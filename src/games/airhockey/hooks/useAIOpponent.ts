import { useEffect, useRef } from 'react'

import { BoardLayout, GameState, Player } from '@/games/airhockey/types'
import { AIDifficulty, computeAIPaddleTarget, rollAIJitter } from '@/games/airhockey/utils/aiOpponent'

// How many physics ticks a single rolled jitter offset is held before rolling a new one. Rolling
// fresh every tick (60/sec) picked a wholly new random aim direction each ~16ms, which reads as
// the paddle visibly vibrating in place rather than as human-like aim imprecision - holding one
// offset for a short burst of ticks, then jumping to a new one, reads as a natural hand tremor.
const JITTER_HOLD_TICKS = 15

// Re-runs every time state.puck changes - i.e. once per physics tick, since puck is a fresh
// object each TICK dispatch - so this hook itself IS the AI's per-tick decision point, riding
// the same cadence useGameState's own useGameLoop already drives rather than a separate rAF/
// interval loop of its own. `setPaddleTarget` is the EXACT SAME function TouchInputLayer's
// gesture callbacks call for a human - this is what preserves BoxHockey's "AI plays through the
// human's own input contract" principle at continuous granularity: the AI never touches
// PADDLE_TARGET dispatch, paddle velocity computation, or collision differently than a human's
// touch does, it only ever supplies a different SOURCE of target (x, y) coordinates.
export function useAIOpponent(state: GameState, board: BoardLayout, aiPlayer: Player | null, difficulty: AIDifficulty, paused: boolean, setPaddleTarget: (player: Player, x: number, y: number) => void): void {
  const jitterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const ticksUntilRerollRef = useRef(0)

  useEffect(() => {
    if (aiPlayer === null || paused || state.phase !== 'live') return
    if (ticksUntilRerollRef.current <= 0) {
      jitterRef.current = rollAIJitter(difficulty)
      ticksUntilRerollRef.current = JITTER_HOLD_TICKS
    }
    ticksUntilRerollRef.current -= 1
    const target = computeAIPaddleTarget(state.puck, state.paddles[aiPlayer], board, aiPlayer, difficulty, jitterRef.current)
    setPaddleTarget(aiPlayer, target.x, target.y)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.puck, state.phase, aiPlayer, difficulty, paused, board, setPaddleTarget])
}
