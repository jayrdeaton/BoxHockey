import { MAX_SPEED } from '@/constants/game'
import { PuckSizeLevel } from '@/types'
import { computeBoardLayout } from '@/utils/board'
import { stepPhysics } from '@/utils/physics'

// Integration coverage for computeBoardLayout + stepPhysics together, using the REAL layout
// geometry — unlike physics.test.ts/aiOpponent.test.ts, which construct a synthetic BoardLayout
// fixture by hand and so never exercise goalWidth/puckRadius's actual derivation. That gap is
// exactly what let a real regression through this session: goalWidth was briefly
// `puckRadius * 3`, which left only half a puck radius of aiming slop per side to clear the goal
// (stepPhysics requires the puck's whole diameter inside goalLeft/goalRight, not just its
// center) — tight enough that even a well-aimed "clear" shot would clip the goal line instead of
// scoring. See DIVIDER_HOLE_TO_PUCK_RADIUS's comment in constants/game.ts.
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

describe('computeBoardLayout goal geometry stays makeable', () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  it.each(sizes)('a dead-center, full-speed shot from center ice scores at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'classic', size)
    const scored = simulateToRest({ x: board.centerX, y: board.centerY, vx: 0, vy: MAX_SPEED }, board)
    expect(scored).toBe(2)
  })

  it.each(sizes)('a shot half a puck radius off dead-center still scores at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'classic', size)
    const offset = board.puckRadius * 0.5
    const scored = simulateToRest({ x: board.centerX + offset, y: board.centerY, vx: 0, vy: MAX_SPEED }, board)
    expect(scored).toBe(2)
  })

  // Puck size doubles as a difficulty/accessibility tier (user feedback: "the bigger the setting
  // the more forgiving it should be") — DIVIDER_HOLE_TO_PUCK_RADIUS grows with puckSize (margin
  // per side is 0.75r/1r/1.5r for small/medium/large), so a 1.2-puck-radius-off shot clears only
  // 'large's margin. This is what actually proves the tiers differ in forgiveness, as opposed to
  // the tests above, which only prove every tier is independently makeable at a fixed offset.
  it('a 1.2-puck-radius-off shot only scores at the largest, most forgiving puck size', () => {
    const outcomes = sizes.map((size) => {
      const board = computeBoardLayout(400, 900, insets, 'classic', size)
      const offset = board.puckRadius * 1.2
      return simulateToRest({ x: board.centerX + offset, y: board.centerY, vx: 0, vy: MAX_SPEED }, board)
    })
    expect(outcomes).toEqual([null, null, 2])
  })
})
