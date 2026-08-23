import { MAX_SPEED } from '@/constants/game'
import { BoardVariant, PuckSizeLevel } from '@/types'
import { computeBoardLayout, faceoffZoneCenters, faceoffZoneRadius } from '@/utils/board'
import { circleVsRect, stepPhysics } from '@/utils/physics'

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

// Direct regression guard for a bug that already bit 'classic' once (see its buildObstacles case
// in utils/board.ts): a wall gap or gravity well positioned too close to a faceoff dot lets a
// dead-straight shot from the dot clear it with no real aiming required. Checked generically
// across every variant/puckSize rather than just the two new variants that prompted it, so any
// future board type gets the same guard for free.
describe('no wall gap or gravity well overlaps a faceoff dot', () => {
  const variants: BoardVariant[] = ['classic', 'gauntlet', 'gauntletPlus', 'gravity', 'gravityClassic', 'rink']
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  for (const variant of variants) {
    for (const size of sizes) {
      it(`${variant} at puckSize=${size}`, () => {
        const board = computeBoardLayout(400, 900, insets, variant, size)
        const dotRadius = faceoffZoneRadius(board)
        const dots = [...faceoffZoneCenters(board, 1), ...faceoffZoneCenters(board, 2)]

        for (const dot of dots) {
          for (const obs of board.obstacles) {
            const hit = circleVsRect(dot.x, dot.y, dotRadius, obs.x, obs.y, obs.width, obs.height).hit
            expect(hit).toBe(false)
          }
          for (const well of board.gravityWells) {
            const dist = Math.hypot(well.x - dot.x, well.y - dot.y)
            expect(dist).toBeGreaterThan(well.radius + dotRadius)
          }
        }
      })
    }
  }
})

// Regression coverage for a real playtesting bug: the two outer walls originally used a
// deliberately narrower gap (puckRadius*2.2) than the center wall's puckRadius*3.2, and the three
// walls sat at uneven y-fractions (0.28/0.5/0.72) rather than dividing the rink evenly — both
// corrected per explicit user feedback.
describe('gauntletPlus: every gap is the same size, and the walls divide the rink into 4 equal zones', () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  it.each(sizes)('all 3 walls use the same DIVIDER_HOLE_TO_PUCK_RADIUS gap width at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'gauntletPlus', size)
    // Each wall is 3 obstacle segments (2 holes) except the center wall (2 segments, 1 hole) — 8
    // segments total. Gap width = the horizontal distance between adjacent segments within the
    // same wall (same y). Group by y, then measure gaps.
    const byY = new Map<number, { x: number; width: number }[]>()
    for (const obs of board.obstacles) {
      const segs = byY.get(obs.y) ?? []
      segs.push({ x: obs.x, width: obs.width })
      byY.set(obs.y, segs)
    }
    const gapWidths: number[] = []
    for (const segs of byY.values()) {
      const sorted = [...segs].sort((a, b) => a.x - b.x)
      for (let i = 0; i < sorted.length - 1; i++) {
        gapWidths.push(sorted[i + 1].x - (sorted[i].x + sorted[i].width))
      }
    }
    expect(gapWidths).toHaveLength(5) // 2 gaps each in the top/bottom walls (2 holes) + 1 in the center wall (1 hole)
    for (const w of gapWidths) expect(w).toBeCloseTo(gapWidths[0], 5)
  })

  it('the 3 walls sit at y-fractions 0.25/0.5/0.75, dividing the rink into 4 equal zones', () => {
    const board = computeBoardLayout(400, 900, insets, 'gauntletPlus', 'medium')
    const wallYs = [...new Set(board.obstacles.map((o) => o.y))].sort((a, b) => a - b)
    expect(wallYs).toHaveLength(3)
    const boundaries = [board.y, ...wallYs.map((wy) => wy + board.wallThickness / 2), board.y + board.height]
    const zoneHeights = boundaries.slice(1).map((b, i) => b - boundaries[i])
    for (const h of zoneHeights) expect(h).toBeCloseTo(board.height / 4, 0)
  })
})

describe("rink's cornerRadius/behindGoalDepth", () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']
  const nonRinkVariants: BoardVariant[] = ['classic', 'gauntlet', 'gauntletPlus', 'gravity', 'gravityClassic']

  it.each(sizes)('are both > 0 at puckSize=%s, and the extended boundary stays within the viewport', (size) => {
    const insetsZero = { top: 0, bottom: 0, left: 0, right: 0 }
    const board = computeBoardLayout(400, 900, insetsZero, 'rink', size)
    expect(board.cornerRadius).toBeGreaterThan(0)
    expect(board.behindGoalDepth).toBeGreaterThan(0)
    // The true collision boundary (board.y - behindGoalDepth .. board.y+height+behindGoalDepth)
    // must never fall outside [0, 900] — this is the direct regression guard for Strategy B
    // (see computeBoardLayout's own comment): behindGoalDepth eats into the front-line
    // board.height rather than growing past the original letterboxed viewport.
    expect(board.y - board.behindGoalDepth).toBeGreaterThanOrEqual(0)
    expect(board.y + board.height + board.behindGoalDepth).toBeLessThanOrEqual(900)
  })

  it.each(nonRinkVariants)('%s has cornerRadius=0 and behindGoalDepth=0', (variant) => {
    const board = computeBoardLayout(400, 900, insets, variant, 'medium')
    expect(board.cornerRadius).toBe(0)
    expect(board.behindGoalDepth).toBe(0)
  })
})

