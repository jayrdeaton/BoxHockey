import { MAX_PADDLE_SPEED } from '@/shared/paddleGame/constants/game'
import { computeAIPaddleTarget } from '@/shared/paddleGame/utils/aiOpponent'
import { centerPaddle, computeBoardLayout } from '@/shared/paddleGame/utils/board'

const insets = { top: 0, bottom: 0, left: 0, right: 0 }
const board = computeBoardLayout(900, 400, insets, 'medium')

// jitterMag = (random() * 2 - 1) * aimJitterPx - a plain 1D scalar offset (narrowed from
// AirHockey's polar angle+magnitude jitter, since there's only one axis left to blur once a
// paddle can't move in X at all). random()=0.5 is the zero point, NOT random()=0 the way
// AirHockey's own magnitude-only jitter formula worked - see aiOpponent.ts's own targetY line.
const noJitter = () => 0.5

describe('computeAIPaddleTarget - always tracks, no threat gate', () => {
  it("predicts the ball's Y along its current trajectory in both directions - no AirHockey-style retreat-home-when-moving-away branch", () => {
    const paddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const ballMovingDown = { x: board.centerX, y: board.centerY, vx: 0, vy: 5, speed: 5 }
    const ballMovingUp = { x: board.centerX, y: board.centerY, vx: 0, vy: -5, speed: 5 }
    const targetDown = computeAIPaddleTarget(ballMovingDown, paddle, board, 2, 'hard', noJitter)
    const targetUp = computeAIPaddleTarget(ballMovingUp, paddle, board, 2, 'hard', noJitter)
    // A downward-moving ball is tracked to a LOWER predicted Y than an upward-moving one,
    // regardless of which direction counts as "toward" or "away" from player 2 - a fixed-X paddle
    // has no edge of its own to retreat toward in the first place, so both simply predict forward.
    expect(targetDown.y).toBeGreaterThan(board.centerY)
    expect(targetUp.y).toBeLessThan(board.centerY)
  })

  it('tracks a ball heading toward the far edge exactly the same way as one heading toward its own edge', () => {
    const paddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const towardP2 = { x: board.centerX, y: board.centerY, vx: 6, vy: 3, speed: Math.hypot(6, 3) }
    const towardP1 = { x: board.centerX, y: board.centerY, vx: -6, vy: 3, speed: Math.hypot(6, 3) }
    // vx never factors into computeAIPaddleTarget at all (only ball.vy does) - both should predict
    // the identical Y.
    const targetA = computeAIPaddleTarget(towardP2, paddle, board, 2, 'hard', noJitter)
    const targetB = computeAIPaddleTarget(towardP1, paddle, board, 2, 'hard', noJitter)
    expect(targetA.y).toBeCloseTo(targetB.y, 5)
  })
})

describe('computeAIPaddleTarget - difficulty tiers', () => {
  it('a harder difficulty jitters its target less than an easier one, for the same raw random draw', () => {
    const ball = { x: board.centerX, y: board.y + 40, vx: 0, vy: -3, speed: 3 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const maxJitter = () => 1 // (1*2-1)*aimJitterPx = full positive offset
    const baseline = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'hard', noJitter)
    const easyJittered = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'easy', maxJitter)
    const hardJittered = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'hard', maxJitter)
    const easyOffset = Math.abs(easyJittered.y - baseline.y)
    const hardOffset = Math.abs(hardJittered.y - baseline.y)
    expect(hardOffset).toBeLessThan(easyOffset)
  })

  it('a harder difficulty approaches its target faster than an easier one, when both start far from it', () => {
    const ball = { x: board.centerX, y: board.y + 20, vx: 0, vy: 0, speed: 0 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 } // far below the ball's own y
    const easyTarget = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'easy', noJitter)
    const hardTarget = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'hard', noJitter)
    const easyStep = Math.abs(easyTarget.y - ownPaddle.y)
    const hardStep = Math.abs(hardTarget.y - ownPaddle.y)
    expect(hardStep).toBeGreaterThan(easyStep)
  })
})

describe('computeAIPaddleTarget - clamping', () => {
  it('never returns a target Y outside [paddleMinY, paddleMaxY], regardless of jitter', () => {
    const ball = { x: board.centerX, y: board.y + 2, vx: 0, vy: -50, speed: 50 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const alwaysMaxJitter = () => 1
    const target = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'easy', alwaysMaxJitter)
    expect(target.y).toBeGreaterThanOrEqual(board.paddleMinY)
    expect(target.y).toBeLessThanOrEqual(board.paddleMaxY)
  })

  it("the per-tick step is bounded by the difficulty's own maxApproachSpeed fraction of MAX_PADDLE_SPEED", () => {
    // Ball far across the board from the paddle's current Y, so the raw (pre-clamp) target
    // distance is large - the rate-of-approach clamp must be what actually limits the step.
    const ball = { x: board.centerX, y: board.paddleMaxY, vx: 0, vy: 0, speed: 0 }
    const ownPaddle = { x: board.paddleX[2], y: board.paddleMinY, vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'medium', noJitter)
    const step = Math.abs(target.y - ownPaddle.y)
    expect(step).toBeLessThanOrEqual(MAX_PADDLE_SPEED + 0.01)
  })
})

describe('computeAIPaddleTarget - X is always the fixed paddleX, never computed', () => {
  it('always returns board.paddleX[aiPlayer], regardless of ball or paddle position', () => {
    const ball = { x: board.x, y: board.y, vx: 10, vy: 10, speed: Math.hypot(10, 10) }
    const ownPaddle = { x: board.paddleX[2], y: board.y + 5, vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(ball, ownPaddle, board, 2, 'hard', noJitter)
    expect(target.x).toBe(board.paddleX[2])
  })
})
