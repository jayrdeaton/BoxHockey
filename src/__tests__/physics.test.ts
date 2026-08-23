import { FRICTION_LEVELS, STOP_THRESHOLD } from '@/constants/game'
import { BoardLayout } from '@/types'
import { applyGravityWellForces, computeAimVector, computeTrajectory, stepPhysics } from '@/utils/physics'

// A standard test board with no obstacles
const board: BoardLayout = {
  x: 10,
  y: 10,
  width: 300,
  height: 500,
  wallThickness: 8,
  goalWidth: 80,
  goalLeft: 110, // (300 - 80) / 2
  goalRight: 190, // goalLeft + goalWidth
  puckRadius: 18,
  centerX: 160,
  centerY: 260,
  obstacles: [],
  gravityWells: [],
  cornerRadius: 0,
  behindGoalDepth: 0
}

const cx = board.x + board.width / 2 // 160
const cy = board.y + board.height / 2 // 260
const r = board.puckRadius // 18

// ─── stepPhysics ─────────────────────────────────────────────────────────────

describe('stepPhysics — wall bounces', () => {
  it('bounces off left wall and reverses vx', () => {
    const puck = { x: board.x + r + 1, y: cy, vx: -5, vy: 0 }
    const result = stepPhysics(puck, board)
    expect(result.x).toBeGreaterThanOrEqual(board.x + r)
    expect(result.vx).toBeGreaterThan(0)
    expect(result.bounced).toBe(true)
    expect(result.scored).toBeNull()
  })

  it('bounces off right wall and reverses vx', () => {
    const puck = { x: board.x + board.width - r - 1, y: cy, vx: 5, vy: 0 }
    const result = stepPhysics(puck, board)
    expect(result.x).toBeLessThanOrEqual(board.x + board.width - r)
    expect(result.vx).toBeLessThan(0)
    expect(result.bounced).toBe(true)
  })

  it('bounces off top wall outside goal and reverses vy', () => {
    // Position horizontally outside the goal opening
    const outsideGoalX = board.x + 30 // well left of goalLeft (110)
    const puck = { x: outsideGoalX, y: board.y + r + 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    expect(result.y).toBeGreaterThanOrEqual(board.y + r)
    expect(result.vy).toBeGreaterThan(0)
    expect(result.bounced).toBe(true)
    expect(result.scored).toBeNull()
  })

  it('bounces off bottom wall outside goal and reverses vy', () => {
    const outsideGoalX = board.x + board.width - 30
    const puck = { x: outsideGoalX, y: board.y + board.height - r - 1, vx: 0, vy: 5 }
    const result = stepPhysics(puck, board)
    expect(result.y).toBeLessThanOrEqual(board.y + board.height - r)
    expect(result.vy).toBeLessThan(0)
    expect(result.bounced).toBe(true)
  })

  it('applies wall restitution (speed is reduced after bounce)', () => {
    const speed = 10
    const puck = { x: board.x + r + 1, y: cy, vx: -speed, vy: 0 }
    const result = stepPhysics(puck, board)
    expect(Math.abs(result.vx)).toBeLessThan(speed)
  })

  it('does not bounce when puck is not near any wall', () => {
    const puck = { x: cx, y: cy, vx: 2, vy: 2 }
    const result = stepPhysics(puck, board)
    expect(result.bounced).toBe(false)
    expect(result.scored).toBeNull()
    expect(result.stopped).toBe(false)
  })
})

describe('stepPhysics — goal detection', () => {
  const goalAbsLeft = board.x + board.goalLeft // 120
  const goalAbsRight = board.x + board.goalRight // 200
  const safeX = (goalAbsLeft + goalAbsRight) / 2 // 160 — dead center

  it('scores P1 (top) once the puck has fully cleared the top goal line', () => {
    // Trailing edge (y + r) just past board.y — the whole puck, not just the leading edge.
    // Top is P2's own crease (P1 always sits at the bottom), so a puck fully through it scores
    // for the attacker, P1.
    const puck = { x: safeX, y: board.y - r - 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBe(1)
    expect(result.stopped).toBe(false)
  })

  it('scores P2 (bottom) once the puck has fully cleared the bottom goal line', () => {
    // Bottom is P1's own crease, so a puck fully through it scores for the attacker, P2.
    const puck = { x: safeX, y: board.y + board.height + r + 1, vx: 0, vy: 5 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBe(2)
  })

  it('does NOT score merely touching the goal line — has to clear it entirely, like real box hockey', () => {
    // Leading edge (y - r) is past board.y, but the trailing edge (y + r) is still well inside
    // the board — under the old "any part touches" rule this scored instantly; now it shouldn't.
    const puck = { x: safeX, y: board.y + r - 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBeNull()
    // Lined up with the goal, so it passes through uncollided rather than bouncing off a "wall".
    expect(result.bounced).toBe(false)
  })

  it('does NOT score when puck overlaps goal edge (partial entry)', () => {
    // Puck right edge clips into goal but left edge is still outside
    const clipX = goalAbsLeft + 2 // left edge of puck at 102, which is < goalAbsLeft
    const puck = { x: clipX, y: board.y + r - 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    // puck.x - r = 84, goalAbsLeft = 120 → puck left edge is outside goal
    expect(result.scored).toBeNull()
    expect(result.bounced).toBe(true)
  })
})

describe('stepPhysics — stopping', () => {
  it('reports stopped when velocity is below threshold', () => {
    const puck = { x: cx, y: cy, vx: 0.05, vy: 0.05 }
    const result = stepPhysics(puck, board)
    expect(result.stopped).toBe(true)
  })

  it('does not report stopped when velocity is above threshold', () => {
    const puck = { x: cx, y: cy, vx: 3, vy: 3 }
    const result = stepPhysics(puck, board)
    expect(result.stopped).toBe(false)
  })
})

describe('stepPhysics — obstacle collision', () => {
  const boardWithObs: BoardLayout = {
    ...board,
    obstacles: [{ x: board.x + 8, y: cy - 5, width: board.width * 0.52 - 8, height: 10 }]
  }

  it('pushes puck out of obstacle overlap and reflects velocity', () => {
    // Puck center starts just above the obstacle top so it approaches from above
    const obsTop = cy - 5 // 255
    const obsBottom = obsTop + 10 // 265
    const puck = { x: board.x + 60, y: obsTop - r + 2, vx: 0, vy: 3 }
    const result = stepPhysics(puck, boardWithObs)
    expect(result.bounced).toBe(true)
    // After push-out the puck bottom edge should sit at or above the obstacle top
    expect(result.y + r).toBeLessThanOrEqual(obsTop + 0.5)
    // Velocity should now point away from the surface (upward)
    expect(result.vy).toBeLessThan(0)
    void obsBottom // referenced for clarity
  })
})

describe('stepPhysics — gravity wells', () => {
  it('pulls the puck toward an attractor well', () => {
    const well = { x: cx + 50, y: cy, radius: 80, strength: 1 }
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    const puck = { x: cx, y: cy, vx: 3, vy: 0 }
    const result = stepPhysics(puck, boardWithWell)
    expect(result.vx).toBeGreaterThan(3 * FRICTION_LEVELS.medium)
  })

  it('pushes the puck away from a repeller well', () => {
    const well = { x: cx + 50, y: cy, radius: 80, strength: -1 }
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    const puck = { x: cx, y: cy, vx: 3, vy: 0 }
    const result = stepPhysics(puck, boardWithWell)
    expect(result.vx).toBeLessThan(3 * FRICTION_LEVELS.medium)
  })

  it('does not apply well force beyond the influence radius', () => {
    const well = { x: cx + 200, y: cy, radius: 30, strength: 5 }
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    const puck = { x: cx, y: cy, vx: 3, vy: 0 }
    const result = stepPhysics(puck, boardWithWell)
    expect(result.vx).toBeCloseTo(3 * FRICTION_LEVELS.medium, 5)
  })

  it('reports enteredWell "attract" when the puck crosses into an attractor radius', () => {
    const well = { x: cx + 50, y: cy, radius: 40, strength: 1 }
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    const puck = { x: cx, y: cy, vx: 15, vy: 0 } // fast enough to cross the boundary this step
    const result = stepPhysics(puck, boardWithWell)
    expect(result.enteredWell).toBe('attract')
  })

  it('reports enteredWell "repel" when the puck crosses into a repeller radius', () => {
    const well = { x: cx + 50, y: cy, radius: 40, strength: -1 }
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    const puck = { x: cx, y: cy, vx: 15, vy: 0 }
    const result = stepPhysics(puck, boardWithWell)
    expect(result.enteredWell).toBe('repel')
  })

  it('reports enteredWell null when the puck stays outside every well', () => {
    const well = { x: cx + 200, y: cy, radius: 20, strength: 1 }
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    const puck = { x: cx, y: cy, vx: 3, vy: 0 }
    const result = stepPhysics(puck, boardWithWell)
    expect(result.enteredWell).toBeNull()
  })

  it('never softlocks: a strong attractor cannot hold the puck above STOP_THRESHOLD forever', () => {
    // Regression test — an earlier version applied well force unconditionally,
    // which let a strong-enough attractor hold the puck in a friction/force
    // equilibrium above STOP_THRESHOLD forever, so `stopped` never fired.
    const well = { x: cx, y: cy, radius: 80, strength: 4 } // far stronger than real gameplay values
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    let puck = { x: cx + 20, y: cy, vx: 2, vy: 0 }
    let stopped = false
    for (let i = 0; i < 5000 && !stopped; i++) {
      const result = stepPhysics(puck, boardWithWell)
      stopped = result.stopped
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    }
    expect(stopped).toBe(true)
  })
})

describe('applyGravityWellForces — activeAtRest', () => {
  it('a well WITHOUT activeAtRest applies zero force to a puck at rest (unchanged default behavior)', () => {
    const well = { x: cx + 50, y: cy, radius: 80, strength: -5 }
    const result = applyGravityWellForces(cx, cy, 0, 0, [well], 1)
    expect(result.vx).toBe(0)
    expect(result.vy).toBe(0)
  })

  it('a well WITH activeAtRest applies force to a puck at rest', () => {
    const well = { x: cx + 50, y: cy, radius: 80, strength: -5, activeAtRest: true }
    const result = applyGravityWellForces(cx, cy, 0, 0, [well], 1)
    // Repeller to the right of the puck pushes it left (negative vx)
    expect(result.vx).toBeLessThan(0)
  })
})

describe('gravity wells — corner repel never stalls', () => {
  it('a puck seeded at rest inside an activeAtRest repeller ends up substantially further out, not still wedged near its start', () => {
    // Mirrors the 'never softlocks' attractor test above, but for the opposite failure mode: a
    // repeller that's supposed to actively evict a stopped puck (gravityClassic's corner wells)
    // rather than just fail to hold it.
    //
    // NOT asserting the puck clears the well's full nominal radius — the quadratic falloff
    // ((1 - dist/radius) ** 2) means acceleration approaches exactly 0 as dist approaches radius,
    // REGARDLESS of strength, so friction always eventually wins that last stretch and the puck
    // settles somewhere short of the boundary no matter how strong the well is (confirmed
    // empirically: raising this test's own strength from -4 to -10 moved the final rest point from
    // ~81% to ~89% of the radius, not past it). "Never dies in the corner" in practice just means
    // "ends up well clear of the corner itself," which this does check.
    const well = { x: cx, y: cy, radius: 60, strength: -10, activeAtRest: true }
    const boardWithWell: BoardLayout = { ...board, gravityWells: [well] }
    const startDist = 10
    let puck = { x: cx + startDist, y: cy, vx: 0, vy: 0 }
    let stopped = false
    for (let i = 0; i < 5000 && !stopped; i++) {
      const result = stepPhysics(puck, boardWithWell)
      stopped = result.stopped
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    }
    expect(stopped).toBe(true)
    const finalDist = Math.hypot(puck.x - well.x, puck.y - well.y)
    expect(finalDist).toBeGreaterThan(well.radius * 0.75)
    expect(finalDist).toBeGreaterThan(startDist * 3)
  })
})

describe('stepPhysics — rounded corners', () => {
  const roundedBoard: BoardLayout = { ...board, cornerRadius: 40, behindGoalDepth: 60 }
  // Arc center for the top-left corner, per boardCornerQuadrant's own formula.
  const arcCenterX = roundedBoard.x + roundedBoard.cornerRadius
  const arcCenterY = roundedBoard.y - roundedBoard.behindGoalDepth + roundedBoard.cornerRadius

  it('reflects off the curved arc rather than a hard flat corner', () => {
    // Puck approaching the corner diagonally, positioned so it's overlapping the arc boundary.
    const puck = { x: arcCenterX - roundedBoard.cornerRadius + r - 2, y: arcCenterY, vx: -3, vy: -1 }
    const result = stepPhysics(puck, roundedBoard, 1)
    expect(result.bounced).toBe(true)
    // Puck center must stay within (cornerRadius - puckRadius) of the arc center — never pushed
    // past the curve, never left clipping through it.
    const dist = Math.hypot(result.x - arcCenterX, result.y - arcCenterY)
    expect(dist).toBeLessThanOrEqual(roundedBoard.cornerRadius - r + 0.01)
  })

  it('a board with cornerRadius=0 behaves exactly like today’s flat corner (no special-casing leaks through)', () => {
    // Same starting position/velocity as the rounded case above, but on a plain board — should
    // fall through to the ordinary flat top-wall bounce, not the arc collision.
    const flatPuck = { x: board.x + r + 2, y: board.y + r - 2, vx: -3, vy: -1 }
    const result = stepPhysics(flatPuck, board, 1)
    expect(result.bounced).toBe(true)
    expect(result.x).toBeGreaterThanOrEqual(board.x + r - 0.01)
    expect(result.y).toBeGreaterThanOrEqual(board.y + r - 0.01)
  })
})

// ─── computeAimVector ─────────────────────────────────────────────────────────

describe('computeAimVector', () => {
  it('returns zero vector for zero drag', () => {
    const { vx, vy, power } = computeAimVector(0, 0, 160, 22)
    expect(vx).toBe(0)
    expect(vy).toBe(0)
    expect(power).toBe(0)
  })

  it('scales power linearly up to max drag distance', () => {
    const max = 160
    const speed = 22
    const half = computeAimVector(max / 2, 0, max, speed)
    const full = computeAimVector(max, 0, max, speed)
    expect(half.power).toBeCloseTo(0.5)
    expect(full.power).toBeCloseTo(1.0)
    expect(half.vx).toBeCloseTo(speed * 0.5)
    expect(full.vx).toBeCloseTo(speed)
  })

  it('clamps power at 1.0 for drags beyond max distance', () => {
    const { power, vx } = computeAimVector(999, 0, 160, 22)
    expect(power).toBe(1)
    expect(vx).toBeCloseTo(22)
  })

  it('points in the correct direction for diagonal drag', () => {
    const { vx, vy } = computeAimVector(3, 4, 160, 22) // 3-4-5 triangle
    const angle = Math.atan2(vy, vx)
    expect(angle).toBeCloseTo(Math.atan2(4, 3))
  })

  it('produces unit-length direction vector', () => {
    const { vx, vy, power } = computeAimVector(80, 60, 160, 22)
    const speed = Math.sqrt(vx * vx + vy * vy)
    expect(speed).toBeCloseTo(power * 22)
  })
})

// ─── computeTrajectory ────────────────────────────────────────────────────────

describe('computeTrajectory', () => {
  it('returns at least start and end points', () => {
    const pts = computeTrajectory(cx, cy, 10, 0, board, 160, 22)
    expect(pts.length).toBeGreaterThanOrEqual(2)
    expect(pts[0]).toEqual({ x: cx, y: cy })
  })

  it('returns empty array for zero drag', () => {
    const pts = computeTrajectory(cx, cy, 0, 0, board, 160, 22)
    expect(pts).toHaveLength(0)
  })

  it('records a bounce point when puck hits a wall', () => {
    // Shoot hard toward left wall from center
    const pts = computeTrajectory(cx, cy, -160, 0, board, 160, 22)
    // Should have start + at least one bounce + end
    expect(pts.length).toBeGreaterThanOrEqual(3)
  })

  it('stops early when puck enters top goal', () => {
    // Shoot straight up from center of goal
    const goalCX = board.x + board.goalLeft + board.goalWidth / 2 // 160
    const pts = computeTrajectory(goalCX, cy, 0, -160, board, 160, 22)
    const last = pts[pts.length - 1]
    // Final point should be near or above the top wall
    expect(last.y).toBeLessThan(board.y + board.puckRadius * 2)
  })

  it('respects maxBounces limit', () => {
    const pts = computeTrajectory(cx, cy, 80, 1, board, 160, 22, 2)
    // Number of recorded waypoints = start + up to 2 bounces + end = max 4
    expect(pts.length).toBeLessThanOrEqual(4)
  })
})
