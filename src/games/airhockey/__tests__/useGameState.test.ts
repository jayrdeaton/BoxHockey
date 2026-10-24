import { STOP_THRESHOLD } from '@/games/airhockey/constants/game'
import { makeReducer } from '@/games/airhockey/hooks/useGameState'
import { GameState } from '@/games/airhockey/types'
import { centerPaddle, computeBoardLayout, faceoffZoneCenter } from '@/games/airhockey/utils/board'

const insets = { top: 0, bottom: 0, left: 0, right: 0 }
const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium', 'medium', true)

function idleState(): GameState {
  return makeReducer(5, 0.986)(
    // Seed via RESET so the fixture always matches makeInitialState's own shape, rather than
    // hand-duplicating it here and risking drift.
    { phase: 'idle', scores: [0, 0], puck: { x: 0, y: 0, vx: 0, vy: 0 }, paddles: { 1: { x: 0, y: 0, vx: 0, vy: 0 }, 2: { x: 0, y: 0, vx: 0, vy: 0 } }, lastScoredGoal: null, bounceCount: 0, goalDoorHitCount: 0, lastGoalDoorSide: null, pocketDoorHit: null },
    { type: 'RESET', board }
  )
}

function liveState(): GameState {
  const reducer = makeReducer(5, 0.986)
  return reducer(idleState(), { type: 'START' })
}

describe('TICK ordering', () => {
  it('commits paddle targets into velocity-bearing state and steps the puck in the same tick', () => {
    const reducer = makeReducer(5, 0.986)
    const state = liveState()
    const targets = { 1: { x: board.centerX + 5, y: state.paddles[1].y }, 2: { x: state.paddles[2].x, y: state.paddles[2].y } }
    const next = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(next.paddles[1].x).toBeCloseTo(board.centerX + 5, 5)
    expect(next.paddles[1].vx).toBeGreaterThan(0) // moved right this tick, so it picked up rightward velocity
  })

  it('a paddle striking the puck imparts velocity onto it within the same tick', () => {
    const reducer = makeReducer(5, 0.986)
    const state = liveState()
    // Puck sits at center; player 1's paddle starts well below it and its target this tick moves
    // straight up (purely vertical, same x as the puck) to just past overlap - an unambiguous
    // head-on approach along the collision normal, not a graze.
    const startY = board.centerY + board.puckRadius + board.paddleRadius + 40
    const targetY = board.centerY + board.puckRadius + board.paddleRadius - 5
    const targets = { 1: { x: board.centerX, y: targetY }, 2: state.paddles[2] }
    const next = reducer({ ...state, paddles: { ...state.paddles, 1: { x: board.centerX, y: startY, vx: 0, vy: 0 } } }, { type: 'TICK', board, dt: 1, targets })
    expect(next.puck.vy).toBeLessThan(0) // knocked upward, away from the approaching paddle
  })

  it('a fast swipe past the puck in one tick still strikes it, instead of tunneling through', () => {
    const reducer = makeReducer(5, 0.986)
    const state = liveState()
    // Player 1's paddle starts well to one side of the puck (which sits at center) and this
    // tick's target jumps to well past the OTHER side - a fast swipe, or a dropped frame's larger
    // dt - with neither position overlapping the puck. A plain start/end-of-tick check would see
    // no contact at all; only a swept check along the path actually traveled catches it.
    const combined = board.puckRadius + board.paddleRadius
    const startX = board.centerX - combined * 3
    const targetX = board.centerX + combined * 3
    const targets = { 1: { x: targetX, y: board.centerY }, 2: state.paddles[2] }
    const next = reducer({ ...state, paddles: { ...state.paddles, 1: { x: startX, y: board.centerY, vx: 0, vy: 0 } } }, { type: 'TICK', board, dt: 1, targets })
    expect(next.puck.vx).toBeGreaterThan(0) // knocked forward, in the direction of the swipe
  })

  it('TICK is a no-op outside the live phase', () => {
    const reducer = makeReducer(5, 0.986)
    const state = idleState()
    const targets = { 1: state.paddles[1], 2: state.paddles[2] }
    const next = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(next).toBe(state)
  })
})

describe('scoring and re-serve', () => {
  it("a goal increments the score, transitions to goalScored, and re-serves the puck at the scored-on player's own faceoff zone on GOAL_SERVE", () => {
    const reducer = makeReducer(5, 0.986)
    let state = liveState()
    const targets = { 1: state.paddles[1], 2: state.paddles[2] }
    // A fast puck already at the goal mouth, heading in - scores within one tick.
    state = { ...state, puck: { x: board.centerX, y: board.y + 2, vx: 0, vy: -30 } }
    const afterGoal = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(afterGoal.phase).toBe('goalScored')
    expect(afterGoal.scores[0]).toBe(1)
    expect(afterGoal.lastScoredGoal).toBe('top')

    // Player 1 scored (into player 2's local-top goal), so player 2 is the scored-on player and
    // gets the restart - see GOAL_SERVE's own comment for why this isn't a neutral center serve.
    const expected = faceoffZoneCenter(board, 2, 0)
    const served = reducer(afterGoal, { type: 'GOAL_SERVE', board, zoneIndex: 0 })
    expect(served.phase).toBe('live')
    expect(served.puck.x).toBeCloseTo(expected.x, 5)
    expect(served.puck.y).toBeCloseTo(expected.y, 5)
    expect(served.puck.vx).toBe(0)
    expect(served.puck.vy).toBe(0)
    expect(served.lastScoredGoal).toBeNull()
  })

  it('reaching scoreToWin ends the game instead of transitioning to goalScored', () => {
    const reducer = makeReducer(1, 0.986) // score to win = 1, so a single goal ends it
    let state = liveState()
    const targets = { 1: state.paddles[1], 2: state.paddles[2] }
    state = { ...state, puck: { x: board.centerX, y: board.y + 2, vx: 0, vy: -30 } }
    const after = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(after.phase).toBe('gameOver')
    expect(after.scores[0]).toBe(1)
  })

  it('GOAL_SERVE is a no-op outside the goalScored phase', () => {
    const reducer = makeReducer(5, 0.986)
    const state = liveState()
    const next = reducer(state, { type: 'GOAL_SERVE', board, zoneIndex: 0 })
    expect(next).toBe(state)
  })
})

