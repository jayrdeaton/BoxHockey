import { GOAL_OPEN_FRACTION } from '@/games/airhockey/constants/game'
import { GoalAxis, PaddleSizeLevel, PuckSizeLevel } from '@/games/airhockey/types'
import { centerPaddle, clampToOwnHalf, computeBoardLayout, playerGoalSide } from '@/games/airhockey/utils/board'
import { stepPhysics } from '@/games/airhockey/utils/physics'

const insets = { top: 0, bottom: 0, left: 0, right: 0 }

function simulateToRest(puck: { x: number; y: number; vx: number; vy: number }, board: ReturnType<typeof computeBoardLayout>) {
  let p = puck
  for (let i = 0; i < 500; i++) {
    const result = stepPhysics(p, board, 1)
    p = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    if (result.scored !== null) return result.scored
    if (result.stopped) return null
  }
  return null
}

const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

describe('goal width always leaves GOAL_OPEN_FRACTION of open net around a centered paddle', () => {
  const paddleSizes: PaddleSizeLevel[] = ['small', 'medium', 'large']
  // Every puckSize x paddleSize combination - paddleSize is an entirely independent setting (see
  // LoadoutSharedControls), so this also guards the cross-combination cases (e.g. a small puck
  // with a large paddle) that the old puckSize-only GOAL_WIDTH_RATIO table couldn't see at all.
  for (const puckSize of sizes) {
    for (const paddleSize of paddleSizes) {
      it(`puckSize=${puckSize}, paddleSize=${paddleSize}`, () => {
        const board = computeBoardLayout(400, 900, insets, 'vertical', puckSize, paddleSize)
        // The span a single stationary, perfectly centered paddle blocks via circle-vs-circle
        // contact - see GOAL_OPEN_FRACTION's own comment in constants/game.ts.
        const blockingSpan = (board.paddleRadius + board.puckRadius) * 2
        expect(board.goalWidth).toBeGreaterThan(blockingSpan)
        expect(board.goalWidth).toBeLessThan(board.width)
        const openFraction = (board.goalWidth - blockingSpan) / board.goalWidth
        expect(openFraction).toBeCloseTo(GOAL_OPEN_FRACTION, 5)
      })
    }
  }
})

describe('rotating the device (swapping which real dimension is short/long) produces geometrically equivalent local geometry', () => {
  it.each(sizes)('vertical(W,H) and horizontal(H,W) agree on every geometry field, at puckSize=%s', (size) => {
    const vertical = computeBoardLayout(400, 900, insets, 'vertical', size, 'medium', true)
    const horizontal = computeBoardLayout(900, 400, insets, 'horizontal', size, 'medium', true)
    expect(horizontal.x).toBeCloseTo(vertical.x, 5)
    expect(horizontal.y).toBeCloseTo(vertical.y, 5)
    expect(horizontal.width).toBeCloseTo(vertical.width, 5)
    expect(horizontal.height).toBeCloseTo(vertical.height, 5)
    expect(horizontal.goalWidth).toBeCloseTo(vertical.goalWidth, 5)
    expect(horizontal.goalStart).toBeCloseTo(vertical.goalStart, 5)
    expect(horizontal.goalEnd).toBeCloseTo(vertical.goalEnd, 5)
    expect(horizontal.puckRadius).toBeCloseTo(vertical.puckRadius, 5)
    expect(horizontal.paddleRadius).toBeCloseTo(vertical.paddleRadius, 5)
    expect(horizontal.cornerRadius).toBeCloseTo(vertical.cornerRadius, 5)
    expect(horizontal.behindGoalDepth).toBeCloseTo(vertical.behindGoalDepth, 5)
    expect(horizontal.goalPosts).toEqual(vertical.goalPosts)
  })

  it('a mismatched pairing (same screen dims, different axis) does NOT coincidentally match', () => {
    // Sanity check that the equivalence above is actually testing something real, not a tautology
    // that happens to hold for every input.
    const vertical = computeBoardLayout(400, 900, insets, 'vertical', 'medium')
    const horizontal = computeBoardLayout(400, 900, insets, 'horizontal', 'medium')
    expect(horizontal.width).not.toBeCloseTo(vertical.width, 0)
  })
})

