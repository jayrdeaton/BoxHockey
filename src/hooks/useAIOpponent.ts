import { useEffect } from 'react'

import { CONTROL_SCHEME_SIGN, MAX_DRAG_PIXELS } from '@/constants/game'
import { BoardLayout, ControlScheme, GameState, Player } from '@/types'
import { AIDifficulty, planAIShot, randomAIThinkDelayMs } from '@/utils/aiOpponent'

interface AIControls {
  tryAimStart: (touchX: number, touchY: number) => boolean
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
export function useAIOpponent(state: GameState, board: BoardLayout, aiPlayer: Player | null, difficulty: AIDifficulty, friction: number, controlScheme: Record<Player, ControlScheme>, paused: boolean, controls: AIControls): void {
  const { tryAimStart, aimUpdate, shoot } = controls

  // `paused` (settings/quit-confirm dialog open — see game.tsx) is only checked here, before
  // anything below has dispatched — safe to gate the whole chain on it at this single point
  // because game.tsx hides the corner buttons for the entire 'aiming'/'striking' window this
  // chain runs through once tryAimStart commits, so paused can't flip true again mid-windup.
  useEffect(() => {
    if (aiPlayer === null || paused) return
    if (state.phase !== 'idle' || state.currentPlayer !== aiPlayer) return

    const puck = state.puck
    const shot = planAIShot(puck, board, aiPlayer, difficulty, friction)
    const dragMag = shot.power * MAX_DRAG_PIXELS
    // useGameState's STRIKE case multiplies whatever drag is dispatched by this seat's own
    // ControlScheme sign (see CONTROL_SCHEME_SIGN) before it becomes a velocity — multiplying by
    // that same sign here is what cancels it back out, so the CPU's shot always lands along its
    // real intended direction (shot.fx, shot.fy) no matter which scheme this seat is set to. A
    // 'push' CPU ends up dragging TOWARD its own target (mirroring a human swiping there by hand);
    // a 'pull' one drags away from it, same as the original hardcoded `-shot.fx` did.
    const sign = CONTROL_SCHEME_SIGN[controlScheme[aiPlayer]]
    const dragX = sign * shot.fx * dragMag
    const dragY = sign * shot.fy * dragMag
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
      if (!tryAimStart(puck.x, puck.y)) return
      after(WINDUP_STEP_MS, () => aimUpdate(puck.x + dragX * 0.55, puck.y + dragY * 0.55))
      after(WINDUP_STEP_MS * 2, () => aimUpdate(targetX, targetY))
      after(WINDUP_STEP_MS * 2 + RELEASE_PAUSE_MS, () => shoot(dragX, dragY))
    })

    return () => {
      timers.forEach(clearTimeout)
    }
    // state.phase is deliberately omitted: tryAimStart/shoot above dispatch AIM_START/STRIKE,
    // which flip phase through 'aiming'/'striking' as an expected result of this very effect. If
    // phase were a dep, that self-triggered change would tear this effect down mid-sequence —
    // cancelling the windup/shoot timers just scheduled onto the same `timers` array before they
    // fire, stranding the CPU in 'aiming' forever. state.puck already gets a new object reference
    // at every point a fresh CPU turn should actually start (a physics stop, a reset, a faceoff
    // launch) and stays stable through the CPU's own aiming/striking, so it's the correct trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentPlayer, state.puck, aiPlayer, difficulty, friction, controlScheme, board, tryAimStart, aimUpdate, shoot, paused])
}