describe('START', () => {
  it('flips idle to live without moving the puck or paddles', () => {
    const reducer = makeReducer(5, 0.986)
    const idle = idleState()
    const started = reducer(idle, { type: 'START' })
    expect(started.phase).toBe('live')
    expect(started.puck).toEqual(idle.puck)
    expect(started.paddles).toEqual(idle.paddles)
  })

  it('is a no-op outside the idle phase', () => {
    const reducer = makeReducer(5, 0.986)
    const state = liveState()
    const next = reducer(state, { type: 'START' })
    expect(next).toBe(state)
  })
})

describe('RESCALE', () => {
  it('remaps the puck/paddles by their fractional position within the board, preserving phase and scores', () => {
    const reducer = makeReducer(5, 0.986)
    const state = { ...liveState(), scores: [2, 1] as [number, number] }
    const doubled = computeBoardLayout(800, 1800, insets, 'vertical', 'medium', 'medium', true)
    const next = reducer(state, { type: 'RESCALE', prevBoard: board, board: doubled })
    expect(next.phase).toBe('live')
    expect(next.scores).toEqual([2, 1])
    // Puck started dead center (fraction 0.5, 0.5 of the field) - should still be dead center of
    // the new, larger board.
    expect(next.puck.x).toBeCloseTo(doubled.centerX, 5)
    expect(next.puck.y).toBeCloseTo(doubled.centerY, 5)
  })

  it('falls back to dead center (rather than NaN) when rescaling from a degenerate zero-sized board', () => {
    const reducer = makeReducer(5, 0.986)
    const state = liveState()
    const zeroBoard = computeBoardLayout(0, 0, insets, 'vertical', 'medium', 'medium', true)
    const next = reducer(state, { type: 'RESCALE', prevBoard: zeroBoard, board })
    expect(Number.isNaN(next.puck.x)).toBe(false)
    expect(Number.isNaN(next.puck.y)).toBe(false)
    expect(next.puck.x).toBeCloseTo(board.centerX, 5)
    expect(next.puck.y).toBeCloseTo(board.centerY, 5)
  })
})

describe('stranded puck re-serve', () => {
  const r = board.puckRadius
  const goalCX = board.x + (board.goalStart + board.goalEnd) / 2
  const homeTargets = { 1: centerPaddle(board, 1), 2: centerPaddle(board, 2) }

  // Regression: behind-the-line pucks skip friction, but each bounce between the one-way door and
  // the pocket's back wall still costs WALL_RESTITUTION, so a puck with no sideways speed slows to
  // a stop there, out of every paddle's reach. A goal never happens, so nothing used to serve again.
  it.each([
    ['top', goalCX - 5, board.y - r - 1, 5, 2, 0],
    ['bottom', goalCX + 5, board.y + board.height + r + 1, -5, 1, 1]
  ] as const)('re-serves a puck that comes to rest in the %s pocket at the near faceoff zone in that end, with no goal and one door hit', (_side, x, y, vy, owner, zoneIndex) => {
    const reducer = makeReducer(5, 0.986)
    let state: GameState = { ...liveState(), puck: { x, y, vx: 0, vy } }
    let ticks = 0
    while (state.phase === 'live' && ticks < 5000) {
      state = reducer(state, { type: 'TICK', board, dt: 1, targets: homeTargets })
      ticks++
      const { puck } = state
      const atRest = Math.abs(puck.vx) < STOP_THRESHOLD && Math.abs(puck.vy) < STOP_THRESHOLD
      const behindLine = puck.y + r < board.y || puck.y - r > board.y + board.height
      expect(atRest && behindLine).toBe(false)
    }
    const expected = faceoffZoneCenter(board, owner, zoneIndex)
    expect(state.phase).toBe('idle')
    expect(state.puck).toEqual({ x: expected.x, y: expected.y, vx: 0, vy: 0 })
    expect(state.scores).toEqual([0, 0])
    expect(state.lastScoredGoal).toBeNull()
    expect(state.goalDoorHitCount).toBe(1)
    expect(state.pocketDoorHit).toBeNull()

    // The usual serve beat (useGameState's GOAL_SERVE_PAUSE_MS timer) then puts it back in play.
    const started = reducer(state, { type: 'START' })
    expect(started.phase).toBe('live')
    expect(started.puck).toEqual(state.puck)
  })

  it('counts the door again on a later pocket visit', () => {
    const reducer = makeReducer(5, 0.986)
    const inPlay = reducer({ ...liveState(), pocketDoorHit: 'top' }, { type: 'TICK', board, dt: 1, targets: homeTargets })
    expect(inPlay.pocketDoorHit).toBeNull()

    const doorHit = reducer({ ...inPlay, puck: { x: goalCX, y: board.y - r - 1, vx: 0, vy: 5 } }, { type: 'TICK', board, dt: 1, targets: homeTargets })
    expect(doorHit.goalDoorHitCount).toBe(inPlay.goalDoorHitCount + 1)
    expect(doorHit.lastGoalDoorSide).toBe('top')
    expect(doorHit.pocketDoorHit).toBe('top')
  })
})
