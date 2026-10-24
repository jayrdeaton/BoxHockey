import { PADDLE_HEIGHT_RATIOS, SHARED_BRICK_COLS, SHARED_BRICK_ROWS, SOLO_BRICK_COLS, SOLO_BRICK_ROWS, TABLE_WIDTH_TO_HEIGHT_RATIO } from '@/shared/paddleGame/constants/game'
import { Brick, PaddleSizeLevel } from '@/shared/paddleGame/types'
import { buildSharedBrickField, buildSoloBrickField, centerBall, centerPaddle, clampPaddleY, computeBoardLayout, rescaleBricks } from '@/shared/paddleGame/utils/board'

const insets = { top: 0, bottom: 0, left: 0, right: 0 }
const sizes: PaddleSizeLevel[] = ['small', 'medium', 'large']

function withinBoard(brick: Brick, board: ReturnType<typeof computeBoardLayout>): boolean {
  return brick.x >= board.x && brick.y >= board.y && brick.x + brick.width <= board.x + board.width && brick.y + brick.height <= board.y + board.height
}

describe('paddleHeight scales per PaddleSizeLevel tier', () => {
  it.each(sizes)('matches PADDLE_HEIGHT_RATIOS at paddleSize=%s', (size) => {
    const board = computeBoardLayout(900, 400, insets, size)
    expect(board.paddleHeight).toBeCloseTo(board.height * PADDLE_HEIGHT_RATIOS[size], 5)
  })

  it('a larger tier produces a taller paddle than a smaller one', () => {
    const small = computeBoardLayout(900, 400, insets, 'small')
    const large = computeBoardLayout(900, 400, insets, 'large')
    expect(large.paddleHeight).toBeGreaterThan(small.paddleHeight)
  })
})

describe('paddleX', () => {
  it('player 1 always sits left of player 2, both inset from their own edge', () => {
    const board = computeBoardLayout(900, 400, insets, 'medium')
    expect(board.paddleX[1]).toBeLessThan(board.paddleX[2])
    expect(board.paddleX[1]).toBeGreaterThan(board.x)
    expect(board.paddleX[2]).toBeLessThan(board.x + board.width)
  })

  it('stays proportionally symmetric around centerX regardless of paddleSize (inset is width-derived, not size-tiered)', () => {
    const board = computeBoardLayout(900, 400, insets, 'medium')
    const insetP1 = board.paddleX[1] - board.x
    const insetP2 = board.x + board.width - board.paddleX[2]
    expect(insetP1).toBeCloseTo(insetP2, 5)
  })
})

describe('ballRadius', () => {
  it('scales with board HEIGHT, not width - the axis that stays meaningful across both seating orientations', () => {
    const short = computeBoardLayout(900, 300, insets, 'medium')
    const tall = computeBoardLayout(900, 600, insets, 'medium')
    expect(tall.ballRadius).toBeGreaterThan(short.ballRadius)
  })
})

describe('paddleMinY / paddleMaxY', () => {
  it('bracket centerY, inset by paddleHeight/2, spanning the FULL board height - no half-court clamp, unlike AirHockey', () => {
    const board = computeBoardLayout(900, 400, insets, 'medium')
    expect(board.paddleMinY).toBeCloseTo(board.y + board.paddleHeight / 2, 5)
    expect(board.paddleMaxY).toBeCloseTo(board.y + board.height - board.paddleHeight / 2, 5)
    expect(board.centerY).toBeGreaterThan(board.paddleMinY)
    expect(board.centerY).toBeLessThan(board.paddleMaxY)
    expect(board.paddleMaxY - board.paddleMinY).toBeCloseTo(board.height - board.paddleHeight, 5)
  })
})

describe('desktop web letterboxing', () => {
  const originalPlatform = require('react-native').Platform.OS

  afterEach(() => {
    require('react-native').Platform.OS = originalPlatform
  })

  it('fixes the board to TABLE_WIDTH_TO_HEIGHT_RATIO on wide desktop web viewports', () => {
    require('react-native').Platform.OS = 'web'
    const board = computeBoardLayout(2000, 900, insets, 'medium') // width is the tight constraint here
    expect(board.width / board.height).toBeCloseTo(TABLE_WIDTH_TO_HEIGHT_RATIO, 3)
    expect(board.width).toBeLessThan(2000) // letterboxing actually engaged, not just a coincidence
  })

  it('does not letterbox on native/mobile - the board fills the viewport exactly, whatever its shape', () => {
    require('react-native').Platform.OS = 'ios'
    const board = computeBoardLayout(2000, 900, insets, 'medium')
    expect(board.width).toBeCloseTo(2000, 5)
    expect(board.height).toBeCloseTo(900, 5)
  })
})

