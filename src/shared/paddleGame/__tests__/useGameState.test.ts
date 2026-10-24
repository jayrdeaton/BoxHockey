import { BALL_SPEED_TIERS, SOLO_LIVES } from '@/shared/paddleGame/constants/game'
import { makeReducer } from '@/shared/paddleGame/hooks/useGameState'
import { GameState } from '@/shared/paddleGame/types'
import { computeBoardLayout } from '@/shared/paddleGame/utils/board'

const insets = { top: 0, bottom: 0, left: 0, right: 0 }
const board = computeBoardLayout(900, 400, insets, 'medium')

function idleState(): GameState {
  return makeReducer(5, 'medium')(
    // Seed via RESET so the fixture always matches makeInitialState's own shape, rather than
    // hand-duplicating it here and risking drift - same discipline AirHockey's own test file uses.
    { phase: 'idle', scores: [0, 0], ball: { x: 0, y: 0, vx: 0, vy: 0, speed: 0 }, paddles: { 1: { x: 0, y: 0, vx: 0, vy: 0 }, 2: { x: 0, y: 0, vx: 0, vy: 0 } }, lastScoredBy: null, bounceCount: 0, bricks: [], lives: 0 },
    { type: 'RESET', board }
  )
}

// Deterministic - pins the coin-flip/angle draws inside computeServeVelocity so a launched ball's
// exact velocity is reproducible across assertions.
function liveState(random: () => number = () => 0.5): GameState {
  const reducer = makeReducer(5, 'medium')
  return reducer(idleState(), { type: 'START', random })
}

describe('TICK ordering', () => {
  it('commits paddle targets into velocity-bearing state within the same tick', () => {
    const reducer = makeReducer(5, 'medium')
    const state = liveState()
    const targets = { 1: state.paddles[1].y + 5, 2: state.paddles[2].y }
    const next = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(next.paddles[1].y).toBeCloseTo(state.paddles[1].y + 5, 5)
    expect(next.paddles[1].vy).toBeGreaterThan(0) // moved downward this tick, so it picked up downward velocity
    expect(next.paddles[1].x).toBeCloseTo(board.paddleX[1], 5) // X is always the fixed paddleX, never a live input
  })

  it('a paddle already overlapping the ball at the start of a tick reflects it and ratchets its speed within that SAME tick', () => {
    const reducer = makeReducer(5, 'medium')
    const state = liveState()
    const halfW = board.paddleWidth / 2
    // Ball placed just outside player 1's paddle rect (to its right, within collision reach),
    // approaching it - an unambiguous, already-in-contact strike that the very first substep's
    // applyPaddleCollision call must catch before any position integration happens.
    const ball = { x: board.paddleX[1] + halfW + 3, y: board.centerY, vx: -5, vy: 0, speed: 5 }
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y } // paddle 1 already in place, doesn't move
    const next = reducer({ ...state, ball }, { type: 'TICK', board, dt: 1, targets })
    expect(next.ball.vx).toBeGreaterThan(0) // reflected back toward +x, away from player 1's paddle
    expect(next.ball.speed).toBeGreaterThan(ball.speed) // ratcheted up by the tier's own increment
  })

  it('TICK is a no-op outside the live phase', () => {
    const reducer = makeReducer(5, 'medium')
    const state = idleState()
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    const next = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(next).toBe(state)
  })
})

