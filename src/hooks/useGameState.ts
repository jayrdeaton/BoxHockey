import { useGameLoop } from '@tastic/core'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { AIM_VELOCITY_SMOOTHING_ALPHA, CONTROL_SCHEME_SIGN, FACEOFF_GUESS_BONUS_MS, FACEOFF_MARGIN_MAX_MS, FACEOFF_REACTION_MAX_MS, MAX_FLICK_VELOCITY, MAX_SPEED, MAX_STICK_PULLBACK_PIXELS, MIN_FLICK_VELOCITY, MIN_SHOOT_DRAG, TRIPLE_TAP_MAX_DRAG_PIXELS } from '@/constants/game'
import { BoardLayout, ControlScheme, FaceoffState, GameState, Player, PuckState, TipoffMode, TripleTapState } from '@/types'
import { centerPuck, faceoffZoneCenter } from '@/utils/board'
import { computeAimVector, stepPhysics } from '@/utils/physics'

type Action =
  | { type: 'AIM_START'; x: number; y: number }
  | { type: 'AIM_UPDATE'; x: number; y: number; vx: number; vy: number }
  | { type: 'AIM_CANCEL' }
  | { type: 'STRIKE'; dx: number; dy: number; vx: number; vy: number }
  | { type: 'APPLY_STRIKE' }
  | { type: 'PHYSICS_STEP'; board: BoardLayout; dt: number; interceptTouch: { x: number; y: number; vx: number; vy: number } | null }
  | { type: 'NEXT_ROUND'; board: BoardLayout; zoneIndex: 0 | 1; faceoffZones: [0 | 1, 0 | 1]; faceoffReadyGuess: [0 | 1, 0 | 1] }
  | { type: 'RESET'; board: BoardLayout; coinFlipWinner: Player; zoneIndex: 0 | 1; faceoffZones: [0 | 1, 0 | 1]; faceoffReadyGuess: [0 | 1, 0 | 1] }
  | { type: 'COIN_FLIP_DONE' }
  | { type: 'FACEOFF_COUNT'; count: 2 | 1 }
  | { type: 'FACEOFF_HOLD'; goAt: number }
  | { type: 'FACEOFF_LIVE' }
  | { type: 'FACEOFF_READY'; player: Player }
  | { type: 'FACEOFF_TAP'; player: Player; atMs: number; zoneIndex: 0 | 1 }
  | { type: 'FACEOFF_TIMEOUT'; player: Player }
  | { type: 'FACEOFF_LAUNCH'; vx: number; vy: number }
  | { type: 'FACEOFF_RESTART' }
  | { type: 'TRIPLE_TAP_PRESS'; player: Player; atMs: number }
  | { type: 'TRIPLE_TAP_SWIPE_START'; player: Player; atMs: number }
  | { type: 'TRIPLE_TAP_SWIPE_END'; player: Player; dx: number; dy: number }
  | { type: 'TRIPLE_TAP_LAUNCH'; vx: number; vy: number }

function otherPlayer(p: Player): Player {
  return p === 1 ? 2 : 1
}

// One-pole EMA for the live (display-only) velocity shown on AimIndicator.vx/vy — see
// AIM_VELOCITY_SMOOTHING_ALPHA's own comment in constants/game.ts. Never used for the actual shot,
// which reads the raw velocity straight off the release gesture event instead (see STRIKE below).
function smoothVelocity(prevVx: number, prevVy: number, rawVx: number, rawVy: number): { vx: number; vy: number } {
  return { vx: prevVx + AIM_VELOCITY_SMOOTHING_ALPHA * (rawVx - prevVx), vy: prevVy + AIM_VELOCITY_SMOOTHING_ALPHA * (rawVy - prevVy) }
}

// 'flick' scheme's own gate, factored out so game.tsx's auto-commit timer (see
// MAX_FLICK_GESTURE_MS in constants/game.ts) can check a synthesized "held too long" release
// against the exact same rule a real release is judged by, rather than duplicating the comparison.
export function passesFlickShotGate(dist: number, speed: number): boolean {
  return dist >= MIN_SHOOT_DRAG && speed >= MIN_FLICK_VELOCITY
}

// The one place a ControlScheme's power model actually branches — see ControlScheme's own doc
// comment in types/index.ts. 'pull'/'push' are distance-based: dx/dy (the finger's net
// displacement) drives power, up to MAX_STICK_PULLBACK_PIXELS; the release velocity (vx/vy) is
// ignored entirely. 'flick' is velocity-based: vx/vy (raw release speed) drives power, up to
// MAX_FLICK_VELOCITY, and is gated by BOTH a distance AND a speed floor (see passesFlickShotGate
// above for why flick needs both). Returns null when the gesture is too weak to count as a real
// shot — the caller's job is to treat that exactly like AIM_CANCEL.
function resolveStrikeVelocity(scheme: ControlScheme, dx: number, dy: number, vx: number, vy: number): { vx: number; vy: number } | null {
  const sign = CONTROL_SCHEME_SIGN[scheme]
  const dist = Math.hypot(dx, dy)
  if (scheme === 'flick') {
    if (!passesFlickShotGate(dist, Math.hypot(vx, vy))) return null
    const result = computeAimVector(sign * vx, sign * vy, MAX_FLICK_VELOCITY, MAX_SPEED)
    return { vx: result.vx, vy: result.vy }
  }
  if (dist < MIN_SHOOT_DRAG) return null
  const result = computeAimVector(sign * dx, sign * dy, MAX_STICK_PULLBACK_PIXELS, MAX_SPEED)
  return { vx: result.vx, vy: result.vy }
}

// 'tripleTap' mode's third-press swipe -> a per-player bounded velocity (see TipoffMode's own doc
// comment in types/index.ts). Always distance-based, unsigned (sign=1, no pull/push inversion) —
// the raw drag direction a player actually swipes IS the shot direction, no procedural bias toward
// either goal the way computeFaceoffKnock's jitter model applies one. No MIN_SHOOT_DRAG-style
// floor: even a near-zero release still counts as a captured (near-zero) swipe rather than a
// cancel, since this mode waits patiently for exactly one swipe per player, not a re-triable drag.
function resolveTripleTapSwipeVelocity(dx: number, dy: number): { vx: number; vy: number } {
  const result = computeAimVector(dx, dy, TRIPLE_TAP_MAX_DRAG_PIXELS, MAX_SPEED)
  return { vx: result.vx, vy: result.vy }
}