describe('centerBall / centerPaddle / clampPaddleY', () => {
  it('centerBall places the ball at the exact board center', () => {
    const board = computeBoardLayout(900, 400, insets, 'medium')
    const c = centerBall(board)
    expect(c.x).toBeCloseTo(board.centerX, 5)
    expect(c.y).toBeCloseTo(board.centerY, 5)
  })

  it('centerPaddle places each player at their own FIXED X, board center Y', () => {
    const board = computeBoardLayout(900, 400, insets, 'medium')
    const p1 = centerPaddle(board, 1)
    const p2 = centerPaddle(board, 2)
    expect(p1.x).toBeCloseTo(board.paddleX[1], 5)
    expect(p2.x).toBeCloseTo(board.paddleX[2], 5)
    expect(p1.y).toBeCloseTo(board.centerY, 5)
    expect(p2.y).toBeCloseTo(board.centerY, 5)
  })

  it('clampPaddleY clamps to [paddleMinY, paddleMaxY] and leaves an in-range value untouched', () => {
    const board = computeBoardLayout(900, 400, insets, 'medium')
    expect(clampPaddleY(board.y - 1000, board)).toBeCloseTo(board.paddleMinY, 5)
    expect(clampPaddleY(board.y + board.height + 1000, board)).toBeCloseTo(board.paddleMaxY, 5)
    expect(clampPaddleY(board.centerY, board)).toBeCloseTo(board.centerY, 5)
  })
})

describe('buildSoloBrickField', () => {
  const board = computeBoardLayout(900, 400, insets, 'medium')
  const bricks = buildSoloBrickField(board)

  it('produces exactly SOLO_BRICK_COLS * SOLO_BRICK_ROWS bricks', () => {
    expect(bricks).toHaveLength(SOLO_BRICK_COLS * SOLO_BRICK_ROWS)
  })

  it('every brick starts undestroyed and fully within the board rect', () => {
    expect(bricks.every((b) => !b.destroyed)).toBe(true)
    expect(bricks.every((b) => withinBoard(b, board))).toBe(true)
  })

  it('no two bricks share a position - a real grid, not a stack of overlapping rects', () => {
    const positions = new Set(bricks.map((b) => `${b.x},${b.y}`))
    expect(positions.size).toBe(bricks.length)
  })
})

describe('buildSharedBrickField', () => {
  const board = computeBoardLayout(900, 400, insets, 'medium')
  const bricks = buildSharedBrickField(board)

  it('produces exactly SHARED_BRICK_COLS * SHARED_BRICK_ROWS bricks, fewer than the solo field', () => {
    expect(bricks).toHaveLength(SHARED_BRICK_COLS * SHARED_BRICK_ROWS)
    expect(bricks.length).toBeLessThan(buildSoloBrickField(board).length)
  })

  it('every brick starts undestroyed and fully within the board rect', () => {
    expect(bricks.every((b) => !b.destroyed)).toBe(true)
    expect(bricks.every((b) => withinBoard(b, board))).toBe(true)
  })

  it("never overlaps either paddle's reachable column - centered on the court, paddles fixed at their own X", () => {
    const halfW = board.paddleWidth / 2
    const p1Right = board.paddleX[1] + halfW
    const p2Left = board.paddleX[2] - halfW
    expect(bricks.every((b) => b.x >= p1Right && b.x + b.width <= p2Left)).toBe(true)
  })
})

describe('rescaleBricks', () => {
  const board = computeBoardLayout(900, 400, insets, 'medium')

  it('remaps position and size fractionally, and carries destroyed state straight through', () => {
    const bricks = buildSoloBrickField(board).map((b, i) => ({ ...b, destroyed: i === 0 }))
    const doubled = computeBoardLayout(1800, 800, insets, 'medium')
    const rescaled = rescaleBricks(bricks, board, doubled)

    expect(rescaled).toHaveLength(bricks.length)
    expect(rescaled[0].destroyed).toBe(true)
    expect(rescaled.slice(1).every((b) => !b.destroyed)).toBe(true)
    // Doubling the board should double each brick's size along with its position.
    expect(rescaled[1].width).toBeCloseTo(bricks[1].width * (doubled.width / board.width), 5)
    expect(rescaled[1].height).toBeCloseTo(bricks[1].height * (doubled.height / board.height), 5)
  })

  it('falls back to a stable (non-NaN) result when rescaling from a degenerate zero-sized board', () => {
    const bricks = buildSoloBrickField(board)
    const zeroBoard = computeBoardLayout(0, 0, insets, 'medium')
    const rescaled = rescaleBricks(bricks, zeroBoard, board)
    expect(rescaled.every((b) => !Number.isNaN(b.x) && !Number.isNaN(b.y) && !Number.isNaN(b.width) && !Number.isNaN(b.height))).toBe(true)
  })
})