describe('playerGoalSide', () => {
  it('player 1 always defends the local bottom, player 2 the local top', () => {
    expect(playerGoalSide(1)).toBe('bottom')
    expect(playerGoalSide(2)).toBe('top')
  })
})

describe('goalPosts', () => {
  it('are built for both goals unconditionally, positioned at the goal opening edges', () => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium')
    expect(board.goalPosts).toHaveLength(4)
    const p1Posts = board.goalPosts.filter((p) => p.player === 1)
    const p2Posts = board.goalPosts.filter((p) => p.player === 2)
    expect(p1Posts).toHaveLength(2)
    expect(p2Posts).toHaveLength(2)
    for (const post of p1Posts) expect(post.y).toBeCloseTo(board.y + board.height, 5)
    for (const post of p2Posts) expect(post.y).toBeCloseTo(board.y, 5)
  })
})

describe('rink geometry (Settings.rink)', () => {
  it.each(sizes)('rink on: cornerRadius and behindGoalDepth are both > 0 at puckSize=%s, and the extended boundary stays within the screen', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', size, 'medium', true)
    expect(board.cornerRadius).toBeGreaterThan(0)
    expect(board.behindGoalDepth).toBeGreaterThan(0)
    expect(board.y - board.behindGoalDepth).toBeGreaterThanOrEqual(0)
    expect(board.y + board.height + board.behindGoalDepth).toBeLessThanOrEqual(900)
  })

  it.each(sizes)('rink off: square corners, no pocket, and the goal lines sit at the safe-area edges at puckSize=%s', (size) => {
    const notched = { top: 59, bottom: 34, left: 0, right: 0 }
    const board = computeBoardLayout(400, 900, notched, 'vertical', size, 'medium', false)
    expect(board.cornerRadius).toBe(0)
    expect(board.behindGoalDepth).toBe(0)
    expect(board.y).toBeCloseTo(notched.top, 5)
    expect(board.y + board.height).toBeCloseTo(900 - notched.bottom, 5)
  })

  // Same as BoxHockey's rink: the pocket borrows the otherwise-empty safe-area space instead of
  // pushing the goal lines forward, reaching the physical screen edge at both ends.
  it('rink on: the pocket reaches into the safe-area insets, all the way to both screen edges', () => {
    // Both insets deeper than the pocket's own puck-clearance minimum (68 at this size), so the
    // larger one alone sets the depth.
    const notched = { top: 80, bottom: 50, left: 0, right: 0 }
    const board = computeBoardLayout(400, 900, notched, 'vertical', 'medium', 'medium', true)
    expect(board.behindGoalDepth).toBeCloseTo(notched.top, 5)
    // The larger inset's goal line stays exactly at its safe-area edge.
    expect(board.y).toBeCloseTo(notched.top, 5)
    expect(board.y - board.behindGoalDepth).toBeCloseTo(0, 5)
    expect(board.y + board.height + board.behindGoalDepth).toBeCloseTo(900, 5)
  })

  it('rink on with equal insets: both goal lines stay exactly at their safe-area edges', () => {
    const even = { top: 80, bottom: 80, left: 0, right: 0 }
    const off = computeBoardLayout(400, 900, even, 'vertical', 'medium', 'medium', false)
    const on = computeBoardLayout(400, 900, even, 'vertical', 'medium', 'medium', true)
    expect(on.y).toBeCloseTo(off.y, 5)
    expect(on.height).toBeCloseTo(off.height, 5)
  })

  it('a puck sailing wide of the goal (not banked into a corner) can reach the pocket', () => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium', 'medium', true)
    let puck = { x: board.x + board.width * 0.25, y: board.y + board.height * 0.15, vx: 0, vy: -6 }
    let reachedPocket = false
    for (let i = 0; i < 300; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      if (puck.y < board.y) reachedPocket = true
      if (result.scored !== null || result.stopped) break
    }
    expect(reachedPocket).toBe(true)
  })

  it('rink off: a puck sailing wide of the goal stays in front of the goal line', () => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium', 'medium', false)
    // Halfway between the side wall and the goal mouth, clear of the posts.
    let puck = { x: board.x + board.goalStart / 2, y: board.y + board.height * 0.15, vx: 0, vy: -6 }
    for (let i = 0; i < 300; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      expect(puck.y - board.puckRadius).toBeGreaterThanOrEqual(board.y - 0.001)
      if (result.scored !== null || result.stopped) break
    }
  })

  it.each([true, false])('a dead-center shot at the goal still scores normally (rink %s)', (rink) => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium', 'medium', rink)
    const scored = simulateToRest({ x: board.centerX, y: board.y + board.height * 0.75, vx: 0, vy: 22 }, board)
    expect(scored).toBe(2)
  })
})