// Shared by APPLY_STRIKE (pull/push's windup handoff) and STRIKE's flick fast-path below — a real
// slap shot/one-timer redirect is faster when the puck is already moving your way, not purely a
// function of how hard you swung, so this always ADDS onto the puck's existing velocity rather
// than overwriting it. Clamped to MAX_SPEED so a full-power swing onto an already-fast puck can't
// quietly exceed the one speed ceiling the rest of the codebase assumes (substep budgeting, AI shot
// planning).
// Exported so it's directly unit-testable in isolation (see tripleTap.test.ts) — also the exact
// combine step 'tripleTap' mode's TRIPLE_TAP_SWIPE_END case below reuses for summing both players'
// swipe vectors into one launch velocity.
export function combineAndClampVelocity(puckVx: number, puckVy: number, shotVx: number, shotVy: number): { vx: number; vy: number } {
  const combinedVx = puckVx + shotVx
  const combinedVy = puckVy + shotVy
  const combinedSpeed = Math.hypot(combinedVx, combinedVy)
  const speedScale = combinedSpeed > MAX_SPEED ? MAX_SPEED / combinedSpeed : 1
  return { vx: combinedVx * speedScale, vy: combinedVy * speedScale }
}

// Coin-flip randomness lives here, at the call sites below (RESET/NEXT_ROUND dispatch and the
// lazy initial-state), never inside the reducer itself — same discipline as dt/goAt/atMs already
// being caller-supplied rather than computed inside a reducer case.
function randomPlayer(): Player {
  return Math.random() < 0.5 ? 1 : 2
}

function randomZoneIndex(): 0 | 1 {
  return Math.random() < 0.5 ? 0 : 1
}

function randomFaceoffZones(): [0 | 1, 0 | 1] {
  return [randomZoneIndex(), randomZoneIndex()]
}

// readyGuess's own blind coin-flip per player (see its doc comment in types/index.ts) — a separate
// call from randomFaceoffZones so it's plain to see at each call site that the two are independent
// draws of randomness, not the same roll reused.
function randomReadyGuess(): [0 | 1, 0 | 1] {
  return [randomZoneIndex(), randomZoneIndex()]
}

// Every draw opens on 'ready' now (see FaceoffState's doc comment) — both players have to signal
// before the countdown starts, not just on the game's first draw.
function initialFaceoffState(zones: [0 | 1, 0 | 1], readyGuess: [0 | 1, 0 | 1]): FaceoffState {
  return {
    stage: 'ready',
    ready: [false, false],
    count: null,
    zones,
    readyGuess,
    goAt: null,
    tapAt: [null, null] as [number | null, number | null],
    disqualified: [false, false],
    pressFlash: [null, null] as [number | null, number | null],
    result: null
  }
}

// No caller-supplied randomness needed (unlike initialFaceoffState) — 'tripleTap' has a single
// zone per player, so there's nothing to randomize per draw.
function initialTripleTapState(): TripleTapState {
  return {
    tapCount: [0, 0],
    pressFlash: [null, null] as [number | null, number | null],
    swipeStartedAt: [null, null] as [number | null, number | null],
    swipe: [null, null],
    result: null
  }
}

function makeInitialState(board: BoardLayout, tipoffMode: TipoffMode, coinFlipWinner: Player, zoneIndex: 0 | 1, faceoffZones: [0 | 1, 0 | 1], faceoffReadyGuess: [0 | 1, 0 | 1]): GameState {
  // 'faceoff'/'tripleTap' both open on their own tip-off phase (a real draw); the puck rests at
  // dead center for either. 'coinFlip' resolves coinFlipWinner/zoneIndex (both randomized by the
  // caller, kept out of this otherwise-pure function) into a puck placed at one of that player's
  // own rink faceoff dots (see faceoffZoneCenter in utils/board.ts) immediately — but opens on the
  // 'coinFlip' phase rather than landing straight in 'idle', so Board.tsx's coin-flip ceremony (see
  // its own doc comment) has a window to play out over the puck/winner that are already, quietly,
  // decided. game.tsx's own timer (COIN_FLIP_TOTAL_MS) is what actually flips phase to 'idle' once
  // that ceremony finishes (see COIN_FLIP_DONE below).
  const puckPos = tipoffMode === 'coinFlip' ? faceoffZoneCenter(board, coinFlipWinner, zoneIndex) : centerPuck(board)
  return {
    phase: tipoffMode,
    // 'tripleTap' seeds an arbitrary player here (meaningless until TRIPLE_TAP_LAUNCH overwrites
    // it, exactly like 'faceoff' mode's own pre-resolution currentPlayer) — 'faceoff' itself always
    // starts on player 1 for the same reason.
    currentPlayer: tipoffMode === 'coinFlip' ? coinFlipWinner : 1,
    scores: [0, 0],
    puck: { ...puckPos, vx: 0, vy: 0 },
    aim: null,
    interceptAim: null,
    pendingShot: null,
    bounceCount: 0,
    lastScoredGoal: null,
    wellEnterCount: 0,
    lastWellPolarity: null,
    goalDoorHitCount: 0,
    lastGoalDoorSide: null,
    faceoff: tipoffMode === 'faceoff' ? initialFaceoffState(faceoffZones, faceoffReadyGuess) : null,
    faceoffRound: 0,
    tripleTap: tipoffMode === 'tripleTap' ? initialTripleTapState() : null,
    tripleTapRound: 0
  }
}

