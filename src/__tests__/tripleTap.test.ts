// 'tripleTap' tip-off mode (see TipoffMode's own doc comment in types/index.ts): each player
// presses their own single zone twice, then their third press is a swipe whose vector is captured.
// The launch velocity is the plain vector SUM of both players' swipes (combineAndClampVelocity, the
// same clamp-to-MAX_SPEED helper the ordinary shot mechanic already uses) — there is no shared
// countdown/beat and no timeout, so the reducer just waits until both swipes land, however long
// that takes and in whatever order the two players' gesture threads happen to dispatch in.

import { FRICTION_LEVELS, MAX_SPEED } from '@/constants/game'
import { combineAndClampVelocity, makeReducer } from '@/hooks/useGameState'
import { BoardLayout, ControlScheme, GameState, Player, TripleTapState } from '@/types'

// Same synthetic board faceoff.test.ts/turnAlternation.test.ts use.
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

const CONTROL_SCHEME: Record<Player, ControlScheme> = { 1: 'pull', 2: 'pull' }

function other(p: Player): Player {
  return p === 1 ? 2 : 1
}

describe('combineAndClampVelocity bounds (tripleTap launch combine)', () => {
  it('never exceeds MAX_SPEED for 200 random vector pairs', () => {
    for (let i = 0; i < 200; i++) {
      const v1x = (Math.random() * 2 - 1) * MAX_SPEED
      const v1y = (Math.random() * 2 - 1) * MAX_SPEED
      const v2x = (Math.random() * 2 - 1) * MAX_SPEED
      const v2y = (Math.random() * 2 - 1) * MAX_SPEED
      const combined = combineAndClampVelocity(v1x, v1y, v2x, v2y)
      expect(Math.hypot(combined.vx, combined.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-9)
    }
  })

  it('two already-max-speed vectors summed in the same direction clamp to MAX_SPEED, not 2x', () => {
    const combined = combineAndClampVelocity(MAX_SPEED, 0, MAX_SPEED, 0)
    expect(Math.hypot(combined.vx, combined.vy)).toBeCloseTo(MAX_SPEED, 9)
  })

  it('two opposing swipes can partly (or fully) cancel — this is authentic "stick clash" behavior, not a bug', () => {
    const combined = combineAndClampVelocity(10, 0, -10, 0)
    expect(combined.vx).toBeCloseTo(0)
    expect(combined.vy).toBeCloseTo(0)
  })
})

describe('tripleTap reducer sequencing', () => {
  const reducer = makeReducer(5, 'tripleTap', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)

  function makeLiveTripleTapState(overrides: Partial<TripleTapState> = {}): GameState {
    const tripleTap: TripleTapState = {
      tapCount: [0, 0],
      pressFlash: [null, null],
      swipeStartedAt: [null, null],
      swipe: [null, null],
      result: null,
      ...overrides
    }
    return {
      phase: 'tripleTap',
      currentPlayer: 1,
      scores: [0, 0],
      puck: { x: board.centerX, y: board.centerY, vx: 0, vy: 0 },
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
      tripleTap,
      tripleTapRound: 0
    }
  }

  it('waits patiently — one player finishes all 3 inputs, the other has not even started: no result yet, phase unchanged', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 50, dy: -50 })
    expect(s.tripleTap?.result).toBeNull()
    expect(s.phase).toBe('tripleTap')
    expect(s.tripleTap?.swipe[0]).not.toBeNull()
    expect(s.tripleTap?.swipe[1]).toBeNull()
  })

  it('winner is whichever player initiated their own swipe first — P1 first, even though P1s SWIPE_END is dispatched last', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 120 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 170 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 2, atMs: 250 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: 10, dy: -10 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 20, dy: -20 })
    expect(s.tripleTap?.result?.winner).toBe(1)
  })

  it('winner is whichever player initiated their own swipe first — P2 first', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 120 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 170 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 2, atMs: 200 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 250 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 10, dy: -10 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: 10, dy: 10 })
    expect(s.tripleTap?.result?.winner).toBe(2)
  })

  it('winner reflects stored swipeStartedAt timestamps, not which order the two SWIPE_END actions are dispatched in', () => {
    const runWithOrder = (resolveWithPlayer1Last: boolean) => {
      let s = makeLiveTripleTapState()
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 120 })
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 170 })
      s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 }) // P1 genuinely first
      s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 2, atMs: 300 })
      if (resolveWithPlayer1Last) {
        s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: 5, dy: -5 })
        s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 5, dy: -5 })
      } else {
        s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 5, dy: -5 })
        s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: 5, dy: -5 })
      }
      return s
    }
    expect(runWithOrder(true).tripleTap?.result?.winner).toBe(1)
    expect(runWithOrder(false).tripleTap?.result?.winner).toBe(1)
  })

  it('an exact tie in swipeStartedAt breaks toward whichever player dispatched the resolving SWIPE_END', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 120 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 170 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 2, atMs: 200 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 5, dy: -5 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: 5, dy: 5 })
    expect(s.tripleTap?.result?.winner).toBe(2)
  })

  it('result.vx/vy is the vector sum of both players own captured swipes, clamped to MAX_SPEED', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 120 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 170 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 2, atMs: 250 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 30, dy: 0 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: 0, dy: 30 })
    const [p1Swipe, p2Swipe] = s.tripleTap!.swipe
    const expected = combineAndClampVelocity(p1Swipe!.vx, p1Swipe!.vy, p2Swipe!.vx, p2Swipe!.vy)
    expect(s.tripleTap!.result!.vx).toBeCloseTo(expected.vx)
    expect(s.tripleTap!.result!.vy).toBeCloseTo(expected.vy)
  })

  it('TRIPLE_TAP_PRESS past tapCount 2 is a true no-op (same state reference)', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    expect(s.tripleTap?.tapCount[0]).toBe(2)
    const next = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 200 })
    expect(next).toBe(s)
  })

  it('a duplicate TRIPLE_TAP_SWIPE_START once already started is a no-op — the first timestamp is never overwritten', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 })
    const next = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 999 })
    expect(next).toBe(s)
    expect(next.tripleTap?.swipeStartedAt[0]).toBe(200)
  })

  it('a duplicate TRIPLE_TAP_SWIPE_END once already captured is a no-op — the first swipe is never overwritten', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 })
    s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 10, dy: -10 })
    const next = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 999, dy: 999 })
    expect(next).toBe(s)
  })

  it('TRIPLE_TAP_SWIPE_START before tapCount reaches 2 is rejected', () => {
    const s = makeLiveTripleTapState({ tapCount: [1, 0] })
    const next = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 500 })
    expect(next).toBe(s)
  })

  it('TRIPLE_TAP_SWIPE_END before tapCount reaches 2 is rejected', () => {
    const s = makeLiveTripleTapState({ tapCount: [1, 0] })
    const next = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 10, dy: -10 })
    expect(next).toBe(s)
  })

  describe('TRIPLE_TAP_LAUNCH', () => {
    it('only transitions once result is set', () => {
      const s = makeLiveTripleTapState()
      const next = reducer(s, { type: 'TRIPLE_TAP_LAUNCH', vx: 1, vy: 1 })
      expect(next).toBe(s)
    })

    it('sets the combined velocity, hands currentPlayer to the winner, and clears tripleTap', () => {
      let s = makeLiveTripleTapState()
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 120 })
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 170 })
      s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 200 })
      s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_START', player: 2, atMs: 250 })
      s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: 40, dy: -40 })
      s = reducer(s, { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: 40, dy: -40 })
      const result = s.tripleTap?.result
      expect(result).not.toBeNull()
      const next = reducer(s, { type: 'TRIPLE_TAP_LAUNCH', vx: result!.vx, vy: result!.vy })
      expect(next.phase).toBe('simulating')
      expect(next.currentPlayer).toBe(result!.winner)
      expect(next.tripleTap).toBeNull()
      expect(next.puck.vx).toBeCloseTo(result!.vx)
      expect(next.puck.vy).toBeCloseTo(result!.vy)
    })
  })
})

