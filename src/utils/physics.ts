import { FRICTION_LEVELS, GRAVITY_WELL_MIN_DIST, MAX_SPEED, STOP_THRESHOLD, WALL_RESTITUTION } from '@/constants/game'
import { BoardLayout, GravityWell, PuckState } from '@/types'

export interface PhysicsResult extends PuckState {
  scored: 1 | 2 | null
  stopped: boolean
  bounced: boolean
  enteredWell: 'attract' | 'repel' | null
}

// Localized attractor/repeller: force falls off quadratically to exactly 0 at
// well.radius (bounded, unlike inverse-square, so a dt-clamped frame hitch near
// a strong well can't blow up velocity in one step) and only applies while the
// puck's own momentum is still above STOP_THRESHOLD — without that gate, a
// strong-enough well would hold the puck in a friction/force equilibrium above
// the stop threshold forever, softlocking the game in 'simulating'.
export function applyGravityWellForces(x: number, y: number, vx: number, vy: number, wells: GravityWell[], dt: number): { vx: number; vy: number } {
  if (wells.length === 0 || Math.hypot(vx, vy) < STOP_THRESHOLD) return { vx, vy }

  let ax = 0
  let ay = 0
  for (const well of wells) {
    const dx = well.x - x
    const dy = well.y - y
    const dist = Math.hypot(dx, dy)
    if (dist >= well.radius || dist < GRAVITY_WELL_MIN_DIST) continue
    const falloff = (1 - dist / well.radius) ** 2
    const accel = well.strength * falloff
    ax += (dx / dist) * accel
    ay += (dy / dist) * accel
  }
  if (ax === 0 && ay === 0) return { vx, vy }

  const nextVx = vx + ax * dt
  const nextVy = vy + ay * dt
  const nextSpeed = Math.hypot(nextVx, nextVy)
  if (nextSpeed > MAX_SPEED) {
    const scale = MAX_SPEED / nextSpeed
    return { vx: nextVx * scale, vy: nextVy * scale }
  }
  return { vx: nextVx, vy: nextVy }
}

// Edge-triggered "just crossed into a well's influence radius" — compares the
// puck's distance to each well before vs. after this step, the same way wall/
// obstacle `bounced` is detected inline, so no "was inside last frame" state
// needs to live anywhere else.
function detectWellEntry(x0: number, y0: number, x: number, y: number, wells: GravityWell[]): 'attract' | 'repel' | null {
  for (const well of wells) {
    const distBefore = Math.hypot(well.x - x0, well.y - y0)
    const distAfter = Math.hypot(well.x - x, well.y - y)
    if (distBefore >= well.radius && distAfter < well.radius) {
      return well.strength >= 0 ? 'attract' : 'repel'
    }
  }
  return null
}

export interface TrajectoryPoint {
  x: number
  y: number
}

export function circleVsRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): { hit: boolean; nx: number; ny: number; depth: number } {
  const nearX = Math.max(rx, Math.min(cx, rx + rw))
  const nearY = Math.max(ry, Math.min(cy, ry + rh))
  const dx = cx - nearX
  const dy = cy - nearY
  const distSq = dx * dx + dy * dy
  if (distSq >= r * r) return { hit: false, nx: 0, ny: 0, depth: 0 }
  const dist = Math.sqrt(distSq)
  const nx = dist < 0.001 ? 0 : dx / dist
  const ny = dist < 0.001 ? -1 : dy / dist
  return { hit: true, nx, ny, depth: r - dist }
}

export function stepPhysics(puck: PuckState, board: BoardLayout, dt = 1, friction: number = FRICTION_LEVELS.medium): PhysicsResult {
  let { x, y, vx, vy } = puck
  const x0 = puck.x
  const y0 = puck.y

  const frictionFactor = Math.pow(friction, dt)
  vx *= frictionFactor
  vy *= frictionFactor

  const wellForce = applyGravityWellForces(x, y, vx, vy, board.gravityWells, dt)
  vx = wellForce.vx
  vy = wellForce.vy

  x += vx * dt
  y += vy * dt

  const r = board.puckRadius
  const goalAbsLeft = board.x + board.goalLeft
  const goalAbsRight = board.x + board.goalRight
  let bounced = false

  // A puck merely touching the goal line doesn't count — it has to fully clear it, trailing
  // edge and all, same as real box hockey. So the goal opening simply has no wall (the puck
  // passes through uncollided while lined up with it) and scoring is a separate check below for
  // "has the whole puck now passed the line", not "has any part of it reached the line".
  if (y - r < board.y) {
    const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
    if (!inGoalX) {
      y = board.y + r
      vy = Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }
  }

  if (y + r > board.y + board.height) {
    const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
    if (!inGoalX) {
      y = board.y + board.height - r
      vy = -Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }
  }

  // The puck entering a goal scores for whoever ATTACKS it, not the player whose crease it is —
  // see aiOpponent.ts's planAIShot / faceoff.ts's computeFaceoffKnock for the same convention.
  // Player 1 always sits at the bottom (see board.ts's faceoffZoneCenters), defending the bottom
  // goal and attacking the top one, so a puck exiting off the top scores for player 1.
  if (y + r < board.y) return { x, y, vx, vy, scored: 1, stopped: false, bounced: false, enteredWell: null }
  if (y - r > board.y + board.height) return { x, y, vx, vy, scored: 2, stopped: false, bounced: false, enteredWell: null }

  if (x - r < board.x) {
    x = board.x + r
    vx = Math.abs(vx) * WALL_RESTITUTION
    bounced = true
  }
  if (x + r > board.x + board.width) {
    x = board.x + board.width - r
    vx = -Math.abs(vx) * WALL_RESTITUTION
    bounced = true
  }

  for (const obs of board.obstacles) {
    const col = circleVsRect(x, y, r, obs.x, obs.y, obs.width, obs.height)
    if (col.hit) {
      x += col.nx * col.depth
      y += col.ny * col.depth
      const dot = vx * col.nx + vy * col.ny
      if (dot < 0) {
        vx -= (1 + WALL_RESTITUTION) * dot * col.nx
        vy -= (1 + WALL_RESTITUTION) * dot * col.ny
      }
      bounced = true
    }
  }

  const stopped = Math.abs(vx) < STOP_THRESHOLD && Math.abs(vy) < STOP_THRESHOLD
  const enteredWell = detectWellEntry(x0, y0, x, y, board.gravityWells)
  return { x, y, vx, vy, scored: null, stopped, bounced, enteredWell }
}