export function makeReducer(scoreToWin: number, tipoffMode: TipoffMode, friction: number, controlScheme: Record<Player, ControlScheme>, interceptThreshold: number) {
  return function reducer(state: GameState, action: Action): GameState {
    switch (action.type) {
      case 'AIM_START':
        if (state.phase === 'idle') {
          return { ...state, phase: 'aiming', aim: { startX: action.x, startY: action.y, currentX: action.x, currentY: action.y, vx: 0, vy: 0 } }
        }
        // Mid-slide intercept: the RECEIVING player (whoever doesn't currently hold currentPlayer
        // — see STRIKE's own comment below for why the flip is deferred that far) can reach in and
        // take the puck once it's slowed under interceptThreshold, without waiting for a full
        // natural stop. `interceptAim` lives alongside `aim` rather than replacing it, and phase
        // deliberately stays 'simulating' the whole time — flipping to 'aiming' here would disable
        // useGameLoop's PHYSICS_STEP dispatch (gated on phase==='simulating') and freeze the
        // original puck, defeating the entire point: real user feedback wanted a puck you can hit
        // "even while it was sliding to a stop... a little more fluid than waiting for full stops."
        if (state.phase === 'simulating' && state.interceptAim === null) {
          const speed = Math.hypot(state.puck.vx, state.puck.vy)
          if (speed < interceptThreshold) {
            return { ...state, interceptAim: { startX: action.x, startY: action.y, currentX: action.x, currentY: action.y, vx: 0, vy: 0 } }
          }
        }
        return state

      case 'AIM_UPDATE':
        if (state.phase === 'aiming' && state.aim) {
          const { vx, vy } = smoothVelocity(state.aim.vx, state.aim.vy, action.vx, action.vy)
          return { ...state, aim: { ...state.aim, currentX: action.x, currentY: action.y, vx, vy } }
        }
        if (state.interceptAim) {
          const { vx, vy } = smoothVelocity(state.interceptAim.vx, state.interceptAim.vy, action.vx, action.vy)
          return { ...state, interceptAim: { ...state.interceptAim, currentX: action.x, currentY: action.y, vx, vy } }
        }
        return state

      case 'AIM_CANCEL':
        if (state.phase === 'aiming') {
          return { ...state, phase: 'idle', aim: null }
        }
        // True no-op — the puck was never touched (phase/currentPlayer untouched), so it just
        // keeps coasting exactly as if nobody had reached for it.
        if (state.interceptAim) {
          return { ...state, interceptAim: null }
        }
        return state

      // Release: velocity is computed now (from the raw gesture, signed AND power-modeled per the
      // shooting player's own ControlScheme — see resolveStrikeVelocity above) but not applied to
      // the puck yet. `aim` is kept as-is so Board.tsx can animate the player's stick from its
      // pulled-back position to the puck over the 'striking' phase, and only APPLY_STRIKE actually
      // sets the puck moving. The scheme lookup lives here, not in useGameState().shoot below,
      // specifically so it always reads state.currentPlayer fresh off the reducer's own state
      // rather than a closure that could go stale between whose turn it was when the drag started
      // and when it ended — same reasoning now covers the gesture-too-weak-to-count check too,
      // which used to live in shoot() itself before a real ControlScheme (not just its sign) needed
      // to be known to decide it (see resolveStrikeVelocity: 'flick' gates on speed, 'pull'/'push'
      // don't).
      case 'STRIKE': {
        if (state.phase === 'aiming') {
          const scheme = controlScheme[state.currentPlayer]
          const result = resolveStrikeVelocity(scheme, action.dx, action.dy, action.vx, action.vy)
          if (!result) return { ...state, phase: 'idle', aim: null } // too weak to count — same effect as AIM_CANCEL
          // flick has no stick-swing visual to animate (see ControlScheme's own doc comment) and no
          // reason to wait — apply straight to the puck in this same dispatch, same direct-apply
          // shape FACEOFF_LAUNCH already uses, rather than handing off through 'striking'/
          // pendingShot the way pull/push still do below.
          if (scheme === 'flick') {
            const { vx, vy } = combineAndClampVelocity(state.puck.vx, state.puck.vy, result.vx, result.vy)
            return { ...state, phase: 'simulating', aim: null, pendingShot: null, puck: { ...state.puck, vx, vy } }
          }
          return { ...state, phase: 'striking', pendingShot: result }
        }
        // Intercept release: currentPlayer flips to the interceptor HERE, not at AIM_START — so an
        // abandoned/never-struck intercept attempt (cancelled, or the original puck scores or
        // naturally stops first) never disturbs PHYSICS_STEP's own otherPlayer(state.currentPlayer)
        // math above, which still assumes the SHOOTER is state.currentPlayer until a real strike
        // lands. Resolved against the interceptor's OWN ControlScheme (not the shooter's) — same
        // reasoning as the normal case, just against otherPlayer(state.currentPlayer) instead of
        // state.currentPlayer directly. `aim` is populated from `interceptAim` so the existing
        // 'striking' paddle-swing visual (which reads `aim`, not `interceptAim`) works unmodified —
        // pull/push only; the flick branch below never reaches that visual at all.
        if (state.interceptAim) {
          const interceptor = otherPlayer(state.currentPlayer)
          const scheme = controlScheme[interceptor]
          const result = resolveStrikeVelocity(scheme, action.dx, action.dy, action.vx, action.vy)
          if (!result) return { ...state, interceptAim: null } // true no-op, same as AIM_CANCEL's intercept branch
          if (scheme === 'flick') {
            const { vx, vy } = combineAndClampVelocity(state.puck.vx, state.puck.vy, result.vx, result.vy)
            return { ...state, phase: 'simulating', aim: null, pendingShot: null, interceptAim: null, currentPlayer: interceptor, puck: { ...state.puck, vx, vy } }
          }
          return { ...state, phase: 'striking', pendingShot: result, aim: { ...state.interceptAim }, interceptAim: null, currentPlayer: interceptor }
        }
        return state
      }

      case 'APPLY_STRIKE': {
        if (state.phase !== 'striking' || !state.pendingShot) return state
        // pull/push only now — flick applies directly inside STRIKE itself (see
        // combineAndClampVelocity's other call site above) and never enters 'striking' at all.
        // Combines the puck's own pre-strike velocity into the final shot, not just the swing
        // itself — a real slap shot/one-timer redirect is faster when the puck is already moving
        // your way, not purely a function of how hard you swung. The puck keeps integrating real
        // physics for the whole 'striking' windup (see useGameLoop's enabled condition above), so
        // this combines onto whatever velocity actually survived that windup, not a frozen
        // pre-windup snapshot.
        const { vx, vy } = combineAndClampVelocity(state.puck.vx, state.puck.vy, state.pendingShot.vx, state.pendingShot.vy)
        return { ...state, phase: 'simulating', aim: null, pendingShot: null, puck: { ...state.puck, vx, vy } }
      }

      case 'PHYSICS_STEP': {
        // Runs during 'striking' too, not just 'simulating' — the puck must keep gliding through a
        // pull/push windup exactly the way it does everywhere else (see useGameLoop's enabled
        // condition above), never an artificial freeze. 'idle'/'aiming' are deliberately excluded:
        // the puck is always genuinely at rest entering either phase (a fresh aim only ever starts
        // from 'idle', and a mid-slide intercept already avoids 'aiming' entirely — see
        // interceptAim's own doc comment), so there's nothing to step and no risk of "detected
        // stopped" firing every frame while someone is calmly aiming.
        if (state.phase !== 'simulating' && state.phase !== 'striking') return state
        const result = stepPhysics(state.puck, action.board, action.dt, friction)

        if (result.scored !== null) {
          const scores: [number, number] = [state.scores[0], state.scores[1]]
          scores[result.scored - 1]++
          const puck: PuckState = { x: result.x, y: result.y, vx: 0, vy: 0 }
          // Player 1 scores by entering the TOP goal (attacking, not their own crease — see
          // physics.ts's stepPhysics), so the celebration's physical side is the inverse of the
          // scoring player number.
          const lastScoredGoal = result.scored === 1 ? 'top' : 'bottom'
          // Any in-progress intercept attempt OR pending (not-yet-landed) pull/push strike is moot
          // — the puck found the net on its own residual motion before anyone's hit actually
          // landed, so there's nothing left to strike/apply.
          if (scores[result.scored - 1] >= scoreToWin) {
            return { ...state, phase: 'gameOver', scores, puck, lastScoredGoal, interceptAim: null, pendingShot: null }
          }
          // The conceding player — whoever's net just got breached — always starts the next
          // possession (soccer-style; see the miss-branch comment below for the fuller rule and
          // 'coinFlip' mode's TIPOFF_MODE_OPTIONS description, "loser gets the puck"). That's
          // otherPlayer(result.scored), NOT otherPlayer(state.currentPlayer): result.scored is
          // purely geometric (which goal mouth the puck entered — see physics.ts's stepPhysics) and
          // is independent of who last touched it, whereas state.currentPlayer is just whoever shot
          // or intercepted last. Those agree for an ordinary goal (the shooter scores in the
          // opponent's net) but diverge on an OWN GOAL — the shooter's own puck rattles back into
          // their own net, crediting the opponent (result.scored is the opponent) while the shooter
          // is still the one who conceded. Keying off state.currentPlayer here used to hand the
          // puck to the opponent (the beneficiary) instead of back to the shooter who conceded it.
          return { ...state, phase: 'scored', scores, puck, lastScoredGoal, currentPlayer: otherPlayer(result.scored), interceptAim: null, pendingShot: null }
        }

        // Suppressed while someone's actively mid-drag intercepting (state.interceptAim !== null)
        // OR a pull/push strike is already committed and mid-windup (state.pendingShot !== null)
        // — otherwise falls through to the generic "still simulating" return below, same as any
        // other still-moving frame. The interceptAim half is deliberate, not an oversight: the
        // whole precondition for an intercept existing at all is that the puck was ALREADY slow, so
        // on a real human drag timescale it very often decays the rest of the way to
        // STOP_THRESHOLD while they're still deciding their shot. An earlier version force-zeroed
        // velocity and flipped phase to 'aiming' the instant that happened ("seamlessly promoting"
        // the drag) — but that's exactly the freeze real user feedback flagged: "the puck stops
        // while aiming" defeats the entire point of a fluid mid-slide hit. Letting the puck simply
        // keep resolving its own physics (settling to rest on its own terms is fine; forcing a
        // phase/velocity snap under an active drag is not) until STRIKE or AIM_CANCEL actually
        // resolves it is what keeps it fluid. The pendingShot half is the same idea applied to a
        // pull/push windup already in flight: a puck that decays under STOP_THRESHOLD mid-swing
        // shouldn't auto-flip the turn out from under APPLY_STRIKE, which is about to add real
        // velocity back into it momentarily.
        if (result.stopped && !state.interceptAim && !state.pendingShot) {
          // Turn always passes to the other player on a miss, in EVERY tipoff mode, with NO
          // exceptions — this is a turn-based game (box hockey), not soccer, and the faceoff
          // winner never gets a follow-up shot off their own knock (see FACEOFF_LAUNCH below):
          // real user feedback was explicit that a knock into the loser's own territory plus a
          // follow-up shot for the WINNER was "way too easy" — the loser is always the one to
          // take the next real turn, hit or miss. 'coinFlip' mode's own soccer-style rule is
          // narrower than this branch used to treat it: only WHO GETS THE PUCK AFTER A GOAL is
          // soccer-style (the conceding player starts the next possession — see the 'scored'
          // branch above and NEXT_ROUND's own zone placement below), never whether an ordinary
          // miss changes possession mid-rally. This branch previously let 'coinFlip' mode keep
          // the puck with whoever was shooting through every miss until they scored — real user
          // feedback was that this read as "turns don't alternate", since the same player could
          // hold the puck for many shots in a row.
          return {
            ...state,
            phase: 'idle',
            currentPlayer: otherPlayer(state.currentPlayer),
            puck: { ...result, vx: 0, vy: 0 },
            // A puck can come to rest on the very same step it strikes the goal-mouth door (a slow
            // approach loses just enough speed on the bounce to drop under STOP_THRESHOLD
            // immediately) — the single most natural way to trigger this in real play, a puck
            // drifting back toward the front of the goal and settling right against the door.
            // Without this, that step would hit the early return above and silently never flash.
            // See physics.ts's own comment on goalDoorHit for what gates it.
            goalDoorHitCount: result.goalDoorHit ? state.goalDoorHitCount + 1 : state.goalDoorHitCount,
            lastGoalDoorSide: result.goalDoorHit ?? state.lastGoalDoorSide
          }
        }

        return {
          ...state,
          puck: result,
          // Folds the latest known finger position (action.interceptTouch — read fresh off a ref
          // by useGameState's own rAF tick each frame, see below) into THIS SAME tick's update,
          // rather than interceptAim being updated by its own separately-dispatched AIM_UPDATE
          // action. Two independent update streams — one gesture-driven, one this rAF-driven
          // physics loop — each triggering their own re-render at their own uncorrelated cadence
          // is exactly what produced reported jitter (a beat pattern between two mismatched
          // frequencies, not a one-off stall from either alone). Consolidating to one dispatch per
          // animation frame (game.tsx's stableAimUpdate now just writes a ref instead of
          // dispatching directly while intercepting) means the puck's own motion and the live drag
          // position always land in the exact same render, in sync, every frame.
          interceptAim:
            state.interceptAim && action.interceptTouch
              ? {
                  ...state.interceptAim,
                  currentX: action.interceptTouch.x,
                  currentY: action.interceptTouch.y,
                  ...smoothVelocity(state.interceptAim.vx, state.interceptAim.vy, action.interceptTouch.vx, action.interceptTouch.vy)
                }
              : state.interceptAim,
          bounceCount: result.bounced ? state.bounceCount + 1 : state.bounceCount,
          wellEnterCount: result.enteredWell ? state.wellEnterCount + 1 : state.wellEnterCount,
          lastWellPolarity: result.enteredWell ?? state.lastWellPolarity,
          goalDoorHitCount: result.goalDoorHit ? state.goalDoorHitCount + 1 : state.goalDoorHitCount,
          lastGoalDoorSide: result.goalDoorHit ?? state.lastGoalDoorSide
        }
      }

      case 'NEXT_ROUND': {
        // 'faceoff'/'tripleTap' both repeat their own draw after every goal (real hockey rule):
        // puck goes back to dead center for a fresh draw. 'coinFlip' mode never repeats the flip
        // itself — the goal that just happened already handed possession to the player who
        // conceded it (see PHYSICS_STEP's 'scored' branch above) — but still places the puck at
        // one of THAT player's own rink faceoff dots (action.zoneIndex, randomized by the caller)
        // rather than dead center, so every round in that mode opens the same way: puck sitting at
        // a zone, no separate announcement needed.
        const puckPos = tipoffMode === 'coinFlip' ? faceoffZoneCenter(action.board, state.currentPlayer, action.zoneIndex) : centerPuck(action.board)
        return {
          ...state,
          phase: tipoffMode === 'coinFlip' ? 'idle' : tipoffMode,
          puck: { ...puckPos, vx: 0, vy: 0 },
          aim: null,
          lastScoredGoal: null,
          // Every post-goal draw gates on both players readying up too (see FaceoffState's doc
          // comment) — not just the game's first draw.
          faceoff: tipoffMode === 'faceoff' ? initialFaceoffState(action.faceoffZones, action.faceoffReadyGuess) : null,
          faceoffRound: tipoffMode === 'faceoff' ? state.faceoffRound + 1 : state.faceoffRound,
          tripleTap: tipoffMode === 'tripleTap' ? initialTripleTapState() : null,
          tripleTapRound: tipoffMode === 'tripleTap' ? state.tripleTapRound + 1 : state.tripleTapRound
        }
      }

      case 'RESET':
        return makeInitialState(action.board, tipoffMode, action.coinFlipWinner, action.zoneIndex, action.faceoffZones, action.faceoffReadyGuess)

      // Fired by game.tsx's own COIN_FLIP_TOTAL_MS timer once the coin-flip ceremony (Board.tsx)
      // finishes playing — the winner/puck placement were already decided back at RESET (see
      // makeInitialState above), so this is nothing more than handing control to the winner,
      // identically to how 'faceoff' mode's FACEOFF_LAUNCH hands off once ITS own ceremony
      // resolves. `puck` gets a new object reference here (values unchanged) rather than reusing
      // the one RESET already placed — every OTHER transition into 'idle' (a physics stop,
      // NEXT_ROUND, FACEOFF_LAUNCH's eventual stop) naturally hands the puck a fresh reference too,
      // and useAIOpponent.ts's main effect deliberately depends on that reference instead of
      // `phase` directly (see its own comment) to notice a fresh CPU turn without tearing down
      // mid-shot. Without this, a CPU that won the coin flip left `currentPlayer`/`puck` both
      // byte-identical to the prior render, so that effect never re-fired — the CPU just sat on
      // the puck forever instead of taking its turn.
      case 'COIN_FLIP_DONE':
        if (state.phase !== 'coinFlip') return state
        return { ...state, phase: 'idle', puck: { ...state.puck } }

      // Every draw starts at 'ready' (see initialFaceoffState/FaceoffState's doc comment). Once
      // BOTH players have signaled, hands off straight into 'countdown' with count reset to 3 —
      // useFaceoff.ts's countdown-chain effect is gated on stage !== 'ready' rather than keyed on
      // it directly, so this transition is what actually wakes it up.
      case 'FACEOFF_READY': {
        if (state.phase !== 'faceoff' || !state.faceoff || state.faceoff.stage !== 'ready') return state
        const idx = action.player - 1
        if (state.faceoff.ready[idx]) return state // idempotent against a duplicate delivery
        const ready: [boolean, boolean] = [...state.faceoff.ready]
        ready[idx] = true
        if (ready[0] && ready[1]) {
          return { ...state, faceoff: { ...state.faceoff, ready, stage: 'countdown', count: 3 } }
        }
        return { ...state, faceoff: { ...state.faceoff, ready } }
      }

      case 'FACEOFF_COUNT':
        if (state.phase !== 'faceoff' || !state.faceoff || state.faceoff.stage !== 'countdown') return state
        return { ...state, faceoff: { ...state.faceoff, count: action.count } }

      // Committed the moment the post-countdown hold begins, not when it ends — FACEOFF_TAP below
      // classifies a tap by comparing its own timestamp against this goAt, not against `stage`,
      // since the hold timer and a tap's gesture-thread dispatch are two independent,
      // unsynchronized delivery paths whose dispatch()-arrival order at the reducer isn't
      // guaranteed to match true wall-clock order.
      case 'FACEOFF_HOLD':
        if (state.phase !== 'faceoff' || !state.faceoff || state.faceoff.stage !== 'countdown') return state
        return { ...state, faceoff: { ...state.faceoff, stage: 'hold', count: null, goAt: action.goAt } }

      case 'FACEOFF_LIVE':
        if (state.phase !== 'faceoff' || !state.faceoff || state.faceoff.stage !== 'hold') return state
        return { ...state, faceoff: { ...state.faceoff, stage: 'live' } }

      case 'FACEOFF_TAP': {
        if (state.phase !== 'faceoff' || !state.faceoff) return state
        const fo = state.faceoff
        if (fo.stage === 'resolved' || fo.goAt === null) return state
        // Soft false start: a press before the live window opens is simply discarded — no
        // penalty, no state change — rather than an instant disqualification. Nothing's been
        // revealed yet at that point, so there's no "wrong zone" to have picked either; this is
        // casual pass-and-play with two different people's reflexes on one shared device, not a
        // competitive draw.
        if (action.atMs < fo.goAt) return state

        const idx = action.player - 1
        const otherIdx = otherPlayer(action.player) - 1
        if (fo.tapAt[idx] !== null || fo.disqualified[idx]) return state // idempotent — this player's press already committed this draw

        // Every real press (right zone or wrong) stamps pressFlash — purely a visual timing cue
        // for Board.tsx's press ripple, never read by the win/knock logic below (see
        // FaceoffState's own comment on pressFlash).
        const pressFlash: [number | null, number | null] = [...fo.pressFlash]
        pressFlash[idx] = action.atMs

        // Wrong zone: pressed the one that never colored. Disqualifies this player from winning
        // immediately — pressing (or tapping) both zones "to be safe" is still a real gamble, not
        // a free guaranteed win — but unlike a plain instant forfeit, it does NOT resolve the draw
        // by itself: the other player still has to land (or fail to land) their own real press,
        // so the eventual winner's knock power always comes from a genuine reactionMs rather than
        // an automatic max the opponent's mistake didn't actually earn them (see
        // computeFaceoffKnock in utils/faceoff.ts).
        if (fo.zones[idx] !== action.zoneIndex) {
          const disqualified: [boolean, boolean] = [...fo.disqualified]
          disqualified[idx] = true

          // Both players have now struck out this draw (exceedingly rare in real play) — pick
          // whichever disqualification landed second as the nominal winner for turn-flip
          // purposes, with reactionMs pinned to the ceiling so it always yields the weakest knock.
          // marginMs is pinned to 0 (NOT FACEOFF_MARGIN_MAX_MS), deliberately the opposite of the
          // single-forfeit branches below — a large margin means "no real defense, they clearly
          // could've hit anything," which only makes sense when the winner actually landed a
          // genuine press against a whiffing opponent. Here NEITHER player did, so there's no
          // "confident, uncontested" shot to reward — 0 margin maxes out computeFaceoffKnock's
          // jitter instead, so this coin-flip winner still can't be trusted with an accurate shot.
          if (disqualified[otherIdx]) {
            return {
              ...state,
              faceoff: { ...fo, disqualified, pressFlash, stage: 'resolved', result: { winner: action.player, marginMs: 0, reactionMs: FACEOFF_REACTION_MAX_MS, forfeit: true } }
            }
          }

          // The other player already landed their own correct-zone press while this draw was
          // still pending on this one — resolve now using their real reactionMs.
          const otherTap = fo.tapAt[otherIdx]
          if (otherTap !== null) {
            return {
              ...state,
              faceoff: { ...fo, disqualified, pressFlash, stage: 'resolved', result: { winner: otherPlayer(action.player), marginMs: FACEOFF_MARGIN_MAX_MS, reactionMs: otherTap - fo.goAt, forfeit: true } }
            }
          }

          // Other player hasn't pressed yet — record the disqualification and keep waiting for
          // their real press (or their own timeout).
          return { ...state, faceoff: { ...fo, disqualified, pressFlash } }
        }

        const tapAt: [number | null, number | null] = [...fo.tapAt]
        tapAt[idx] = action.atMs

        // The other player already disqualified themselves — this press is the only real one
        // this draw will ever get, so it alone determines both who won and how hard the knock hits.
        if (fo.disqualified[otherIdx]) {
          return { ...state, faceoff: { ...fo, tapAt, pressFlash, stage: 'resolved', result: { winner: action.player, marginMs: FACEOFF_MARGIN_MAX_MS, reactionMs: action.atMs - fo.goAt, forfeit: true } } }
        }

        const otherTap = tapAt[otherIdx]
        if (otherTap === null) return { ...state, faceoff: { ...fo, tapAt, pressFlash } }

        // A correct blind guess at ready time (see FaceoffState.readyGuess's own doc comment)
        // shaves FACEOFF_GUESS_BONUS_MS off a player's OWN effective press time here — pure luck,
        // applied identically to both players, close enough a margin to occasionally flip who wins
        // a genuinely contested draw, not just how hard the resulting knock lands. Floored at goAt
        // so an already-blazing-fast raw press can't be pushed to a negative reactionMs (which
        // would overshoot computeFaceoffKnock's power curve past its own ceiling).
        const effectiveAtMs = fo.readyGuess[idx] === fo.zones[idx] ? Math.max(fo.goAt, action.atMs - FACEOFF_GUESS_BONUS_MS) : action.atMs
        const effectiveOtherTap = fo.readyGuess[otherIdx] === fo.zones[otherIdx] ? Math.max(fo.goAt, otherTap - FACEOFF_GUESS_BONUS_MS) : otherTap

        const marginMs = Math.abs(effectiveAtMs - effectiveOtherTap)
        const winner: Player = effectiveAtMs <= effectiveOtherTap ? action.player : otherPlayer(action.player)
        const winnerTap = winner === action.player ? effectiveAtMs : effectiveOtherTap
        return { ...state, faceoff: { ...fo, tapAt, pressFlash, stage: 'resolved', result: { winner, marginMs, reactionMs: winnerTap - fo.goAt, forfeit: false } } }
      }

      case 'FACEOFF_TIMEOUT': {
        if (state.phase !== 'faceoff' || !state.faceoff || state.faceoff.stage === 'resolved' || state.faceoff.goAt === null) return state
        const fo = state.faceoff
        const goAt = state.faceoff.goAt // fo.goAt's non-null narrowing above doesn't carry over to the fo binding itself
        // Disqualification (a wrong-zone press) always loses to a mere non-press — this only
        // flips the "obvious" winner (otherPlayer(action.player)) back to action.player when that
        // obvious winner had already struck out too, which only happens if BOTH players failed to
        // land a real press this draw (one via a wrong zone, one via silence).
        const winner: Player = fo.disqualified[otherPlayer(action.player) - 1] ? action.player : otherPlayer(action.player)
        const winnerTap = fo.tapAt[winner - 1]
        const reactionMs = winnerTap !== null ? winnerTap - goAt : FACEOFF_REACTION_MAX_MS
        // marginMs only gets the "confident blowout" MAX value (tightest jitter, see
        // computeFaceoffKnock) when winnerTap is real — i.e. the winner actually landed a genuine
        // correct-zone press and the OTHER player is who timed out/whiffed. If winnerTap is null,
        // this "winner" never landed a real press either (both silent, or silent-vs-wrong-zone) —
        // same double-failure case the FACEOFF_TAP branch above handles, so it gets the same 0
        // margin (max jitter) rather than rewarding a coin-flip default with the most accurate shot.
        const marginMs = winnerTap !== null ? FACEOFF_MARGIN_MAX_MS : 0
        return { ...state, faceoff: { ...fo, stage: 'resolved', result: { winner, marginMs, reactionMs, forfeit: true } } }
      }

      // Launches the winner's real knock (see computeFaceoffKnock in utils/faceoff.ts) — genuine
      // velocity, real physics, can bounce, can even score, into the loser's own territory. This
      // is the winner's ENTIRE reward for the draw: currentPlayer is set to them only for the
      // duration of this one knock, and PHYSICS_STEP's 'scored'/'stopped' branches are BOTH
      // unconditional, so the winner never gets a follow-up shot of their own off of it. Real user
      // feedback, explicit: a knock into enemy territory PLUS a follow-up shot for the same player
      // who won it would be "way too easy" — the knock alone is the edge, nothing more. On a MISS
      // that's simply the loser, always. On a GOAL it's the conceding player (see PHYSICS_STEP's
      // 'scored' branch), which is ordinarily the loser too (the knock scores in THEIR net) — but
      // if the knock instead ricochets into the WINNER's own net, the winner is who conceded and
      // gets the puck back, not a bonus follow-up shot; they've already paid for it with a goal
      // against themselves.
      case 'FACEOFF_LAUNCH': {
        if (state.phase !== 'faceoff' || !state.faceoff || state.faceoff.stage !== 'resolved' || !state.faceoff.result) return state
        return { ...state, phase: 'simulating', currentPlayer: state.faceoff.result.winner, faceoff: null, puck: { ...state.puck, vx: action.vx, vy: action.vy } }
      }

      // Restarts the current draw from scratch. Dispatched by useFaceoff.ts's pause-resume effect
      // when a pause clears mid-draw (a settings/quit-confirm dialog closing, or Resume after the
      // app was backgrounded), since a suspended setTimeout chain can't be trusted to resume with
      // correct relative timing.
      // Bumping faceoffRound (not just resetting `faceoff`) is what lets that hook's
      // timer-scheduling effect tell "a real restart happened" apart from `faceoff`'s object
      // identity changing on every ordinary sub-action (count ticks, taps, ...), which it
      // otherwise ignores. Reuses the interrupted draw's own zones AND readyGuess rather than
      // re-randomizing either — this is a resume, not a new draw. Always lands back on 'ready', so
      // a restart always waits for both players to signal again before the countdown resumes.
      case 'FACEOFF_RESTART':
        if (state.phase !== 'faceoff' || !state.faceoff) return state
        return { ...state, faceoff: initialFaceoffState(state.faceoff.zones, state.faceoff.readyGuess), faceoffRound: state.faceoffRound + 1 }

      // One of a player's own 2 required taps (see TripleTapState's own doc comment) — idempotent
      // past tapCount 2 (a stray extra press once a player's already armed for their swipe is a
      // no-op, not an error). No "wrong zone" concept here (unlike FACEOFF_TAP) — there's only one
      // zone per player, so any press on it counts.
      case 'TRIPLE_TAP_PRESS': {
        if (state.phase !== 'tripleTap' || !state.tripleTap) return state
        const tt = state.tripleTap
        const idx = action.player - 1
        if (tt.tapCount[idx] >= 2) return state
        const tapCount: [0 | 1 | 2, 0 | 1 | 2] = [...tt.tapCount]
        tapCount[idx] = (tapCount[idx] + 1) as 0 | 1 | 2
        const pressFlash: [number | null, number | null] = [...tt.pressFlash]
        pressFlash[idx] = action.atMs
        return { ...state, tripleTap: { ...tt, tapCount, pressFlash } }
      }

      // The third press's touch-down — only valid once that player's own 2 taps are both in and
      // they haven't already started this draw's swipe. Re-validated here against the reducer's
      // own state, not trusted from the client's local snapshot alone (same discipline FACEOFF_TAP
      // applies to its own zoneIndex). Supplies the timestamp TRIPLE_TAP_SWIPE_END below compares
      // to decide `result.winner` — see TripleTapState.swipeStartedAt's own doc comment for why
      // that comparison has to read stored timestamps, not dispatch arrival order: two players'
      // gesture threads can deliver to this reducer out of true wall-clock order, same reasoning
      // FACEOFF_TAP's own goAt comment gives for the race mode.
      case 'TRIPLE_TAP_SWIPE_START': {
        if (state.phase !== 'tripleTap' || !state.tripleTap) return state
        const tt = state.tripleTap
        const idx = action.player - 1
        if (tt.tapCount[idx] !== 2 || tt.swipeStartedAt[idx] !== null) return state
        const swipeStartedAt: [number | null, number | null] = [...tt.swipeStartedAt]
        swipeStartedAt[idx] = action.atMs
        const pressFlash: [number | null, number | null] = [...tt.pressFlash]
        pressFlash[idx] = action.atMs
        return { ...state, tripleTap: { ...tt, swipeStartedAt, pressFlash } }
      }

      // The third press's release — captures that player's own bounded swipe vector. If the other
      // player's swipe isn't in yet, just store this one and keep waiting: no timeout, no forfeit
      // (see TipoffMode's own doc comment) — the draw resolves the instant BOTH are present,
      // whenever that happens to be. winner is whichever player's swipeStartedAt is earlier
      // (ties favor the player dispatching THIS action, same <= convention FACEOFF_TAP's own race
      // resolution uses) — bookkeeping only; vx/vy is always the plain sum of both swipes via
      // combineAndClampVelocity, unaffected by who was faster.
      case 'TRIPLE_TAP_SWIPE_END': {
        if (state.phase !== 'tripleTap' || !state.tripleTap) return state
        const tt = state.tripleTap
        const idx = action.player - 1
        const otherIdx = otherPlayer(action.player) - 1
        if (tt.tapCount[idx] !== 2 || tt.swipe[idx] !== null || tt.swipeStartedAt[idx] === null) return state
        const swipe: [{ vx: number; vy: number } | null, { vx: number; vy: number } | null] = [...tt.swipe]
        swipe[idx] = resolveTripleTapSwipeVelocity(action.dx, action.dy)
        const otherSwipe = swipe[otherIdx]
        if (otherSwipe === null) return { ...state, tripleTap: { ...tt, swipe } }
        const winner: Player = tt.swipeStartedAt[idx]! <= tt.swipeStartedAt[otherIdx]! ? action.player : otherPlayer(action.player)
        const combined = combineAndClampVelocity(swipe[0]!.vx, swipe[0]!.vy, swipe[1]!.vx, swipe[1]!.vy)
        return { ...state, tripleTap: { ...tt, swipe, result: { winner, vx: combined.vx, vy: combined.vy } } }
      }

      // Launches the combined swipe (see TRIPLE_TAP_SWIPE_END above) — same atomic resolve+phase+
      // velocity shape as FACEOFF_LAUNCH. result.winner only decides currentPlayer bookkeeping
      // (whoever initiated their swipe first — see TripleTapState's own doc comment); the winner
      // gets no follow-up shot off of it, same unconditional next-turn-to-the-loser rule
      // PHYSICS_STEP already enforces regardless of tipoffMode.
      case 'TRIPLE_TAP_LAUNCH': {
        if (state.phase !== 'tripleTap' || !state.tripleTap || !state.tripleTap.result) return state
        return { ...state, phase: 'simulating', currentPlayer: state.tripleTap.result.winner, tripleTap: null, puck: { ...state.puck, vx: action.vx, vy: action.vy } }
      }

      default:
        return state
    }
  }
}

