import { FRICTION, STOP_THRESHOLD, WALL_RESTITUTION } from '@/constants/game'
import { BoardLayout, PuckState } from '@/types'

export interface PhysicsResult extends PuckState {
  scored: 1 | 2 | null
  stopped: boolean
  bounced: boolean
}

export interface TrajectoryPoint {
  x: number
  y: number
}

export function circleVsRect(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): { hit: boolean; nx: number; ny: number; depth: number } {
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

export function stepPhysics(puck: PuckState, board: BoardLayout, dt = 1): PhysicsResult {
  let { x, y, vx, vy } = puck

  const frictionFactor = Math.pow(FRICTION, dt)
  vx *= frictionFactor
  vy *= frictionFactor

  x += vx * dt
  y += vy * dt

  const r = board.puckRadius
  const goalAbsLeft = board.x + board.goalLeft
  const goalAbsRight = board.x + board.goalRight
  let bounced = false

  if (y - r < board.y) {
    const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
    if (inGoalX) return { x, y, vx, vy, scored: 1, stopped: false, bounced: false }
    y = board.y + r
    vy = Math.abs(vy) * WALL_RESTITUTION
    bounced = true
  }

  if (y + r > board.y + board.height) {
    const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
    if (inGoalX) return { x, y, vx, vy, scored: 2, stopped: false, bounced: false }
    y = board.y + board.height - r
    vy = -Math.abs(vy) * WALL_RESTITUTION
    bounced = true
  }

  if (x - r < board.x) { x = board.x + r; vx = Math.abs(vx) * WALL_RESTITUTION; bounced = true }
  if (x + r > board.x + board.width) { x = board.x + board.width - r; vx = -Math.abs(vx) * WALL_RESTITUTION; bounced = true }

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
  return { x, y, vx, vy, scored: null, stopped, bounced }
}

export function computeAimVector(
  dragDx: number,
  dragDy: number,
  maxDragPixels: number,
  maxSpeed: number
): { vx: number; vy: number; power: number } {
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
export function computeTrajectory(
  startX: number,
  startY: number,
  dragDx: number,
  dragDy: number,
  board: BoardLayout,
  maxDragPixels: number,
  maxSpeed: number,
  maxBounces = 5
): TrajectoryPoint[] {
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
    if (Math.sqrt(vx * vx + vy * vy) < 0.4) break
    x += vx
    y += vy

    let bounced = false

    if (y - r < board.y) {
      const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
      if (inGoalX) { points.push({ x, y }); return points }
      y = board.y + r; vy = Math.abs(vy) * WALL_RESTITUTION; bounced = true
    }
    if (y + r > board.y + board.height) {
      const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
      if (inGoalX) { points.push({ x, y }); return points }
      y = board.y + board.height - r; vy = -Math.abs(vy) * WALL_RESTITUTION; bounced = true
    }
    if (x - r < board.x) { x = board.x + r; vx = Math.abs(vx) * WALL_RESTITUTION; bounced = true }
    if (x + r > board.x + board.width) { x = board.x + board.width - r; vx = -Math.abs(vx) * WALL_RESTITUTION; bounced = true }

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
