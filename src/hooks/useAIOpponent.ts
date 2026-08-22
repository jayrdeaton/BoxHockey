import { useEffect } from 'react'

import { MAX_DRAG_PIXELS } from '@/constants/game'
import { BoardLayout, GameState, Player, PuckState } from '@/types'
import { AIDifficulty, planAIShot, randomAIThinkDelayMs } from '@/utils/aiOpponent'

interface AIControls {
  tryAimStart: (touchX: number, touchY: number, puck: PuckState, puckRadius: number) => boolean
  aimUpdate: (x: number, y: number) => void
  shoot: (dx: number, dy: number) => void
}

// Timing for the AI's own "pull back and release" — mirrors the human gesture (drag away from the
// puck, pause, release) rather than snapping straight to a computed velocity, so a CPU turn reads
// the same as a human one on Board.tsx (stick position + trajectory preview both come from `aim`).
const WINDUP_STEP_MS = 90
const RELEASE_PAUSE_MS = 180

// Drives a CPU-controlled seat by dispatching through the same tryAimStart/aimUpdate/shoot path a
// human drag uses — no reducer or physics changes needed, the AI just plays the existing gesture
// contract on the puck's behalf once it's `aiPlayer`'s turn.
export function useAIOpponent(state: GameState, board: BoardLayout, aiPlayer: Player | null, difficulty: AIDifficulty, controls: AIControls): void {
  const { tryAimStart, aimUpdate, shoot } = controls

  useEffect(() => {
    if (aiPlayer === null) return
    if (state.phase !== 'idle' || state.currentPlayer !== aiPlayer) return

    const puck = state.puck
    const shot = planAIShot(puck, board, aiPlayer, difficulty)
    const dragMag = shot.power * MAX_DRAG_PIXELS
    const dragX = -shot.fx * dragMag
    const dragY = -shot.fy * dragMag
    const targetX = puck.x + dragX
    const targetY = puck.y + dragY

    // Every scheduled step, including ones chained from inside an earlier step's callback, lands
    // in this same array — so the cleanup below reliably cancels the rest of an in-flight sequence
    // (e.g. a human grabbing the puck mid-"think") no matter which step it's currently on.
    const timers: ReturnType<typeof setTimeout>[] = []
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms))
    }

    after(randomAIThinkDelayMs(difficulty), () => {
      if (!tryAimStart(puck.x, puck.y, puck, board.puckRadius)) return
      after(WINDUP_STEP_MS, () => aimUpdate(puck.x + dragX * 0.55, puck.y + dragY * 0.55))
      after(WINDUP_STEP_MS * 2, () => aimUpdate(targetX, targetY))
      after(WINDUP_STEP_MS * 2 + RELEASE_PAUSE_MS, () => shoot(dragX, dragY))
    })

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [state.phase, state.currentPlayer, state.puck, aiPlayer, difficulty, board, tryAimStart, aimUpdate, shoot])
}