describe('rink: the net back wall never blocks a normal, gradually-completed goal', () => {
  // Slow enough that the puck takes many stepPhysics frames to fully clear the line (rather than
  // jumping past it in one integration step) — this is the case that would have hit the
  // 'behindGoalDepth' bug found during implementation: too shallow a pocket meant a puck mid-
  // crossing (leading edge past the line, trailing edge not yet) could already be overlapping the
  // net's own back wall and get bounced out before ever completing the score.
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  it.each(sizes)('a slow, dead-center shot still scores at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'rink', size)
    // Starts a few puck radii from the goal line (rather than mid-board) so friction decay alone
    // doesn't stop it short before it ever reaches the line — the point of this test is the
    // near-the-line crossing behavior, not full-board travel.
    const startY = board.y + board.height - board.puckRadius * 4
    const slowSpeed = board.puckRadius * 0.4 // small enough to take multiple frames to cross the line
    const scored = simulateToRest({ x: board.centerX, y: startY, vx: 0, vy: slowSpeed }, board)
    expect(scored).toBe(2)
  })
})

describe("rink: a puck deep in a corner pocket can't register as a score", () => {
  it('sitting well past the front line but outside the goal x-range does not score', () => {
    const board = computeBoardLayout(400, 900, insets, 'rink', 'medium')
    // Positioned inside a top corner's pocket (near the left wall, past board.y by more than the
    // puck's own radius) — nowhere near the goal's x-range.
    const puck = { x: board.x + board.cornerRadius * 0.3, y: board.y - board.behindGoalDepth * 0.5, vx: 0, vy: 0 }
    const result = stepPhysics(puck, board, 1)
    expect(result.scored).toBeNull()
  })
})

// Regression coverage for a real playtesting bug: the first implementation kept the flat wall at
// board.y across nearly the entire width, with only a tiny notch receding near the literal
// corners — that notch's own geometry couldn't reach the true boundary either, so a puck could
// never actually get behind the goal at all; 'rink' just shrank board.height for nothing. The fix
// moved the flat wall itself to the true outer boundary (outerTop/outerBottom) everywhere outside
// the goal mouth and the (now purely cosmetic) rounded corners — see stepPhysics' own comment.
describe('rink: the pocket is reachable without needing the rounded corner at all', () => {
  it('a puck sailing wide of the goal (not banked into a corner) can cross into the pocket', () => {
    const board = computeBoardLayout(400, 900, insets, 'rink', 'medium')
    // Well clear of both the goal's x-range and the corner's x-range, heading straight at the
    // true outer boundary — this is the main, ordinary path into the pocket, not an edge case.
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

  it('a straight shot at the goal mouth still scores normally (the pocket fix does not break scoring)', () => {
    const board = computeBoardLayout(400, 900, insets, 'rink', 'medium')
    const scored = simulateToRest({ x: board.centerX, y: board.centerY, vx: 0, vy: MAX_SPEED }, board)
    expect(scored).toBe(2)
  })
})

describe("rink: the net's side posts block scoring from the side", () => {
  it('a puck already behind the line, drifting sideways toward the goal, is blocked before it can score', () => {
    const board = computeBoardLayout(400, 900, insets, 'rink', 'medium')
    // Starts in the open pocket area (not in the goal's x-range), moving sideways toward it —
    // without the net's side posts, this could drift straight into the goal's x-range while
    // already past the line and register an accidental score.
    let puck = { x: board.x + board.width * 0.3, y: board.y - board.behindGoalDepth * 0.5, vx: 4, vy: 0 }
    let scored: number | null = null
    for (let i = 0; i < 200; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      if (result.scored !== null) {
        scored = result.scored
        break
      }
      if (result.stopped) break
    }
    expect(scored).toBeNull()
  })
})

// Regression coverage for a real playtesting bug: the center attractor was originally sized
// (width*0.11) without accounting for how far classic's own holes actually sit from center — for
// every puck size, that radius landed entirely inside the solid wall, never once reaching open
// space a puck could occupy. A well nothing can ever get close to is a well that can never affect
// anything, which is exactly what got reported.
describe('gravityClassic: the center attractor actually reaches open space', () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  it.each(sizes)("its influence radius extends past classic's nearest hole edge at puckSize=%s", (size) => {
    const board = computeBoardLayout(400, 900, insets, 'gravityClassic', size)
    const attractor = board.gravityWells.find((w) => w.strength > 0)!
    // classic's hole center sits width*0.3 from board center (see buildObstacles' 'classic' case)
    // — the well's own x/y already sit at board center, so distance-to-hole-center is exactly
    // that offset.
    const holeCenterDist = board.width * 0.3
    expect(attractor.radius).toBeGreaterThan(holeCenterDist)
  })
})
