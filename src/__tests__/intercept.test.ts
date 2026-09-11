// Mid-slide puck interception (see InterceptSpeed in src/types/index.ts) — the RECEIVING player
// (whoever doesn't currently hold GameState.currentPlayer) can reach in and redirect a still-
// coasting puck once its speed drops under interceptThreshold, without waiting for a full natural
// stop. Drives the real reducer (makeReducer in src/hooks/useGameState.ts) via pure dispatch()
// calls — no React, no timers, no physics simulation loop (each test seeds a puck velocity/phase
// directly rather than simulating a shot down to that state).

import { FRICTION_LEVELS, MAX_SPEED, MAX_STICK_PULLBACK_PIXELS } from '@/constants/game'
import { makeReducer } from '@/hooks/useGameState'
import { BoardLayout, ControlScheme, GameState, Player } from '@/types'

// Same synthetic board turnAlternation.test.ts/physics.test.ts use — flat rectangle, no
// obstacles/wells/posts, so geometry never interferes with these reducer-level assertions.
const board: BoardLayout = {
  x: 10,
  y: 10,
  width: 300,
  height: 500,
  wallThickness: 8,
  goalWidth: 80,
  goalLeft: 110,
  goalRight: 190,
  puckRadius: 18,
  centerX: 160,
  centerY: 260,
  obstacles: [],
  gravityWells: [],
  goalPosts: [],
  wallPosts: [],
  cornerRadius: 0,
  behindGoalDepth: 0,
  faceoffOffsetYRatio: 0.42,
  boardMarginTop: 0
}

const INTERCEPT_THRESHOLD = 1.0

function other(p: Player): Player {
  return p === 1 ? 2 : 1
}

// A structurally-valid GameState for 'simulating' with a given puck velocity — the throwaway base
// every test here starts from and overrides.
function simulatingState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'simulating',
    currentPlayer: 1,
    scores: [0, 0],
    puck: { x: board.centerX, y: board.centerY, vx: 0.5, vy: 0 },
    aim: null,
    interceptAim: null,
    pendingShot: null,
    bounceCount: 0,
    lastScoredGoal: null,
    wellEnterCount: 0,
    lastWellPolarity: null,
    goalDoorHitCount: 0,
    lastGoalDoorSide: null,
    faceoff: null,
    faceoffRound: 0,
    ...overrides
  }
}

describe('AIM_START during simulating (intercept)', () => {
  it('succeeds when the puck is below interceptThreshold', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const state = simulatingState({ puck: { x: 100, y: 100, vx: 0.5, vy: 0 } })
    const next = reducer(state, { type: 'AIM_START', x: 100, y: 100 })
    expect(next.interceptAim).toEqual({ startX: 100, startY: 100, currentX: 100, currentY: 100, vx: 0, vy: 0 })
    // Deferred to STRIKE (see useGameState.ts's own comment) — an intercept attempt doesn't touch
    // phase or currentPlayer until it's actually struck.
    expect(next.phase).toBe('simulating')
    expect(next.currentPlayer).toBe(1)
  })

  it('no-ops when the puck speed is at or above interceptThreshold', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const state = simulatingState({ puck: { x: 100, y: 100, vx: 5, vy: 0 } })
    const next = reducer(state, { type: 'AIM_START', x: 100, y: 100 })
    expect(next.interceptAim).toBeNull()
    expect(next).toBe(state) // untouched — same reference, true no-op
  })

  it('no-ops when an interceptAim is already in progress', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const state = simulatingState({
      puck: { x: 100, y: 100, vx: 0.5, vy: 0 },
      interceptAim: { startX: 50, startY: 50, currentX: 50, currentY: 50, vx: 0, vy: 0 }
    })
    const next = reducer(state, { type: 'AIM_START', x: 200, y: 200 })
    // A second AIM_START doesn't clobber the first attempt's own start position.
    expect(next.interceptAim).toEqual({ startX: 50, startY: 50, currentX: 50, currentY: 50, vx: 0, vy: 0 })
  })
})