export function useGameState(board: BoardLayout, scoreToWin: number, tipoffMode: TipoffMode, friction: number, controlScheme: Record<Player, ControlScheme>, paused: boolean, interceptThreshold: number) {
  // Mirrored every render so the stable useReducer wrapper below always dispatches through the
  // latest settings-derived reducer, without needing to recreate useReducer itself (which would
  // reset `state` back to its initializer whenever any of these settings changed).
  const reducerRef = useRef(makeReducer(scoreToWin, tipoffMode, friction, controlScheme, interceptThreshold))
  useEffect(() => {
    reducerRef.current = makeReducer(scoreToWin, tipoffMode, friction, controlScheme, interceptThreshold)
  })

  const [state, dispatch] = useReducer(
    // eslint-disable-next-line react-hooks/refs -- see reducerRef's own comment above; only ever invoked from dispatch, never during render
    (s: GameState, a: Action) => reducerRef.current(s, a),
    { board, scoreToWin, tipoffMode },
    (init) => makeInitialState(init.board, init.tipoffMode, randomPlayer(), randomZoneIndex(), randomFaceoffZones(), randomReadyGuess())
  )

  const boardRef = useRef(board)
  useEffect(() => {
    boardRef.current = board
  })

  // Latest known finger position during a mid-slide intercept drag (see GameState.interceptAim) —
  // written directly by setInterceptTouch below on EVERY raw gesture update (a plain ref write,
  // no dispatch, no re-render of its own), and read back out fresh by the rAF tick just below so
  // it can ride along in the very same PHYSICS_STEP dispatch that advances the puck. This is what
  // keeps the drag and the physics update on one shared per-frame cadence instead of two
  // independent ones — see PHYSICS_STEP's own comment on why that matters. null whenever there's
  // no active intercept drag (the reducer only ever applies it when state.interceptAim is set).
  const interceptTouchRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  // Gated on `paused` (settings/quit-confirm dialog open — see game.tsx) same as `state.phase` —
  // stops the loop outright rather than letting it keep stepping behind a dialog the player can't
  // see. useGameLoop resets its own timestamp baseline whenever `enabled` goes back to true, so the
  // first post-pause frame falls back to dt=1 exactly like a genuine phase-change restart — no
  // time-jump from however long the dialog was open.
  // Also enabled during 'striking' (not just 'simulating') — the puck must keep gliding through a
  // pull/push windup exactly the way it does the rest of the time; see PHYSICS_STEP's own comment.
  useGameLoop((dt) => dispatch({ type: 'PHYSICS_STEP', board: boardRef.current, dt, interceptTouch: interceptTouchRef.current }), { enabled: (state.phase === 'simulating' || state.phase === 'striking') && !paused, maxDt: 2.5 })

  // See interceptTouchRef's own doc comment — called from game.tsx's stableAimUpdate INSTEAD of
  // dispatching AIM_UPDATE while an intercept is in progress. A plain synchronous ref write is
  // effectively free and triggers no render by itself, so this can be called at whatever raw rate
  // the gesture handler delivers without any throttling needed.
  const setInterceptTouch = useCallback((x: number, y: number, vx: number, vy: number) => {
    interceptTouchRef.current = { x, y, vx, vy }
  }, [])

  // No longer gated on touching near the puck (see the removed pinch-zoom/pan camera this
  // replaced) — a drag can start anywhere on the board, so a puck pinned against a wall always
  // has room to pull back into. Board.tsx renders the stick at puck position + drag offset
  // rather than at the raw touch point, so it still reads as "pulling back from the puck"
  // regardless of where the finger actually landed. Kept returning a boolean (always true) to
  // avoid touching the tryAimStart/AIControls call-site contract.
  const tryAimStart = useCallback((touchX: number, touchY: number) => {
    dispatch({ type: 'AIM_START', x: touchX, y: touchY })
    return true
  }, [])

  const aimUpdate = useCallback((x: number, y: number, vx: number, vy: number) => {
    dispatch({ type: 'AIM_UPDATE', x, y, vx, vy })
  }, [])

  const aimCancel = useCallback(() => {
    dispatch({ type: 'AIM_CANCEL' })
  }, [])

  // dx/dy is the raw drag (release position minus start position); vx/vy is the raw release
  // velocity. Both are passed through unsigned and un-gated — the STRIKE case (via
  // resolveStrikeVelocity) is what actually applies the shooting player's own ControlScheme sign
  // AND decides which of the two ends up mattering (distance for 'pull'/'push', velocity for
  // 'flick'), since that decision needs to know whose turn it really is (the shooter, or an
  // in-progress interceptor) — see STRIKE's own comment for why that can't be resolved out here.
  const shoot = useCallback((dx: number, dy: number, vx: number, vy: number) => {
    dispatch({ type: 'STRIKE', dx, dy, vx, vy })
  }, [])

  const applyStrike = useCallback(() => {
    dispatch({ type: 'APPLY_STRIKE' })
  }, [])

  const nextRound = useCallback((currentBoard: BoardLayout) => {
    dispatch({ type: 'NEXT_ROUND', board: currentBoard, zoneIndex: randomZoneIndex(), faceoffZones: randomFaceoffZones(), faceoffReadyGuess: randomReadyGuess() })
  }, [])

  // No longer explicitly cancels the RAF loop before dispatching — useGameLoop's own effect does
  // that as soon as `enabled` (derived from state.phase) goes false on the next render, and the
  // reducer's PHYSICS_STEP case already no-ops outright once phase isn't 'simulating' (see above),
  // so a stray in-flight tick from the old loop instance can't apply against the reset state either
  // way — this was belt-and-suspenders on top of that guard, not the only thing preventing it.
  const resetGame = useCallback((currentBoard: BoardLayout) => {
    dispatch({ type: 'RESET', board: currentBoard, coinFlipWinner: randomPlayer(), zoneIndex: randomZoneIndex(), faceoffZones: randomFaceoffZones(), faceoffReadyGuess: randomReadyGuess() })
  }, [])

  const coinFlipDone = useCallback(() => {
    dispatch({ type: 'COIN_FLIP_DONE' })
  }, [])

  const faceoffCount = useCallback((count: 2 | 1) => {
    dispatch({ type: 'FACEOFF_COUNT', count })
  }, [])

  const faceoffHold = useCallback((goAt: number) => {
    dispatch({ type: 'FACEOFF_HOLD', goAt })
  }, [])

  const faceoffLive = useCallback(() => {
    dispatch({ type: 'FACEOFF_LIVE' })
  }, [])

  const faceoffReady = useCallback((player: Player) => {
    dispatch({ type: 'FACEOFF_READY', player })
  }, [])

  const faceoffTap = useCallback((player: Player, atMs: number, zoneIndex: 0 | 1) => {
    dispatch({ type: 'FACEOFF_TAP', player, atMs, zoneIndex })
  }, [])

  const faceoffTimeout = useCallback((player: Player) => {
    dispatch({ type: 'FACEOFF_TIMEOUT', player })
  }, [])

  const faceoffLaunch = useCallback((vx: number, vy: number) => {
    dispatch({ type: 'FACEOFF_LAUNCH', vx, vy })
  }, [])

  const faceoffRestart = useCallback(() => {
    dispatch({ type: 'FACEOFF_RESTART' })
  }, [])

  const tripleTapPress = useCallback((player: Player, atMs: number) => {
    dispatch({ type: 'TRIPLE_TAP_PRESS', player, atMs })
  }, [])

  const tripleTapSwipeStart = useCallback((player: Player, atMs: number) => {
    dispatch({ type: 'TRIPLE_TAP_SWIPE_START', player, atMs })
  }, [])

  const tripleTapSwipeEnd = useCallback((player: Player, dx: number, dy: number) => {
    dispatch({ type: 'TRIPLE_TAP_SWIPE_END', player, dx, dy })
  }, [])

  const tripleTapLaunch = useCallback((vx: number, vy: number) => {
    dispatch({ type: 'TRIPLE_TAP_LAUNCH', vx, vy })
  }, [])

  return { state, tryAimStart, aimUpdate, aimCancel, shoot, applyStrike, nextRound, resetGame, coinFlipDone, faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart, tripleTapPress, tripleTapSwipeStart, tripleTapSwipeEnd, tripleTapLaunch, setInterceptTouch }
}