// ─── Turn-alternation fuzz — tipoffMode: 'tripleTap' (reducer level, no React, no timers) ────────
// Self-contained rather than folded into turnAlternation.test.ts's own shared driveFuzzRun/
// resolveFaceoffDraw, to keep this feature's blast radius off that already-passing suite. Each
// iteration is an independent fresh draw (RESET), so this is scoped to what's actually NEW here —
// does a tripleTap draw's own resolution correctly interact with PHYSICS_STEP's existing,
// already-tested unconditional turn-flip rules — not re-proving those rules generically (that's
// turnAlternation.test.ts's own job for 'faceoff'/'coinFlip').
function mulberry32(seed: number) {
  let s = seed
  return function (): number {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number
type Reducer = ReturnType<typeof makeReducer>
type TripleTapAction = { type: 'TRIPLE_TAP_PRESS'; player: Player; atMs: number } | { type: 'TRIPLE_TAP_SWIPE_START'; player: Player; atMs: number } | { type: 'TRIPLE_TAP_SWIPE_END'; player: Player; dx: number; dy: number }

// Randomly riffles two ordered streams together, preserving each stream's own internal order —
// unlike a plain full shuffle, this can never reorder ONE player's own 3 actions relative to each
// other (a single player's own presses/swipe are always strictly sequential in real play, driven
// by the same finger one gesture at a time; only the RELATIVE order between the two different
// players' independent streams is genuinely arbitrary — see TripleTapState's own doc comment on
// why the reducer has to read stored timestamps rather than trust dispatch order for exactly that
// between-players case).
function interleave<T>(a: T[], b: T[], rng: Rng): T[] {
  const result: T[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i >= a.length) result.push(b[j++])
    else if (j >= b.length) result.push(a[i++])
    else result.push(rng() < 0.5 ? a[i++] : b[j++])
  }
  return result
}

function driveTripleTapFuzzRun(totalDraws: number, seed: number): { draws: number; goals: number; misses: number } {
  const reducer: Reducer = makeReducer(999, 'tripleTap', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
  const rng = mulberry32(seed)

  let draws = 0
  let goals = 0
  let misses = 0

  while (draws < totalDraws) {
    let state = reducer({ phase: 'idle', currentPlayer: 1, scores: [0, 0], puck: { x: 0, y: 0, vx: 0, vy: 0 }, aim: null, interceptAim: null, pendingShot: null, bounceCount: 0, lastScoredGoal: null, wellEnterCount: 0, lastWellPolarity: null, goalDoorHitCount: 0, lastGoalDoorSide: null, faceoff: null, faceoffRound: 0, tripleTap: null, tripleTapRound: 0 }, { type: 'RESET', board, coinFlipWinner: 1, zoneIndex: 0, faceoffZones: [0, 1], faceoffReadyGuess: [0, 1] })
    if (state.phase !== 'tripleTap') throw new Error(`expected 'tripleTap' after RESET, got '${state.phase}'`)

    const p1Angle = rng() * Math.PI * 2
    const p2Angle = rng() * Math.PI * 2
    const p1Mag = 20 + rng() * 100
    const p2Mag = 20 + rng() * 100
    const p1Actions: TripleTapAction[] = [
      { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 10 },
      { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 20 },
      { type: 'TRIPLE_TAP_SWIPE_START', player: 1, atMs: 100 + rng() * 200 },
      { type: 'TRIPLE_TAP_SWIPE_END', player: 1, dx: Math.cos(p1Angle) * p1Mag, dy: Math.sin(p1Angle) * p1Mag }
    ]
    const p2Actions: TripleTapAction[] = [
      { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 15 },
      { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 25 },
      { type: 'TRIPLE_TAP_SWIPE_START', player: 2, atMs: 100 + rng() * 200 },
      { type: 'TRIPLE_TAP_SWIPE_END', player: 2, dx: Math.cos(p2Angle) * p2Mag, dy: Math.sin(p2Angle) * p2Mag }
    ]
    // The relative order BETWEEN the two players' own streams must not affect the outcome — see
    // the dedicated dispatch-order-independence test above; this fuzz hammers that invariant across
    // many random interleavings too.
    for (const a of interleave(p1Actions, p2Actions, rng)) state = reducer(state, a)

    if (!state.tripleTap?.result) {
      throw new Error(`tripleTap draw did not resolve after all 8 actions. Final tripleTap: ${JSON.stringify(state.tripleTap)}`)
    }
    const winner = state.tripleTap.result.winner
    state = reducer(state, { type: 'TRIPLE_TAP_LAUNCH', vx: state.tripleTap.result.vx, vy: state.tripleTap.result.vy })
    if (state.phase !== 'simulating') throw new Error(`TRIPLE_TAP_LAUNCH did not enter 'simulating' (phase: ${state.phase})`)
    if (state.currentPlayer !== winner) throw new Error(`currentPlayer (${state.currentPlayer}) !== tripleTap winner (${winner}) right after launch`)

    draws++
    const scoresBeforeLaunch = state.scores
    let steps = 0
    while (state.phase === 'simulating' && steps < 2000) {
      state = reducer(state, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
      steps++
    }
    if (state.phase === 'simulating') throw new Error('PHYSICS_STEP did not resolve within the step budget')

    if (state.phase === 'scored') {
      goals++
      const scorer: Player = state.scores[0] !== scoresBeforeLaunch[0] ? 1 : 2
      if (state.currentPlayer !== other(scorer)) {
        throw new Error(`TURN ALTERNATION BUG: after tripleTap winner ${winner}'s launch scored for player ${scorer}, currentPlayer is ${state.currentPlayer} (expected the conceding player, ${other(scorer)})`)
      }
    } else if (state.phase === 'idle') {
      misses++
      if (state.currentPlayer !== other(winner)) {
        throw new Error(`TURN ALTERNATION BUG: after tripleTap winner ${winner}'s launch missed, currentPlayer is ${state.currentPlayer} (expected the loser, ${other(winner)})`)
      }
    } else {
      throw new Error(`unexpected phase '${state.phase}' after a tripleTap-launched shot resolved`)
    }
  }

  return { draws, goals, misses }
}

describe('turn alternation fuzz — tipoffMode: tripleTap (reducer level, no React, no timers)', () => {
  it('never gives the launch winner a follow-up turn, hit or miss, across 60 independent draws, in randomized dispatch order', () => {
    const summary = driveTripleTapFuzzRun(60, 424242)
    expect(summary.draws).toBe(60)
    // eslint-disable-next-line no-console
    console.log('tripleTap fuzz summary:', JSON.stringify(summary, null, 2))
  })

  it('a second, differently-seeded run also holds (defense against a seed-specific fluke)', () => {
    const summary = driveTripleTapFuzzRun(60, 13579)
    expect(summary.draws).toBe(60)
  })
})