describe('STRIKE on an in-progress interceptAim', () => {
  const MISMATCHED_SCHEME: Record<Player, ControlScheme> = { 1: 'pull', 2: 'push' }

  it("signs the shot by the INTERCEPTOR's own ControlScheme, not the shooter's", () => {
    // Player 1 is the shooter (currentPlayer), Player 2 is intercepting — schemes deliberately
    // mismatched (P1 pull, P2 push) so a sign regression (using the shooter's scheme instead of
    // the interceptor's) would flip the resulting velocity's sign and fail this assertion.
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, MISMATCHED_SCHEME, INTERCEPT_THRESHOLD)
    const state = simulatingState({
      currentPlayer: 1,
      puck: { x: 100, y: 100, vx: 0.5, vy: 0 },
      interceptAim: { startX: 100, startY: 100, currentX: 140, currentY: 100, vx: 0, vy: 0 }
    })
    const pullResult = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)(state, { type: 'STRIKE', dx: 40, dy: 0, vx: 0, vy: 0 })
    const pushResult = reducer(state, { type: 'STRIKE', dx: 40, dy: 0, vx: 0, vy: 0 })
    // 'pull' fires opposite the drag, 'push' fires along it — same magnitude, opposite sign.
    expect(pushResult.pendingShot!.vx).toBeCloseTo(-pullResult.pendingShot!.vx, 10)
  })

  it('flips currentPlayer to the interceptor and clears interceptAim', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const state = simulatingState({
      currentPlayer: 1,
      puck: { x: 100, y: 100, vx: 0.5, vy: 0 },
      interceptAim: { startX: 100, startY: 100, currentX: 140, currentY: 100, vx: 0, vy: 0 }
    })
    const next = reducer(state, { type: 'STRIKE', dx: 40, dy: 0, vx: 0, vy: 0 })
    expect(next.phase).toBe('striking')
    expect(next.currentPlayer).toBe(2)
    expect(next.interceptAim).toBeNull()
    expect(next.aim).toEqual({ startX: 100, startY: 100, currentX: 140, currentY: 100, vx: 0, vy: 0 })
    expect(next.pendingShot).not.toBeNull()
  })
})

