import { computeAimVector, computeTrajectory, stepPhysics } from '@/utils/physics'
import { BoardLayout } from '@/types'

// A standard test board with no obstacles
const board: BoardLayout = {
  x: 10,
  y: 10,
  width: 300,
  height: 500,
  wallThickness: 8,
  goalWidth: 80,
  goalLeft: 110,   // (300 - 80) / 2
  goalRight: 190,  // goalLeft + goalWidth
  puckRadius: 18,
  centerX: 160,
  centerY: 260,
  obstacles: []
}

const cx = board.x + board.width / 2    // 160
const cy = board.y + board.height / 2   // 260
const r = board.puckRadius              // 18

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
    const outsideGoalX = board.x + 30  // well left of goalLeft (110)
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
  it('scores P1 (top) when puck fully fits inside top goal opening', () => {
    // Puck center within goal X range, both edges inside [goalAbsLeft, goalAbsRight]
    const goalAbsLeft = board.x + board.goalLeft   // 120
    const goalAbsRight = board.x + board.goalRight  // 200
    const safeX = (goalAbsLeft + goalAbsRight) / 2  // 160 — dead center
    const puck = { x: safeX, y: board.y + r - 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBe(1)
    expect(result.stopped).toBe(false)
  })

  it('scores P2 (bottom) when puck fully fits inside bottom goal opening', () => {
    const goalAbsLeft = board.x + board.goalLeft
    const goalAbsRight = board.x + board.goalRight
    const safeX = (goalAbsLeft + goalAbsRight) / 2
    const puck = { x: safeX, y: board.y + board.height - r + 1, vx: 0, vy: 5 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBe(2)
  })

  it('does NOT score when puck overlaps goal edge (partial entry)', () => {
    // Puck right edge clips into goal but left edge is still outside
    const goalAbsLeft = board.x + board.goalLeft  // 120
    const clipX = goalAbsLeft + 2  // left edge of puck at 102, which is < goalAbsLeft
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
    obstacles: [
      { x: board.x + 8, y: cy - 5, width: board.width * 0.52 - 8, height: 10 }
    ]
  }

  it('pushes puck out of obstacle overlap and reflects velocity', () => {
    // Puck center starts just above the obstacle top so it approaches from above
    const obsTop = cy - 5        // 255
    const obsBottom = obsTop + 10 // 265
    const puck = { x: board.x + 60, y: obsTop - r + 2, vx: 0, vy: 3 }
    const result = stepPhysics(puck, boardWithObs)
    expect(result.bounced).toBe(true)
    // After push-out the puck bottom edge should sit at or above the obstacle top
    expect(result.y + r).toBeLessThanOrEqual(obsTop + 0.5)
    // Velocity should now point away from the surface (upward)
    expect(result.vy).toBeLessThan(0)
    void obsBottom  // referenced for clarity
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
    const { vx, vy } = computeAimVector(3, 4, 160, 22)  // 3-4-5 triangle
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
    const goalCX = board.x + board.goalLeft + board.goalWidth / 2  // 160
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
