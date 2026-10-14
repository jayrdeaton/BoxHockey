import { useEffect, useRef } from 'react'

import { CONTROL_SCHEME_SIGN, MAX_FLICK_VELOCITY, MAX_STICK_PULLBACK_PIXELS } from '@/constants/game'
import { BoardLayout, ControlScheme, GameState, Player, PuckState } from '@/types'
import { AIDifficulty, planAIShot, randomAIThinkDelayMs, randomInterceptReactionMs } from '@/utils/aiOpponent'

interface AIControls {
  tryAimStart: (touchX: number, touchY: number) => boolean
  aimUpdate: (x: number, y: number, vx: number, vy: number) => void
  shoot: (dx: number, dy: number, vx: number, vy: number) => void
}

// Timing for the AI's own "pull back and release" - mirrors the human gesture (drag away from the
// puck, pause, release) rather than snapping straight to a computed velocity, so a CPU turn reads
// the same as a human one on Board.tsx (stick position + trajectory preview both come from `aim`).
const WINDUP_STEP_MS = 90
const RELEASE_PAUSE_MS = 180

function otherPlayer(p: Player): Player {
  return p === 1 ? 2 : 1
}

// Drives a CPU-controlled seat by dispatching through the same tryAimStart/aimUpdate/shoot path a
// human drag uses - no reducer or physics changes needed, the AI just plays the existing gesture
// contract on the puck's behalf once it's `aiPlayer`'s turn.
export function useAIOpponent(state: GameState, board: BoardLayout, aiPlayer: Player | null, difficulty: AIDifficulty, friction: number, controlScheme: Record<Player, ControlScheme>, paused: boolean, interceptThreshold: number, controls: AIControls): void {
  const { tryAimStart, aimUpdate, shoot } = controls

  // Mirrored every render (same discipline as this codebase's other rapidly-churning-state refs -
  // e.g. game.tsx's faceoffRef) so the intercept effect below can read the FRESHEST puck position
  // at each scheduled step, not a stale one captured back when eligibility first fired.
  const puckRef = useRef(state.puck)
  useEffect(() => {
    puckRef.current = state.puck
  })

  // `paused` (settings/quit-confirm dialog open - see game.tsx) is only checked here, before
  // anything below has dispatched - safe to gate the whole chain on it at this single point
  // because game.tsx hides the corner buttons for the entire 'aiming'/'striking' window this
  // chain runs through once tryAimStart commits, so a dialog can't open again mid-windup. A
  // background pause still can, so game.tsx cancels the aim then, and this effect plans a fresh
  // shot from 'idle' once play resumes.
  useEffect(() => {
    if (aiPlayer === null || paused) return
    if (state.phase !== 'idle' || state.currentPlayer !== aiPlayer) return

    const puck = state.puck
    const shot = planAIShot(puck, board, aiPlayer, difficulty, friction)
    // Two separate magnitudes from the same shot.power now that drag distance and shot power are
    // no longer the same quantity: dragMag is purely visual (how far the CPU's paddle animates
    // toward, capped at MAX_STICK_PULLBACK_PIXELS - same cap Board.tsx's own stick uses); velMag is
    // the actual shot magnitude fed into shoot(), capped at MAX_FLICK_VELOCITY. Using dragMag's old
    // pixel-space cap for the shot itself would send the paddle's windup target thousands of pixels
    // off-board while leaving the real shot correctly scaled, or vice versa - they must stay split.
    const dragMag = shot.power * MAX_STICK_PULLBACK_PIXELS
    const velMag = shot.power * MAX_FLICK_VELOCITY
    // useGameState's STRIKE case multiplies whatever velocity is dispatched by this seat's own
    // ControlScheme sign (see CONTROL_SCHEME_SIGN) before it becomes a launch vector - multiplying
    // by that same sign here is what cancels it back out, so the CPU's shot always lands along its
    // real intended direction (shot.fx, shot.fy) no matter which scheme this seat is set to. A
    // 'push' CPU ends up dragging TOWARD its own target (mirroring a human swiping there by hand);
    // a 'pull' one drags away from it, same as the original hardcoded `-shot.fx` did.
    const sign = CONTROL_SCHEME_SIGN[controlScheme[aiPlayer]]
    const dragX = sign * shot.fx * dragMag
    const dragY = sign * shot.fy * dragMag
    const targetX = puck.x + dragX
    const targetY = puck.y + dragY
    // Constant for the whole windup, not ramped - the CPU has no per-frame gesture noise to smooth
    // out the way a human's live velocity reading does, so its own stick/chevron preview can just
    // read its true intended power from the first windup frame on.
    const velX = sign * shot.fx * velMag
    const velY = sign * shot.fy * velMag

    // Every scheduled step, including ones chained from inside an earlier step's callback, lands
    // in this same array - so the cleanup below reliably cancels the rest of an in-flight sequence
    // (e.g. a human grabbing the puck mid-"think") no matter which step it's currently on.
    const timers: ReturnType<typeof setTimeout>[] = []
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms))
    }

    after(randomAIThinkDelayMs(difficulty), () => {
      if (!tryAimStart(puck.x, puck.y)) return
      after(WINDUP_STEP_MS, () => aimUpdate(puck.x + dragX * 0.55, puck.y + dragY * 0.55, velX, velY))
      after(WINDUP_STEP_MS * 2, () => aimUpdate(targetX, targetY, velX, velY))
      after(WINDUP_STEP_MS * 2 + RELEASE_PAUSE_MS, () => shoot(dragX, dragY, velX, velY))
    })

    return () => {
      timers.forEach(clearTimeout)
    }
    // state.phase is deliberately omitted: tryAimStart/shoot above dispatch AIM_START/STRIKE,
    // which flip phase through 'aiming'/'striking' as an expected result of this very effect. If
    // phase were a dep, that self-triggered change would tear this effect down mid-sequence -
    // cancelling the windup/shoot timers just scheduled onto the same `timers` array before they
    // fire, stranding the CPU in 'aiming' forever. state.puck already gets a new object reference
    // at every point a fresh CPU turn should actually start (a physics stop, a reset, a faceoff
    // launch) and stays stable through the CPU's own aiming/striking, so it's the correct trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentPlayer, state.puck, aiPlayer, difficulty, friction, controlScheme, board, tryAimStart, aimUpdate, shoot, paused])

  // Mid-slide intercept - see InterceptSpeed in types/index.ts. A SEPARATE effect from the one
  // above, not a second branch inside it: that effect's own deliberate omission of state.phase
  // (see its comment) relies on state.puck only getting a fresh reference once per turn while
  // 'idle' - but state.puck changes on every single PHYSICS_STEP frame throughout 'simulating', so
  // depending on it directly here would tear down and reschedule this effect's timers every ~16ms,
  // and the reaction delay below would never actually complete. Fix: depend on a derived PRIMITIVE
  // boolean instead (isInterceptEligible), which only flips value on a real false→true/true→false
  // edge, not every frame the puck happens to still be moving.
  const speed = Math.hypot(state.puck.vx, state.puck.vy)
  const hasInterceptAim = state.interceptAim !== null
  // The `hasInterceptAim ||` term matters: without it, a gravity well transiently re-accelerating
  // the puck back above interceptThreshold AFTER this CPU has already committed to an intercept
  // would flip this boolean back to false and cancel the still-pending aimUpdate/shoot timers
  // mid-swing - a real CPU shot silently vanishing mid-windup for no visible reason.
  const isInterceptEligible = aiPlayer !== null && !paused && state.phase === 'simulating' && otherPlayer(state.currentPlayer) === aiPlayer && (hasInterceptAim || speed < interceptThreshold)

  useEffect(() => {
    if (!isInterceptEligible || aiPlayer === null) return

    const timers: ReturnType<typeof setTimeout>[] = []
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms))
    }

    after(randomInterceptReactionMs(difficulty), () => {
      // Re-planned HERE, against the freshest puck available, rather than at the top of this
      // effect - the puck keeps coasting for the whole reaction delay by design (that's the
      // entire feature), so planning against whatever position triggered eligibility would already
      // be stale by the time this fires. The subsequent ~360ms windup below can still drift a
      // little further (accepted, documented limitation - see PLAN); shot.fx/fy/power is a
      // direction/magnitude, not a target position, so the ACTUAL shot vector is unaffected either
      // way, only the cosmetic paddle-pullback target below.
      const freshPuck: PuckState = puckRef.current
      const shot = planAIShot(freshPuck, board, aiPlayer, difficulty, friction)
      const dragMag = shot.power * MAX_STICK_PULLBACK_PIXELS
      const velMag = shot.power * MAX_FLICK_VELOCITY
      const sign = CONTROL_SCHEME_SIGN[controlScheme[aiPlayer]]
      const dragX = sign * shot.fx * dragMag
      const dragY = sign * shot.fy * dragMag
      const velX = sign * shot.fx * velMag
      const velY = sign * shot.fy * velMag

      if (!tryAimStart(freshPuck.x, freshPuck.y)) return
      after(WINDUP_STEP_MS, () => aimUpdate(puckRef.current.x + dragX * 0.55, puckRef.current.y + dragY * 0.55, velX, velY))
      after(WINDUP_STEP_MS * 2, () => aimUpdate(puckRef.current.x + dragX, puckRef.current.y + dragY, velX, velY))
      after(WINDUP_STEP_MS * 2 + RELEASE_PAUSE_MS, () => shoot(dragX, dragY, velX, velY))
    })

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [isInterceptEligible, aiPlayer, difficulty, friction, controlScheme, board, tryAimStart, aimUpdate, shoot])
}
