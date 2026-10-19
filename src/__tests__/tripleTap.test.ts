// 'tripleTap' tip-off mode (see TipoffMode's own doc comment in types/index.ts): both players tap
// their own half TRIPLE_TAP_TAPS times in step (a tap only counts while you aren't already ahead),
// then race to swipe. The first real swipe (judged like a flick shot) launches the puck at once;
// the other player's swipe within TRIPLE_TAP_CLASH_WINDOW_MS is added onto the moving puck
// (combineAndClampVelocity, the same clamp-to-MAX_SPEED helper the ordinary shot mechanic uses).

import { FRICTION_LEVELS, MAX_SPEED, MIN_FLICK_VELOCITY, MIN_SHOOT_DRAG, TRIPLE_TAP_CLASH_WINDOW_MS, TRIPLE_TAP_TAPS } from '@/constants/game'
import { canTripleTap, combineAndClampVelocity, makeReducer } from '@/hooks/useGameState'
import { BoardLayout, ControlScheme, GameState, Player, TripleTapState } from '@/types'
import { planTripleTapSwipe } from '@/utils/aiOpponent'

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

  it('two opposing swipes can partly (or fully) cancel - this is authentic "stick clash" behavior, not a bug', () => {
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
      swipe: [null, null],
      clashUntil: null,
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

  const armed = (): GameState => makeLiveTripleTapState({ tapCount: [TRIPLE_TAP_TAPS, TRIPLE_TAP_TAPS] })
  // A clearly-real flick, straight up (toward P2's goal at the top).
  const UP = { dx: 0, dy: -MIN_SHOOT_DRAG * 3, vx: 0, vy: -900 }
  const swipe = (player: Player, atMs: number, g = UP) => ({ type: 'TRIPLE_TAP_SWIPE' as const, player, atMs, ...g })

  it('keeps the taps in step: a player can lead by one tap, then further taps are ignored until the other catches up', () => {
    let s = makeLiveTripleTapState()
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 100 })
    const ahead = s
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 150 })
    expect(s).toBe(ahead)
    expect(s.tripleTap?.tapCount).toEqual([1, 0])
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: 160 })
    s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: 170 })
    expect(s.tripleTap?.tapCount).toEqual([2, 1])
  })

  it('counts exactly TRIPLE_TAP_TAPS taps per player, and no more', () => {
    let s = makeLiveTripleTapState()
    for (let i = 0; i < TRIPLE_TAP_TAPS + 2; i++) {
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 1, atMs: i * 10 })
      s = reducer(s, { type: 'TRIPLE_TAP_PRESS', player: 2, atMs: i * 10 + 5 })
    }
    expect(s.tripleTap?.tapCount).toEqual([TRIPLE_TAP_TAPS, TRIPLE_TAP_TAPS])
    expect(canTripleTap(s.tripleTap!, 1)).toBe(false)
  })

  it('ignores a swipe until BOTH players have every tap in, even the player who finished first', () => {
    const s = makeLiveTripleTapState({ tapCount: [TRIPLE_TAP_TAPS, TRIPLE_TAP_TAPS - 1] })
    expect(reducer(s, swipe(1, 100))).toBe(s)
  })

  it('ignores a swipe too short or too slow to be a flick, so a stray extra tap never launches a dud', () => {
    const s = armed()
    expect(reducer(s, swipe(1, 100, { dx: 0, dy: -(MIN_SHOOT_DRAG - 1), vx: 0, vy: -900 }))).toBe(s)
    expect(reducer(s, swipe(1, 100, { dx: 0, dy: -MIN_SHOOT_DRAG * 3, vx: 0, vy: -(MIN_FLICK_VELOCITY - 1) }))).toBe(s)
  })

  it('the first real swipe launches at once: puck moving its way, swiper is currentPlayer, clash window open', () => {
    const s = reducer(armed(), swipe(2, 1000))
    expect(s.phase).toBe('simulating')
    expect(s.currentPlayer).toBe(2)
    expect(s.puck.vy).toBeLessThan(0)
    expect(s.puck.vx).toBeCloseTo(0)
    expect(s.tripleTap?.clashUntil).toBe(1000 + TRIPLE_TAP_CLASH_WINDOW_MS)
  })

  it('a late swipe inside the window clashes: it adds onto the moving puck and knocks it off its line', () => {
    let s = reducer(armed(), swipe(1, 1000))
    const before = s.puck
    s = reducer(s, swipe(2, 1000 + TRIPLE_TAP_CLASH_WINDOW_MS, { dx: MIN_SHOOT_DRAG * 3, dy: 0, vx: 900, vy: 0 }))
    expect(s.puck.vx).toBeGreaterThan(0)
    const expected = combineAndClampVelocity(before.vx, before.vy, s.tripleTap!.swipe[1]!.vx, s.tripleTap!.swipe[1]!.vy)
    expect(s.puck.vx).toBeCloseTo(expected.vx)
    expect(s.puck.vy).toBeCloseTo(expected.vy)
    expect(s.currentPlayer).toBe(1)
    expect(s.tripleTap?.clashUntil).toBeNull()
  })

  it('a swipe after the window is too late and changes nothing', () => {
    const launched = reducer(armed(), swipe(1, 1000))
    expect(reducer(launched, swipe(2, 1001 + TRIPLE_TAP_CLASH_WINDOW_MS))).toBe(launched)
  })

  it('the launcher cannot clash with their own shot', () => {
    const launched = reducer(armed(), swipe(1, 1000))
    expect(reducer(launched, swipe(1, 1050))).toBe(launched)
  })

  it('TRIPLE_TAP_CLASH_END clears the leftover draw once the puck is in play, but never a fresh draw', () => {
    const launched = reducer(armed(), swipe(1, 1000))
    expect(reducer(launched, { type: 'TRIPLE_TAP_CLASH_END' }).tripleTap).toBeNull()
    const fresh = makeLiveTripleTapState()
    expect(reducer(fresh, { type: 'TRIPLE_TAP_CLASH_END' })).toBe(fresh)
  })

  it("the CPU's planned swipe always passes the flick gate and heads for the opponent's goal", () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let i = 0; i < 50; i++) {
        const p1 = planTripleTapSwipe(1, difficulty)
        const p2 = planTripleTapSwipe(2, difficulty)
        expect(reducer(armed(), swipe(1, 0, p1)).phase).toBe('simulating')
        expect(p1.vy).toBeLessThan(0)
        expect(p2.vy).toBeGreaterThan(0)
      }
    }
  })
})