describe('centerPaddle', () => {
  it('places each player on their own goal side, offset in from the line, on the board centerline in x', () => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium')
    const p1 = centerPaddle(board, 1)
    const p2 = centerPaddle(board, 2)
    expect(p1.x).toBeCloseTo(board.centerX, 5)
    expect(p2.x).toBeCloseTo(board.centerX, 5)
    expect(p1.y).toBeLessThan(board.y + board.height)
    expect(p1.y).toBeGreaterThan(board.centerY)
    expect(p2.y).toBeGreaterThan(board.y)
    expect(p2.y).toBeLessThan(board.centerY)
  })
})

describe('clampToOwnHalf', () => {
  it('never lets a player cross the centerline into the opponent half', () => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium')
    const r = board.paddleRadius
    const p1AttemptingTop = clampToOwnHalf(board.centerX, board.y, board, 1, r)
    expect(p1AttemptingTop.y).toBeGreaterThanOrEqual(board.centerY + r - 0.01)
    const p2AttemptingBottom = clampToOwnHalf(board.centerX, board.y + board.height, board, 2, r)
    expect(p2AttemptingBottom.y).toBeLessThanOrEqual(board.centerY - r + 0.01)
  })

  it('clamps to the outer board bounds', () => {
    const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium')
    const r = board.paddleRadius
    const clamped = clampToOwnHalf(board.x - 1000, board.y + board.height + 1000, board, 1, r)
    expect(clamped.x).toBeCloseTo(board.x + r, 5)
    expect(clamped.y).toBeCloseTo(board.y + board.height - r, 5)
  })
})

describe('desktop web letterboxing', () => {
  const originalPlatform = require('react-native').Platform.OS

  afterEach(() => {
    require('react-native').Platform.OS = originalPlatform
  })

  it('letterboxes to roughly TABLE_LONG_TO_SHORT_RATIO on wide desktop web viewports, for either axis', () => {
    // Geometry is always canonical LOCAL space (see GoalSide's doc comment in types/index.ts):
    // board.width is always the short axis and board.height always the long axis, for every
    // goalAxis value - goalAxis only decides which real screen dimension feeds S vs. L, never
    // how the result's own width/height are labeled.
    //
    // Only approximate, not exact: TABLE_LONG_TO_SHORT_RATIO governs the OUTER letterboxed
    // container, but board.height is the inner PLAYING FIELD, shrunk by the rink's goal pocket
    // depth at each end - same "field is inner, container is outer" distinction BoxHockey's own
    // board.ts uses. A narrower letterboxed S makes that pocket a proportionally bigger bite out of
    // L, so the field's own ratio drifts further from 2:1 than the outer container did.
    require('react-native').Platform.OS = 'web'
    const axes: GoalAxis[] = ['vertical', 'horizontal']
    for (const axis of axes) {
      const unclamped = computeBoardLayout(2000, 1900, insets, axis, 'medium', 'medium', true) // both dims generous, so neither is the tight constraint
      const clampedByWidth = computeBoardLayout(1600, 1000, insets, axis, 'medium', 'medium', true) // long dimension is the tight constraint here
      // Letterboxing actually engaged: the clamped board is narrower/shorter than one with no
      // tight constraint on either dimension.
      expect(clampedByWidth.width).toBeLessThan(unclamped.width)
      expect(clampedByWidth.height / clampedByWidth.width).toBeGreaterThan(1.5)
      expect(clampedByWidth.height / clampedByWidth.width).toBeLessThan(2.1)
    }
  })
})