export function computeAimVector(dragDx: number, dragDy: number, maxDragPixels: number, maxSpeed: number): { vx: number; vy: number; power: number } {
  const dist = Math.sqrt(dragDx * dragDx + dragDy * dragDy)
  if (dist === 0) return { vx: 0, vy: 0, power: 0 }
  const power = Math.min(dist / maxDragPixels, 1)
  const speed = power * maxSpeed
  return { vx: (dragDx / dist) * speed, vy: (dragDy / dist) * speed, power }
}

// Simulate puck trajectory from current position given a drag direction.
// Returns waypoints: start + each bounce contact + final position.
// Straight segments between waypoints represent the actual path (friction is
// light enough that curvature is negligible between bounces).
export function computeTrajectory(startX: number, startY: number, dragDx: number, dragDy: number, board: BoardLayout, maxDragPixels: number, maxSpeed: number, maxBounces = 5): TrajectoryPoint[] {
  const { vx: initVx, vy: initVy } = computeAimVector(dragDx, dragDy, maxDragPixels, maxSpeed)
  if (initVx === 0 && initVy === 0) return []

  const r = board.puckRadius
  const goalAbsLeft = board.x + board.goalLeft
  const goalAbsRight = board.x + board.goalRight
  const TRAJ_FRICTION = 0.993

  const points: TrajectoryPoint[] = [{ x: startX, y: startY }]
  let x = startX
  let y = startY
  let vx = initVx
  let vy = initVy
  let bounces = 0

  for (let step = 0; step < 800; step++) {
    vx *= TRAJ_FRICTION
    vy *= TRAJ_FRICTION
    const wellForce = applyGravityWellForces(x, y, vx, vy, board.gravityWells, 1)
    vx = wellForce.vx
    vy = wellForce.vy
    if (Math.sqrt(vx * vx + vy * vy) < 0.4) break
    x += vx
    y += vy

    let bounced = false

    // Same "must fully clear the line" rule as stepPhysics: no collision while lined up with
    // the goal, and the preview only ends once the whole puck has passed it.
    if (y - r < board.y) {
      const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
      if (!inGoalX) {
        y = board.y + r
        vy = Math.abs(vy) * WALL_RESTITUTION
        bounced = true
      }
    }
    if (y + r > board.y + board.height) {
      const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
      if (!inGoalX) {
        y = board.y + board.height - r
        vy = -Math.abs(vy) * WALL_RESTITUTION
        bounced = true
      }
    }

    if (y + r < board.y || y - r > board.y + board.height) {
      points.push({ x, y })
      return points
    }
    if (x - r < board.x) {
      x = board.x + r
      vx = Math.abs(vx) * WALL_RESTITUTION
      bounced = true
    }
    if (x + r > board.x + board.width) {
      x = board.x + board.width - r
      vx = -Math.abs(vx) * WALL_RESTITUTION
      bounced = true
    }

    for (const obs of board.obstacles) {
      const col = circleVsRect(x, y, r, obs.x, obs.y, obs.width, obs.height)
      if (col.hit) {
        x += col.nx * col.depth
        y += col.ny * col.depth
        const dot = vx * col.nx + vy * col.ny
        if (dot < 0) {
          vx -= (1 + WALL_RESTITUTION) * dot * col.nx
          vy -= (1 + WALL_RESTITUTION) * dot * col.ny
        }
        bounced = true
      }
    }

    if (bounced) {
      points.push({ x, y })
      bounces++
      if (bounces >= maxBounces) break
    }
  }

  points.push({ x, y })
  return points
}
