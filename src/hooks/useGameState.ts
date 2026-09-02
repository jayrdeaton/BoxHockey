import { useGameLoop } from '@tastic/core'
import { useCallback, useReducer, useRef } from 'react'

import { AIM_VELOCITY_SMOOTHING_ALPHA, CONTROL_SCHEME_SIGN, FACEOFF_GUESS_BONUS_MS, FACEOFF_MARGIN_MAX_MS, FACEOFF_REACTION_MAX_MS, MAX_FLICK_VELOCITY, MAX_SPEED, MIN_FLICK_VELOCITY, MIN_SHOOT_DRAG } from '@/constants/game'
import { BoardLayout, ControlScheme, FaceoffState, GameState, Player, PuckState, TipoffMode } from '@/types'
import { centerPuck, faceoffZoneCenter } from '@/utils/board'
import { computeAimVector, stepPhysics } from '@/utils/physics'

type Action =
  | { type: 'AIM_START'; x: number; y: number }
  | { type: 'AIM_UPDATE'; x: number; y: number; vx: number; vy: number }
  | { type: 'AIM_CANCEL' }
  | { type: 'STRIKE'; vx: number; vy: number }
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

function otherPlayer(p: Player): Player {
  return p === 1 ? 2 : 1
}

// One-pole EMA for the live (display-only) velocity shown on AimIndicator.vx/vy — see
// AIM_VELOCITY_SMOOTHING_ALPHA's own comment in constants/game.ts. Never used for the actual shot,
// which reads the raw velocity straight off the release gesture event instead (see STRIKE below).
function smoothVelocity(prevVx: number, prevVy: number, rawVx: number, rawVy: number): { vx: number; vy: number } {
  return { vx: prevVx + AIM_VELOCITY_SMOOTHING_ALPHA * (rawVx - prevVx), vy: prevVy + AIM_VELOCITY_SMOOTHING_ALPHA * (rawVy - prevVy) }
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

function makeInitialState(board: BoardLayout, tipoffMode: TipoffMode, coinFlipWinner: Player, zoneIndex: 0 | 1, faceoffZones: [0 | 1, 0 | 1], faceoffReadyGuess: [0 | 1, 0 | 1]): GameState {
  // 'faceoff' opens on the tip-off phase (a real draw). 'coinFlip' resolves coinFlipWinner/
  // zoneIndex (both randomized by the caller, kept out of this otherwise-pure function) into a
  // puck placed at one of that player's own rink faceoff dots (see faceoffZoneCenter in
  // utils/board.ts) immediately — but opens on the 'coinFlip' phase rather than landing straight
  // in 'idle', so Board.tsx's coin-flip ceremony (see its own doc comment) has a window to play
  // out over the puck/winner that are already, quietly, decided. game.tsx's own timer
  // (COIN_FLIP_TOTAL_MS) is what actually flips phase to 'idle' once that ceremony finishes (see
  // COIN_FLIP_DONE below).
  const puckPos = tipoffMode === 'faceoff' ? centerPuck(board) : faceoffZoneCenter(board, coinFlipWinner, zoneIndex)
  return {
    phase: tipoffMode === 'faceoff' ? 'faceoff' : 'coinFlip',
    currentPlayer: tipoffMode === 'faceoff' ? 1 : coinFlipWinner,
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
    faceoffRound: 0
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

      // Release: velocity is computed now (from the raw drag, signed per the shooting player's own
      // ControlScheme — see CONTROL_SCHEME_SIGN) but not applied to the puck yet. `aim` is kept
      // as-is so Board.tsx can animate the player's stick from its pulled-back position to the
      // puck over the 'striking' phase, and only APPLY_STRIKE actually sets the puck moving. The
      // sign lives here, not in useGameState().shoot below, specifically so it always reads
      // state.currentPlayer fresh off the reducer's own state rather than a closure that could go
      // stale between whose turn it was when the drag started and when it ended.
      case 'STRIKE': {
        if (state.phase === 'aiming') {
          const sign = CONTROL_SCHEME_SIGN[controlScheme[state.currentPlayer]]
          const { vx, vy } = computeAimVector(sign * action.vx, sign * action.vy, MAX_FLICK_VELOCITY, MAX_SPEED)
          return { ...state, phase: 'striking', pendingShot: { vx, vy } }
        }
        // Intercept release: currentPlayer flips to the interceptor HERE, not at AIM_START — so an
        // abandoned/never-struck intercept attempt (cancelled, or the original puck scores or
        // naturally stops first) never disturbs PHYSICS_STEP's own otherPlayer(state.currentPlayer)
        // math above, which still assumes the SHOOTER is state.currentPlayer until a real strike
        // lands. Signed by the interceptor's OWN ControlScheme (not the shooter's) — same reasoning
        // as the normal case, just against otherPlayer(state.currentPlayer) instead of
        // state.currentPlayer directly. `aim` is populated from `interceptAim` so the existing
        // 'striking' paddle-swing visual (which reads `aim`, not `interceptAim`) works unmodified.
        if (state.interceptAim) {
          const interceptor = otherPlayer(state.currentPlayer)
          const sign = CONTROL_SCHEME_SIGN[controlScheme[interceptor]]
          const { vx, vy } = computeAimVector(sign * action.vx, sign * action.vy, MAX_FLICK_VELOCITY, MAX_SPEED)
          return { ...state, phase: 'striking', pendingShot: { vx, vy }, aim: { ...state.interceptAim }, interceptAim: null, currentPlayer: interceptor }
        }
        return state
      }

      case 'APPLY_STRIKE': {
        if (state.phase !== 'striking' || !state.pendingShot) return state
        // Adds the puck's own pre-strike velocity into the final shot, not just the swing itself —
        // a real slap shot/one-timer redirect is faster when the puck is already moving your way,
        // not purely a function of how hard you swung (user feedback: "adding its velocity to the
        // hit... seems much more like an actual slap shot"). A strict no-op for every ORDINARY
        // shot — puck.vx/vy is always exactly 0 entering 'striking' from a normal 'idle' turn — so
        // this only ever changes anything for a mid-slide intercept, where the puck's real
        // residual velocity survives the whole 'striking' windup untouched (physics is paused
        // then, see useGameLoop's enabled condition, gated on phase==='simulating'). Clamped to
        // MAX_SPEED so a full-power swing onto an already-fast puck can't quietly exceed the one
        // speed ceiling the rest of the codebase assumes (substep budgeting, AI shot planning).
        const combinedVx = state.puck.vx + state.pendingShot.vx
        const combinedVy = state.puck.vy + state.pendingShot.vy
        const combinedSpeed = Math.hypot(combinedVx, combinedVy)
        const speedScale = combinedSpeed > MAX_SPEED ? MAX_SPEED / combinedSpeed : 1
        return { ...state, phase: 'simulating', aim: null, pendingShot: null, puck: { ...state.puck, vx: combinedVx * speedScale, vy: combinedVy * speedScale } }
      }

      case 'PHYSICS_STEP': {
        if (state.phase !== 'simulating') return state
        const result = stepPhysics(state.puck, action.board, action.dt, friction)

        if (result.scored !== null) {
          const scores: [number, number] = [state.scores[0], state.scores[1]]
          scores[result.scored - 1]++
          const puck: PuckState = { x: result.x, y: result.y, vx: 0, vy: 0 }
          // Player 1 scores by entering the TOP goal (attacking, not their own crease — see
          // physics.ts's stepPhysics), so the celebration's physical side is the inverse of the
          // scoring player number.
          const lastScoredGoal = result.scored === 1 ? 'top' : 'bottom'
          // Any in-progress intercept attempt is moot — the original shot found the net before
          // anyone redirected it, so there's nothing left to strike.
          if (scores[result.scored - 1] >= scoreToWin) {
            return { ...state, phase: 'gameOver', scores, puck, lastScoredGoal, interceptAim: null }
          }
          return { ...state, phase: 'scored', scores, puck, lastScoredGoal, currentPlayer: otherPlayer(state.currentPlayer), interceptAim: null }
        }

        // Suppressed while someone's actively mid-drag intercepting (state.interceptAim !== null)
        // — otherwise falls through to the generic "still simulating" return below, same as any
        // other still-moving frame. This is deliberate, not an oversight: the whole precondition
        // for an intercept existing at all is that the puck was ALREADY slow, so on a real human
        // drag timescale it very often decays the rest of the way to STOP_THRESHOLD while they're
        // still deciding their shot. An earlier version force-zeroed velocity and flipped phase to
        // 'aiming' the instant that happened ("seamlessly promoting" the drag) — but that's exactly
        // the freeze real user feedback flagged: "the puck stops while aiming" defeats the entire
        // point of a fluid mid-slide hit. Letting the puck simply keep resolving its own physics
        // (settling to rest on its own terms is fine; forcing a phase/velocity snap under an active
        // drag is not) until STRIKE or AIM_CANCEL actually resolves it is what keeps it fluid.
        if (result.stopped && !state.interceptAim) {
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
        // 'faceoff' mode repeats the draw after every goal (real hockey rule): puck goes back to
        // dead center for a fresh countdown. 'coinFlip' mode never repeats the flip itself — the
        // goal that just happened already handed possession to the player who conceded it (see
        // PHYSICS_STEP's 'scored' branch above) — but still places the puck at one of THAT
        // player's own rink faceoff dots (action.zoneIndex, randomized by the caller) rather than
        // dead center, so every round in this mode opens the same way: puck sitting at a zone, no
        // separate announcement needed.
        const puckPos = tipoffMode === 'faceoff' ? centerPuck(action.board) : faceoffZoneCenter(action.board, state.currentPlayer, action.zoneIndex)
        return {
          ...state,
          phase: tipoffMode === 'faceoff' ? 'faceoff' : 'idle',
          puck: { ...puckPos, vx: 0, vy: 0 },
          aim: null,
          lastScoredGoal: null,
          // Every post-goal draw gates on both players readying up too (see FaceoffState's doc
          // comment) — not just the game's first draw.
          faceoff: tipoffMode === 'faceoff' ? initialFaceoffState(action.faceoffZones, action.faceoffReadyGuess) : null,
          faceoffRound: tipoffMode === 'faceoff' ? state.faceoffRound + 1 : state.faceoffRound
        }
      }

      case 'RESET':
        return makeInitialState(action.board, tipoffMode, action.coinFlipWinner, action.zoneIndex, action.faceoffZones, action.faceoffReadyGuess)

      // Fired by game.tsx's own COIN_FLIP_TOTAL_MS timer once the coin-flip ceremony (Board.tsx)
      // finishes playing — the winner/puck placement were already decided back at RESET (see
      // makeInitialState above), so this is nothing more than handing control to the winner,
      // identically to how 'faceoff' mode's FACEOFF_LAUNCH hands off once ITS own ceremony
      // resolves.
      case 'COIN_FLIP_DONE':
        if (state.phase !== 'coinFlip') return state
        return { ...state, phase: 'idle' }

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
      // unconditional, so whether the knock scores or misses, the very next real turn always goes
      // to the loser — the winner never gets a follow-up shot of their own off of it. Real user
      // feedback, explicit: a knock into enemy territory PLUS a follow-up shot for the same player
      // who won it would be "way too easy" — the knock alone is the edge, nothing more.
      case 'FACEOFF_LAUNCH': {
        if (state.phase !== 'faceoff' || !state.faceoff || state.faceoff.stage !== 'resolved' || !state.faceoff.result) return state
        return { ...state, phase: 'simulating', currentPlayer: state.faceoff.result.winner, faceoff: null, puck: { ...state.puck, vx: action.vx, vy: action.vy } }
      }

      // Restarts the current draw from scratch — dispatched by useFaceoff.ts when the app returns
      // from the background mid-race, or when a pause dialog (settings/quit-confirm) closes
      // mid-draw, since a suspended setTimeout chain can't be trusted to resume with correct
      // relative timing (see useFaceoff.ts's AppState listener and its pause-resume effect).
      // Bumping faceoffRound (not just resetting `faceoff`) is what lets that hook's
      // timer-scheduling effect tell "a real restart happened" apart from `faceoff`'s object
      // identity changing on every ordinary sub-action (count ticks, taps, ...), which it
      // otherwise ignores. Reuses the interrupted draw's own zones AND readyGuess rather than
      // re-randomizing either — this is a resume, not a new draw. Always lands back on 'ready', so
      // a restart always waits for both players to signal again before the countdown resumes.
      case 'FACEOFF_RESTART':
        if (state.phase !== 'faceoff' || !state.faceoff) return state
        return { ...state, faceoff: initialFaceoffState(state.faceoff.zones, state.faceoff.readyGuess), faceoffRound: state.faceoffRound + 1 }

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
  // eslint-disable-next-line react-hooks/refs -- see comment above
  reducerRef.current = makeReducer(scoreToWin, tipoffMode, friction, controlScheme, interceptThreshold)

  const [state, dispatch] = useReducer(
    // eslint-disable-next-line react-hooks/refs -- see reducerRef's own comment above; only ever invoked from dispatch, never during render
    (s: GameState, a: Action) => reducerRef.current(s, a),
    { board, scoreToWin, tipoffMode },
    (init) => makeInitialState(init.board, init.tipoffMode, randomPlayer(), randomZoneIndex(), randomFaceoffZones(), randomReadyGuess())
  )

  const boardRef = useRef(board)
  // eslint-disable-next-line react-hooks/refs -- mirrored every render so the physics rAF loop below always reads the current board layout
  boardRef.current = board

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
  useGameLoop((dt) => dispatch({ type: 'PHYSICS_STEP', board: boardRef.current, dt, interceptTouch: interceptTouchRef.current }), { enabled: state.phase === 'simulating' && !paused, maxDt: 2.5 })

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

  // dx/dy is the raw drag (release position minus start position), passed through unsigned — the
  // STRIKE case above is what actually applies the shooting player's own ControlScheme sign to
  // vx/vy, so this only has to gate the dual cancel check: a real shot needs BOTH a large enough
  // net displacement (protects the "snap back near start to abort" cancel affordance) AND a fast
  // enough release velocity (protects against "dragged out far, released gently" producing a limp
  // accidental shot) — see MIN_SHOOT_DRAG/MIN_FLICK_VELOCITY's own comments in constants/game.ts.
  const shoot = useCallback((dx: number, dy: number, vx: number, vy: number) => {
    const dist = Math.sqrt(dx * dx + dy * dy)
    const speed = Math.sqrt(vx * vx + vy * vy)
    if (dist < MIN_SHOOT_DRAG || speed < MIN_FLICK_VELOCITY) {
      dispatch({ type: 'AIM_CANCEL' })
      return
    }
    dispatch({ type: 'STRIKE', vx, vy })
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

  return { state, tryAimStart, aimUpdate, aimCancel, shoot, applyStrike, nextRound, resetGame, coinFlipDone, faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart, setInterceptTouch }
}