describe('scoring and re-serve', () => {
  // Positioned clear of player 2's paddle rect entirely, so the ball's own approach to the right
  // edge can't accidentally collide with (and get deflected by) player 2's paddle first.
  const clearOfPaddle2 = board.paddleX[2] + board.paddleWidth / 2 + board.ballRadius + 5
  const clearOfPaddle1 = board.paddleX[1] - board.paddleWidth / 2 - board.ballRadius - 5

  it('a point increments the score, transitions to pointScored, and sets lastScoredBy to the SCORER', () => {
    const reducer = makeReducer(5, 'medium')
    let state = liveState()
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    state = { ...state, ball: { x: clearOfPaddle2, y: board.centerY, vx: 30, vy: 0, speed: 30 } }
    const after = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(after.phase).toBe('pointScored')
    expect(after.scores).toEqual([1, 0])
    expect(after.lastScoredBy).toBe(1)
    // Ball resets to dead center, fully at rest - the actual re-launch happens on the FOLLOWING
    // POINT_SERVE, after the pause (see the design spec's note on this in useGameState.ts).
    expect(after.ball.x).toBeCloseTo(board.centerX, 5)
    expect(after.ball.y).toBeCloseTo(board.centerY, 5)
    expect(after.ball.vx).toBe(0)
    expect(after.ball.vy).toBe(0)
    expect(after.ball.speed).toBe(0)
  })

  it('scores correctly for the opposite edge too', () => {
    const reducer = makeReducer(5, 'medium')
    let state = liveState()
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    state = { ...state, ball: { x: clearOfPaddle1, y: board.centerY, vx: -30, vy: 0, speed: 30 } }
    const after = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(after.scores).toEqual([0, 1])
    expect(after.lastScoredBy).toBe(2)
  })

  it('reaching scoreToWin ends the game instead of transitioning to pointScored', () => {
    const reducer = makeReducer(1, 'medium') // score to win = 1, so a single point ends it
    let state = liveState()
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    state = { ...state, ball: { x: clearOfPaddle2, y: board.centerY, vx: 30, vy: 0, speed: 30 } }
    const after = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(after.phase).toBe('gameOver')
    expect(after.scores).toEqual([1, 0])
  })

  it('POINT_SERVE re-centers both paddles and serves the ball at BASE speed toward whoever just conceded', () => {
    const reducer = makeReducer(5, 'medium')
    let state = liveState()
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    state = { ...state, ball: { x: clearOfPaddle2, y: board.centerY, vx: 30, vy: 0, speed: 30 } }
    const afterPoint = reducer(state, { type: 'TICK', board, dt: 1, targets })
    expect(afterPoint.lastScoredBy).toBe(1)

    const served = reducer(afterPoint, { type: 'POINT_SERVE', board, random: () => 0.5 })
    expect(served.phase).toBe('live')
    expect(served.ball.x).toBeCloseTo(board.centerX, 5)
    expect(served.ball.y).toBeCloseTo(board.centerY, 5)
    // Player 1 just scored, so the ball serves toward player 2 (the one who conceded) - positive
    // vx means toward player 2.
    expect(served.ball.vx).toBeGreaterThan(0)
    // BASE speed, not 0 - unlike AirHockey's puck (which sits fully at rest until a paddle
    // actually strikes it), Pong's serve actively launches the ball at this exact instant.
    expect(served.ball.speed).toBeCloseTo(BALL_SPEED_TIERS.medium.base, 5)
    expect(Math.hypot(served.ball.vx, served.ball.vy)).toBeCloseTo(BALL_SPEED_TIERS.medium.base, 5)
    expect(served.paddles[1].y).toBeCloseTo(board.centerY, 5)
    expect(served.paddles[2].y).toBeCloseTo(board.centerY, 5)
    expect(served.lastScoredBy).toBeNull()
  })

  it('POINT_SERVE is a no-op outside the pointScored phase', () => {
    const reducer = makeReducer(5, 'medium')
    const state = liveState()
    const next = reducer(state, { type: 'POINT_SERVE', board })
    expect(next).toBe(state)
  })
})

describe('START', () => {
  it('flips idle to live and actively launches the ball at base speed via injectable random - unlike AirHockey, whose puck stays at rest on START', () => {
    const reducer = makeReducer(5, 'medium')
    const idle = idleState()
    const started = reducer(idle, { type: 'START', random: () => 0.5 })
    expect(started.phase).toBe('live')
    expect(started.ball.x).toBeCloseTo(idle.ball.x, 5)
    expect(started.ball.y).toBeCloseTo(idle.ball.y, 5)
    expect(started.ball.speed).toBeCloseTo(BALL_SPEED_TIERS.medium.base, 5)
    expect(Math.hypot(started.ball.vx, started.ball.vy)).toBeCloseTo(BALL_SPEED_TIERS.medium.base, 5)
    expect(started.paddles).toEqual(idle.paddles)
  })

  it('is a no-op outside the idle phase', () => {
    const reducer = makeReducer(5, 'medium')
    const state = liveState()
    const next = reducer(state, { type: 'START' })
    expect(next).toBe(state)
  })
})

