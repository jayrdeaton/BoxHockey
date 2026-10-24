import { MAX_PADDLE_SPEED } from '@/games/airhockey/constants/game'
import { computeAIPaddleTarget, rollAIJitter } from '@/games/airhockey/utils/aiOpponent'
import { centerPaddle, computeBoardLayout } from '@/games/airhockey/utils/board'

const insets = { top: 0, bottom: 0, left: 0, right: 0 }
const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium')

describe('computeAIPaddleTarget - threat gate', () => {
  it('chases a puck on its own half moving toward its own goal (player 2 defends top)', () => {
    // Offset derived from paddleRadius (not a fixed pixel count) so this stays clear of the
    // near-goal clamp band (clampToOwnHalf's minY = board.y + paddleRadius) regardless of paddle
    // size - too close in and the predicted-position target legitimately overshoots past the
    // puck's CURRENT position while still correctly chasing its PREDICTED one, which this
    // assertion (measured against the current position) isn't meant to exercise.
    const puck = { x: board.centerX, y: board.y + board.paddleRadius * 5, vx: 0, vy: -3 } // on P2's half, heading further into it
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard')
    // Should move toward the puck's predicted position, not stay at (or retreat toward) home.
    const distToPuckBefore = Math.hypot(ownPaddle.x - puck.x, ownPaddle.y - puck.y)
    const distToPuckAfter = Math.hypot(target.x - puck.x, target.y - puck.y)
    expect(distToPuckAfter).toBeLessThan(distToPuckBefore)
  })

  it('retreats toward home when the puck is on its own half but moving AWAY (toward the opponent)', () => {
    const puck = { x: board.centerX, y: board.y + 40, vx: 0, vy: 5 } // on P2's half, but heading toward P1
    const ownPaddle = { x: board.centerX + 60, y: board.y + 100, vx: 0, vy: 0 } // off its home spot
    const home = centerPaddle(board, 2)
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard')
    const distToHomeBefore = Math.hypot(ownPaddle.x - home.x, ownPaddle.y - home.y)
    const distToHomeAfter = Math.hypot(target.x - home.x, target.y - home.y)
    expect(distToHomeAfter).toBeLessThan(distToHomeBefore)
  })

  it('retreats toward home when the puck is entirely on the opponent half', () => {
    const puck = { x: board.centerX, y: board.y + board.height - 40, vx: 0, vy: -8 } // deep on P1's half
    const ownPaddle = { x: board.centerX + 60, y: board.y + 100, vx: 0, vy: 0 }
    const home = centerPaddle(board, 2)
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard')
    const distToHomeBefore = Math.hypot(ownPaddle.x - home.x, ownPaddle.y - home.y)
    const distToHomeAfter = Math.hypot(target.x - home.x, target.y - home.y)
    expect(distToHomeAfter).toBeLessThan(distToHomeBefore)
  })
})

describe('computeAIPaddleTarget - loose puck (kickoff / faceoff serve)', () => {
  it('chases a stationary puck sitting dead center (game-start kickoff), instead of sitting home', () => {
    const puck = { x: board.centerX, y: board.centerY, vx: 0, vy: 0 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard')
    const distToPuckBefore = Math.hypot(ownPaddle.x - puck.x, ownPaddle.y - puck.y)
    const distToPuckAfter = Math.hypot(target.x - puck.x, target.y - puck.y)
    expect(distToPuckAfter).toBeLessThan(distToPuckBefore)
  })

  it("chases a stationary puck sitting in its own faceoff zone (the post-goal 'won the draw' serve)", () => {
    const puck = { x: board.centerX - board.width * 0.2, y: board.y + board.height * 0.35, vx: 0, vy: 0 } // P2's own half, near its own goal
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard')
    const distToPuckBefore = Math.hypot(ownPaddle.x - puck.x, ownPaddle.y - puck.y)
    const distToPuckAfter = Math.hypot(target.x - puck.x, target.y - puck.y)
    expect(distToPuckAfter).toBeLessThan(distToPuckBefore)
  })

  it("still retreats home for a stopped puck deep on the OPPONENT's half - that's their puck to reach first", () => {
    const puck = { x: board.centerX, y: board.y + board.height - 30, vx: 0, vy: 0 }
    const ownPaddle = { x: board.centerX + 60, y: board.y + 100, vx: 0, vy: 0 }
    const home = centerPaddle(board, 2)
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard')
    const distToHomeBefore = Math.hypot(ownPaddle.x - home.x, ownPaddle.y - home.y)
    const distToHomeAfter = Math.hypot(target.x - home.x, target.y - home.y)
    expect(distToHomeAfter).toBeLessThan(distToHomeBefore)
  })
})

describe('rollAIJitter', () => {
  it('a harder difficulty rolls a smaller-magnitude jitter than an easier one, for the same raw random draw', () => {
    const maxDraw = () => 1 // mag = 1 * aimJitterPx = full jitter
    const easy = rollAIJitter('easy', maxDraw)
    const hard = rollAIJitter('hard', maxDraw)
    expect(Math.hypot(hard.x, hard.y)).toBeLessThan(Math.hypot(easy.x, easy.y))
  })

  it('draws (0, 0) as a jitter offset are a no-op', () => {
    const offset = rollAIJitter('easy', () => 0)
    expect(offset).toEqual({ x: 0, y: 0 })
  })
})

describe('computeAIPaddleTarget - difficulty tiers', () => {
  it('a harder difficulty approaches its target faster than an easier one, when both are far from it', () => {
    const puck = { x: board.centerX + board.width * 0.3, y: board.y + 20, vx: 0, vy: -1 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 } // far from the puck's own corner
    const easyTarget = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'easy')
    const hardTarget = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard')
    const easyStep = Math.hypot(easyTarget.x - ownPaddle.x, easyTarget.y - ownPaddle.y)
    const hardStep = Math.hypot(hardTarget.x - ownPaddle.x, hardTarget.y - ownPaddle.y)
    expect(hardStep).toBeGreaterThan(easyStep)
  })
})

describe('computeAIPaddleTarget - clamping', () => {
  it('never returns a target that crosses the centerline, regardless of jitter', () => {
    const puck = { x: board.centerX, y: board.y + 5, vx: 0, vy: -5 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'easy', { x: 0, y: 1000 })
    expect(target.y).toBeLessThanOrEqual(board.centerY)
  })

  it("the per-tick step is bounded by the difficulty's own maxApproachSpeed fraction of MAX_PADDLE_SPEED", () => {
    // Puck far across the board from the paddle's current position, so the raw (pre-clamp) target
    // distance is large - the rate-of-approach clamp must be what actually limits the step.
    const puck = { x: board.x + board.width * 0.9, y: board.y + 10, vx: 0, vy: -2 }
    const ownPaddle = { x: board.x + board.width * 0.1, y: board.y + board.height * 0.4, vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'medium')
    const step = Math.hypot(target.x - ownPaddle.x, target.y - ownPaddle.y)
    expect(step).toBeLessThanOrEqual(MAX_PADDLE_SPEED + 0.01)
  })
})