describe('PHYSICS_STEP with an unstruck interceptAim in progress', () => {
  it('a goal still hands possession by the untouched otherPlayer(currentPlayer) formula, and clears the abandoned interceptAim', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    // Puck heading straight for the top goal, fast enough to fully clear the line this step —
    // scores for player 1 (top goal) regardless of the in-progress (never struck) intercept below.
    const state = simulatingState({
      currentPlayer: 1,
      puck: { x: board.centerX, y: board.y + 5, vx: 0, vy: -40 },
      interceptAim: { startX: 100, startY: 100, currentX: 120, currentY: 100, vx: 0, vy: 0 }
    })
    const next = reducer(state, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('scored')
    expect(next.currentPlayer).toBe(other(state.currentPlayer))
    expect(next.interceptAim).toBeNull()
  })

  it('a natural full stop is suppressed while intercepting — the puck keeps resolving physics instead of freezing into a normal aiming turn', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    // Velocity already below STOP_THRESHOLD (0.12) — stepPhysics reports stopped on this very step.
    // An earlier version force-zeroed velocity and flipped phase to 'aiming' here ("seamless
    // promotion") — real user feedback ("the puck stops while aiming") caught that this defeated
    // the whole point: the puck must keep coasting under a live drag, not snap to a frozen rest.
    const state = simulatingState({
      currentPlayer: 1,
      puck: { x: board.centerX, y: board.centerY, vx: 0.05, vy: 0.05 },
      interceptAim: { startX: 100, startY: 100, currentX: 120, currentY: 100, vx: 0, vy: 0 }
    })
    const next = reducer(state, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('simulating')
    expect(next.currentPlayer).toBe(1) // unchanged — still deferred to STRIKE
    expect(next.interceptAim).toEqual({ startX: 100, startY: 100, currentX: 120, currentY: 100, vx: 0, vy: 0 })
    // Velocity is whatever stepPhysics actually computed for this step — NOT force-zeroed.
    expect(next.puck.vx).not.toBe(0)

    // The drag is still fully live from here: AIM_UPDATE/STRIKE/APPLY_STRIKE all behave exactly as
    // they would against any other in-progress intercept.
    const updated = reducer(next, { type: 'AIM_UPDATE', x: 130, y: 100, vx: 100, vy: 0 })
    expect(updated.interceptAim!.currentX).toBe(130)
    const struck = reducer(updated, { type: 'STRIKE', dx: 30, dy: 0, vx: 0, vy: 0 })
    expect(struck.phase).toBe('striking')
    expect(struck.currentPlayer).toBe(2) // flips only now, at STRIKE
    expect(struck.interceptAim).toBeNull()
    const applied = reducer(struck, { type: 'APPLY_STRIKE' })
    expect(applied.phase).toBe('simulating')
    expect(applied.puck.vx).not.toBe(0)
  })

  it('once truly at rest under an active intercept, PHYSICS_STEP keeps returning the same resting state indefinitely rather than forcing a resolution', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const state = simulatingState({
      currentPlayer: 1,
      puck: { x: board.centerX, y: board.centerY, vx: 0, vy: 0 },
      interceptAim: { startX: 100, startY: 100, currentX: 120, currentY: 100, vx: 0, vy: 0 }
    })
    const next = reducer(state, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('simulating')
    expect(next.interceptAim).not.toBeNull()
    expect(next.puck.vx).toBe(0)
    expect(next.puck.vy).toBe(0)
    // A second tick changes nothing further — no runaway state, no forced handoff.
    const again = reducer(next, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(again.phase).toBe('simulating')
    expect(again.interceptAim).not.toBeNull()
  })
})

describe('end-to-end: faceoff knock intercepted mid-coast by the loser', () => {
  it("the loser can intercept the winner's own knock before it settles, and the intercept resolves normally", () => {
    const reducer = makeReducer(999, 'faceoff', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const resolvedFaceoffState: GameState = {
      ...simulatingState(),
      phase: 'faceoff',
      currentPlayer: 1,
      puck: { x: board.centerX, y: board.centerY, vx: 0, vy: 0 },
      faceoff: {
        stage: 'resolved',
        ready: [true, true],
        count: null,
        zones: [0, 1],
        readyGuess: [1, 0],
        goAt: 0,
        tapAt: [10, null],
        disqualified: [false, false],
        pressFlash: [10, null],
        result: { winner: 1, marginMs: 200, reactionMs: 10, forfeit: false }
      }
    }
    // Winner's knock — slow on purpose so it's immediately within the interceptable band.
    const launched = reducer(resolvedFaceoffState, { type: 'FACEOFF_LAUNCH', vx: 0.5, vy: 0 })
    expect(launched.phase).toBe('simulating')
    expect(launched.currentPlayer).toBe(1) // winner, for the duration of the knock only

    // Player 2 (the loser, per the codebase's own hard "loser always takes the next turn" rule)
    // reaches in before the knock settles.
    const intercepted = reducer(launched, { type: 'AIM_START', x: launched.puck.x, y: launched.puck.y })
    expect(intercepted.interceptAim).not.toBeNull()
    expect(intercepted.currentPlayer).toBe(1) // still not flipped — deferred to STRIKE

    const struck = reducer(intercepted, { type: 'STRIKE', dx: 40, dy: 0, vx: 0, vy: 0 })
    expect(struck.currentPlayer).toBe(2)
    expect(struck.phase).toBe('striking')

    const applied = reducer(struck, { type: 'APPLY_STRIKE' })
    expect(applied.phase).toBe('simulating')
    expect(applied.puck.vx).not.toBe(0)
  })
})

describe("APPLY_STRIKE combines the puck's own pre-strike velocity into the shot (slap-shot feel)", () => {
  it("adds the puck's residual velocity to the swing rather than discarding it", () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const state = simulatingState({
      currentPlayer: 1,
      puck: { x: 100, y: 100, vx: 0.5, vy: 0.2 },
      interceptAim: { startX: 100, startY: 100, currentX: 140, currentY: 100, vx: 0, vy: 0 }
    })
    const struck = reducer(state, { type: 'STRIKE', dx: 40, dy: 0, vx: 0, vy: 0 })
    const applied = reducer(struck, { type: 'APPLY_STRIKE' })
    // Well under MAX_SPEED here, so no clamping kicks in — the result should be an exact vector sum.
    expect(applied.puck.vx).toBeCloseTo(state.puck.vx + struck.pendingShot!.vx, 10)
    expect(applied.puck.vy).toBeCloseTo(state.puck.vy + struck.pendingShot!.vy, 10)
  })

  it('is a strict no-op for an ordinary (non-intercept) shot, since the puck is always at rest entering a normal turn', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    const state = simulatingState({ phase: 'striking', puck: { x: 100, y: 100, vx: 0, vy: 0 }, pendingShot: { vx: 5, vy: -3 } })
    const applied = reducer(state, { type: 'APPLY_STRIKE' })
    expect(applied.puck.vx).toBe(5)
    expect(applied.puck.vy).toBe(-3)
  })

  it('clamps the combined velocity to MAX_SPEED rather than letting a full-power swing onto an already-fast puck exceed it', () => {
    const reducer = makeReducer(999, 'coinFlip', FRICTION_LEVELS.medium, { 1: 'pull', 2: 'pull' }, INTERCEPT_THRESHOLD)
    // A near-max-power swing straight along the puck's own direction of travel — the raw sum would
    // exceed MAX_SPEED, since both components are independently already close to it.
    const state = simulatingState({
      currentPlayer: 1,
      puck: { x: 100, y: 100, vx: MAX_SPEED * 0.5, vy: 0 },
      interceptAim: { startX: 100, startY: 100, currentX: 100, currentY: 100, vx: 0, vy: 0 }
    })
    // 'pull' fires opposite the drag — drag left (negative dx) to fire right (positive vx), same
    // direction as the puck's own incoming velocity. Full-power magnitude (MAX_STICK_PULLBACK_PIXELS)
    // so the resulting shot itself maxes out.
    const struck = reducer(state, { type: 'STRIKE', dx: -MAX_STICK_PULLBACK_PIXELS, dy: 0, vx: 0, vy: 0 })
    const applied = reducer(struck, { type: 'APPLY_STRIKE' })
    const rawSum = state.puck.vx + struck.pendingShot!.vx
    expect(rawSum).toBeGreaterThan(MAX_SPEED) // sanity-check the test actually exercises the clamp
    expect(Math.hypot(applied.puck.vx, applied.puck.vy)).toBeCloseTo(MAX_SPEED, 5)
  })
})