describe('RESCALE', () => {
  it('remaps the ball fractionally with speed recomputed, and SNAPS each paddle X to the new fixed paddleX - never fractionally interpolated', () => {
    const reducer = makeReducer(5, 'medium')
    const state = { ...liveState(), scores: [2, 1] as [number, number] }
    const doubled = computeBoardLayout(1800, 800, insets, 'medium')
    const next = reducer(state, { type: 'RESCALE', prevBoard: board, board: doubled })
    expect(next.phase).toBe('live')
    expect(next.scores).toEqual([2, 1])
    // Ball started dead center (fraction 0.5, 0.5 of the field) - should still be dead center of
    // the new, larger board.
    expect(next.ball.x).toBeCloseTo(doubled.centerX, 5)
    expect(next.ball.y).toBeCloseTo(doubled.centerY, 5)
    expect(next.ball.speed).toBeCloseTo(Math.hypot(next.ball.vx, next.ball.vy), 5)
    expect(next.paddles[1].x).toBeCloseTo(doubled.paddleX[1], 5)
    expect(next.paddles[2].x).toBeCloseTo(doubled.paddleX[2], 5)
    // Paddle Y started at centerY (fraction 0.5) - should still be dead center of the new board.
    expect(next.paddles[1].y).toBeCloseTo(doubled.centerY, 5)
    expect(next.paddles[2].y).toBeCloseTo(doubled.centerY, 5)
  })

  it('falls back to dead center (rather than NaN) when rescaling from a degenerate zero-sized board', () => {
    const reducer = makeReducer(5, 'medium')
    const state = liveState()
    const zeroBoard = computeBoardLayout(0, 0, insets, 'medium')
    const next = reducer(state, { type: 'RESCALE', prevBoard: zeroBoard, board })
    expect(Number.isNaN(next.ball.x)).toBe(false)
    expect(Number.isNaN(next.ball.y)).toBe(false)
    expect(next.ball.x).toBeCloseTo(board.centerX, 5)
    expect(next.ball.y).toBeCloseTo(board.centerY, 5)
    expect(next.paddles[1].x).toBeCloseTo(board.paddleX[1], 5)
    expect(next.paddles[1].y).toBeCloseTo(board.centerY, 5)
  })
})

describe('TICK substep loop - tunneling regression', () => {
  it('a near-maxSpeed ball aimed at a stationary paddle does not tunnel through un-collided within one TICK at a large dt', () => {
    const reducer = makeReducer(5, 'medium')
    const state = liveState()
    const maxSpeed = BALL_SPEED_TIERS.medium.max
    const halfW = board.paddleWidth / 2
    // Ball just to the right of player 1's paddle rect, moving hard left, at a large dt -
    // useGameLoop's own clamped-but-still-large maxDt (2.5), the case that follows a foreground
    // stall - which a naive SINGLE-PASS stepPhysics call (speed * dt = 50, vs. a paddle only ~2%
    // of board height thick) would displace clean over the paddle within.
    const ball = { x: board.paddleX[1] + halfW + 20, y: board.centerY, vx: -maxSpeed, vy: 0, speed: maxSpeed }
    const targets = { 1: board.centerY, 2: state.paddles[2].y } // paddle 1 held in place at center - a purely geometric catch, not a lucky moving intercept
    const next = reducer({ ...state, ball }, { type: 'TICK', board, dt: 2.5, targets })
    // Asserting the ball ends up REFLECTED (moving back rightward, away from player 1's edge)
    // rather than having scored past it is what actually proves the TICK-level substep loop
    // caught a collision a single-pass integration would have missed entirely.
    expect(next.ball.vx).toBeGreaterThan(0)
    expect(next.scores).toEqual([0, 0])
  })
})

describe('TICK substep loop - brick tunneling regression', () => {
  it('a near-maxSpeed ball aimed at a stationary brick does not tunnel through un-collided within one TICK at a large dt', () => {
    // bricksEnabled on a twoPlayer reducer - exercises the shared brick infrastructure via the
    // Bricks toggle path, same substep/collision code solo also relies on.
    const reducer = makeReducer(5, 'medium', 'twoPlayer', true)
    const state = reducer(reducer({ phase: 'idle', scores: [0, 0], ball: { x: 0, y: 0, vx: 0, vy: 0, speed: 0 }, paddles: { 1: { x: 0, y: 0, vx: 0, vy: 0 }, 2: { x: 0, y: 0, vx: 0, vy: 0 } }, lastScoredBy: null, bounceCount: 0, bricks: [], lives: 0 }, { type: 'RESET', board }), { type: 'START', random: () => 0.5 })
    const maxSpeed = BALL_SPEED_TIERS.medium.max
    // A single brick, mid-court and clear of both paddles - isolates brick-tunneling safety from
    // paddle collision entirely, same discipline as the paddle tunneling test above.
    const brick = { x: board.centerX - 10, y: board.centerY - 40, width: 20, height: 80, destroyed: false }
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    const ball = { x: brick.x + brick.width + 20, y: board.centerY, vx: -maxSpeed, vy: 0, speed: maxSpeed }
    // random: () => 0.5 -> exactly zero brick-bounce jitter (see applyBrickCollision), keeping this
    // test's reflection pure geometry.
    const next = reducer({ ...state, bricks: [brick], ball }, { type: 'TICK', board, dt: 2.5, targets, random: () => 0.5 })
    expect(next.ball.vx).toBeGreaterThan(0) // reflected back rightward, away from the brick - not tunneled through
    expect(next.bricks[0].destroyed).toBe(true)
  })
})