// ─── Turn-alternation fuzz - tipoffMode: 'tripleTap' (reducer level, no React, no timers) ────────
// Self-contained rather than folded into turnAlternation.test.ts's own shared driveFuzzRun/
// resolveFaceoffDraw, to keep this feature's blast radius off that already-passing suite. Each
// iteration is an independent fresh draw (RESET), so this is scoped to what's actually NEW here -
// does a tripleTap draw's own resolution correctly interact with PHYSICS_STEP's existing,
// already-tested unconditional turn-flip rules - not re-proving those rules generically (that's
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

type Reducer = ReturnType<typeof makeReducer>

function driveTripleTapFuzzRun(totalDraws: number, seed: number): { draws: number; goals: number; misses: number } {
  const reducer: Reducer = makeReducer(999, 'tripleTap', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
  const rng = mulberry32(seed)

  let draws = 0
  let goals = 0
  let misses = 0

  while (draws < totalDraws) {
    let state = reducer({ phase: 'idle', currentPlayer: 1, scores: [0, 0], puck: { x: 0, y: 0, vx: 0, vy: 0 }, aim: null, interceptAim: null, pendingShot: null, bounceCount: 0, lastScoredGoal: null, wellEnterCount: 0, lastWellPolarity: null, goalDoorHitCount: 0, lastGoalDoorSide: null, faceoff: null, faceoffRound: 0, tripleTap: null, tripleTapRound: 0 }, { type: 'RESET', board, coinFlipWinner: 1, zoneIndex: 0, faceoffZones: [0, 1], faceoffReadyGuess: [0, 1] })
    if (state.phase !== 'tripleTap') throw new Error(`expected 'tripleTap' after RESET, got '${state.phase}'`)

    // Taps in step, either player first on each beat.
    for (let beat = 0; beat < TRIPLE_TAP_TAPS; beat++) {
      const first: Player = rng() < 0.5 ? 1 : 2
      state = reducer(state, { type: 'TRIPLE_TAP_PRESS', player: first, atMs: beat * 100 })
      state = reducer(state, { type: 'TRIPLE_TAP_PRESS', player: other(first), atMs: beat * 100 + 10 })
    }
    // Then the race: random order, the second swipe sometimes inside the clash window, sometimes not.
    const winner: Player = rng() < 0.5 ? 1 : 2
    const flick = () => {
      const angle = rng() * Math.PI * 2
      const speed = MIN_FLICK_VELOCITY + rng() * 1200
      return { dx: Math.cos(angle) * MIN_SHOOT_DRAG * 2, dy: Math.sin(angle) * MIN_SHOOT_DRAG * 2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }
    }
    state = reducer(state, { type: 'TRIPLE_TAP_SWIPE', player: winner, atMs: 1000, ...flick() })
    if (state.phase !== 'simulating') throw new Error(`the first swipe did not enter 'simulating' (phase: ${state.phase})`)
    if (state.currentPlayer !== winner) throw new Error(`currentPlayer (${state.currentPlayer}) !== first swiper (${winner}) right after launch`)
    state = reducer(state, { type: 'TRIPLE_TAP_SWIPE', player: other(winner), atMs: 1000 + rng() * TRIPLE_TAP_CLASH_WINDOW_MS * 2, ...flick() })
    if (state.currentPlayer !== winner) throw new Error('a clash changed currentPlayer')

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

describe('turn alternation fuzz - tipoffMode: tripleTap (reducer level, no React, no timers)', () => {
  it('never gives the launch winner a follow-up turn, hit or miss, across 60 independent draws, in randomized dispatch order', () => {
    const summary = driveTripleTapFuzzRun(60, 424242)
    expect(summary.draws).toBe(60)
  })

  it('a second, differently-seeded run also holds (defense against a seed-specific fluke)', () => {
    const summary = driveTripleTapFuzzRun(60, 13579)
    expect(summary.draws).toBe(60)
  })
})