describe('solo/Brickbreaker', () => {
  function soloIdleState(): GameState {
    return makeReducer(5, 'medium', 'solo', false)({ phase: 'idle', scores: [0, 0], ball: { x: 0, y: 0, vx: 0, vy: 0, speed: 0 }, paddles: { 1: { x: 0, y: 0, vx: 0, vy: 0 }, 2: { x: 0, y: 0, vx: 0, vy: 0 } }, lastScoredBy: null, bounceCount: 0, bricks: [], lives: 0 }, { type: 'RESET', board })
  }

  function soloLiveState(random: () => number = () => 0.5): GameState {
    return makeReducer(5, 'medium', 'solo', false)(soloIdleState(), { type: 'START', random })
  }

  it('RESET seeds a full brick field and SOLO_LIVES lives - bricksEnabled is irrelevant, solo is unconditionally Brickbreaker', () => {
    const state = soloIdleState()
    expect(state.lives).toBe(SOLO_LIVES)
    expect(state.bricks.length).toBeGreaterThan(0)
    expect(state.bricks.every((b) => !b.destroyed)).toBe(true)
  })

  it("START always serves rightward into the field - never the coin flip a two-paddle match's first serve gets", () => {
    // random: () => 0.9 would serve LEFT (toward P1) if this were a coin-flip match (see
    // physics.test.ts's 'is a coin flip in direction' test) - solo ignores that draw entirely.
    const state = makeReducer(5, 'medium', 'solo', false)(soloIdleState(), { type: 'START', random: () => 0.9 })
    expect(state.ball.vx).toBeGreaterThan(0)
  })

  it('a miss decrements lives and transitions to pointScored while lives remain, with lastScoredBy fixed at 1', () => {
    const reducer = makeReducer(5, 'medium', 'solo', false)
    const state = soloLiveState()
    const clearOfPaddle1 = board.paddleX[1] - board.paddleWidth / 2 - board.ballRadius - 5
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    const after = reducer({ ...state, ball: { x: clearOfPaddle1, y: board.centerY, vx: -30, vy: 0, speed: 30 } }, { type: 'TICK', board, dt: 1, targets })
    expect(after.lives).toBe(SOLO_LIVES - 1)
    expect(after.phase).toBe('pointScored')
    // Not "who scored" (solo has no opponent) - fixed at 1 so POINT_SERVE's otherPlayer(lastScoredBy)
    // still resolves to 2, correctly re-serving away from the player and into the field.
    expect(after.lastScoredBy).toBe(1)
  })

  it('exhausting lives ends the round as a loss', () => {
    const reducer = makeReducer(5, 'medium', 'solo', false)
    const state = { ...soloLiveState(), lives: 1 }
    const clearOfPaddle1 = board.paddleX[1] - board.paddleWidth / 2 - board.ballRadius - 5
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    const after = reducer({ ...state, ball: { x: clearOfPaddle1, y: board.centerY, vx: -30, vy: 0, speed: 30 } }, { type: 'TICK', board, dt: 1, targets })
    expect(after.lives).toBe(0)
    expect(after.phase).toBe('gameOver')
  })

  it('clearing every brick ends the round as a win, leaving lives untouched', () => {
    const reducer = makeReducer(5, 'medium', 'solo', false)
    const state = soloLiveState()
    const bricks = state.bricks.map((b) => ({ ...b, destroyed: true }))
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    // Harmlessly mid-court, nowhere near an edge - the win comes from the bricks-cleared check
    // itself, not an incidental score/edge event landing in the same tick.
    const ball = { x: board.centerX, y: board.centerY, vx: 1, vy: 0, speed: 1 }
    const after = reducer({ ...state, bricks, ball }, { type: 'TICK', board, dt: 1, targets })
    expect(after.phase).toBe('gameOver')
    expect(after.lives).toBe(SOLO_LIVES)
  })

  it('never collides against paddle 2 - the far edge bounces with no speed ratchet, unlike a paddle hit', () => {
    const reducer = makeReducer(5, 'medium', 'solo', false)
    const state = soloLiveState()
    const clearOfPaddle2 = board.paddleX[2] + board.paddleWidth / 2 + board.ballRadius + 5
    const targets = { 1: state.paddles[1].y, 2: state.paddles[2].y }
    const ball = { x: clearOfPaddle2, y: board.centerY, vx: 30, vy: 0, speed: 30 }
    const after = reducer({ ...state, ball }, { type: 'TICK', board, dt: 1, targets })
    expect(after.ball.vx).toBeLessThan(0) // bounced back leftward off the far wall
    expect(after.ball.speed).toBeCloseTo(30, 5) // unchanged - a paddle hit would have ratcheted this up
    expect(after.phase).toBe('live')
  })
})
