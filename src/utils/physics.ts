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
// a strong well can't blow up velocity in one step) and, by default, only applies
// while the puck's own momentum is still above STOP_THRESHOLD — without that gate, a
// strong-enough well would hold the puck in a friction/force equilibrium above
// the stop threshold forever, softlocking the game in 'simulating'. A well with
// activeAtRest set bypasses that gate — for wells whose entire purpose is to evict an
// already-stopped puck (e.g. gravityClassic's corner repellers) rather than hold one at
// an equilibrium, so the softlock risk the gate exists for doesn't apply to them.
export function applyGravityWellForces(x: number, y: number, vx: number, vy: number, wells: GravityWell[], dt: number): { vx: number; vy: number } {
  if (wells.length === 0) return { vx, vy }
  const speed = Math.hypot(vx, vy)

  let ax = 0
  let ay = 0
  for (const well of wells) {
    if (!well.activeAtRest && speed < STOP_THRESHOLD) continue
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

// Concave circle-vs-arc collision for a single rounded outer corner (only used by 'rink' boards,
// see BoardLayout.cornerRadius) — unlike circleVsRect's convex "puck outside a rect" check, this
// treats the arc as a boundary the puck's center must stay WITHIN (distance <= cornerRadius -
// puckRadius of the arc's own center), same sense as the flat wall checks it replaces near a
// rounded corner. cx/cy is the puck's position, arcCenterX/Y is the corner's arc center (inset
// cornerRadius from both the true outer boundary edges it joins — see boardCornerQuadrant below).
export function circleVsRoundedCorner(cx: number, cy: number, r: number, arcCenterX: number, arcCenterY: number, cornerRadius: number): { hit: boolean; x: number; y: number; nx: number; ny: number } {
  const dx = cx - arcCenterX
  const dy = cy - arcCenterY
  const dist = Math.hypot(dx, dy)
  const maxDist = cornerRadius - r
  if (dist <= maxDist || dist < 0.001) return { hit: false, x: cx, y: cy, nx: 0, ny: 0 }
  const nx = dx / dist
  const ny = dy / dist
  return { hit: true, x: arcCenterX + nx * maxDist, y: arcCenterY + ny * maxDist, nx, ny }
}

// Which of the 4 outer corners (if any) the puck currently sits within, using the TRUE outer
// boundary (board.y/board.height extended by board.behindGoalDepth — see computeBoardLayout) as
// the anchor rather than the front-line board.y/board.height, so the quadrant's reach lines up
// with where the arc itself is actually drawn. Returns null on every non-'rink' board
// (cornerRadius === 0) and everywhere outside the 4 small corner squares on a 'rink' board — both
// stepPhysics and computeTrajectory call this identically before their own flat wall checks, and
// skip those flat checks for this frame whenever it returns non-null (see each call site).
export function boardCornerQuadrant(x: number, y: number, board: BoardLayout): { arcCenterX: number; arcCenterY: number } | null {
  if (board.cornerRadius <= 0) return null
  const cr = board.cornerRadius
  const outerTop = board.y - board.behindGoalDepth
  const outerBottom = board.y + board.height + board.behindGoalDepth
  const left = board.x
  const right = board.x + board.width
  if (x < left + cr && y < outerTop + cr) return { arcCenterX: left + cr, arcCenterY: outerTop + cr }
  if (x > right - cr && y < outerTop + cr) return { arcCenterX: right - cr, arcCenterY: outerTop + cr }
  if (x < left + cr && y > outerBottom - cr) return { arcCenterX: left + cr, arcCenterY: outerBottom - cr }
  if (x > right - cr && y > outerBottom - cr) return { arcCenterX: right - cr, arcCenterY: outerBottom - cr }
  return null
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
  const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight
  let bounced = false

  // 'rink' only (board.cornerRadius === 0 everywhere else, so this is always null elsewhere): near
  // one of the 4 rounded outer corners, a single concave arc check replaces BOTH the flat
  // top/bottom and left/right wall checks below for this frame — this is also what opens the
  // wraparound path behind the goal, since within a corner's quadrant the flat front-wall check
  // (which would otherwise seal board.y everywhere outside the goal gap) simply doesn't run.
  const corner = boardCornerQuadrant(x, y, board)
  if (corner) {
    const col = circleVsRoundedCorner(x, y, r, corner.arcCenterX, corner.arcCenterY, board.cornerRadius)
    if (col.hit) {
      x = col.x
      y = col.y
      const dot = vx * col.nx + vy * col.ny
      if (dot < 0) {
        vx -= (1 + WALL_RESTITUTION) * dot * col.nx
        vy -= (1 + WALL_RESTITUTION) * dot * col.ny
      }
      bounced = true
    }
  } else {
    // The TRUE outer boundary — board.y/board.height on every non-'rink' board (behindGoalDepth
    // === 0 there, so this is identical to the old board.y-based check), but on 'rink' this sits
    // behindGoalDepth further back. That's the actual fix for "can go behind the goal": earlier
    // this stayed at board.y even outside the corner notch, so the front line was still solid
    // wall across nearly the whole width and 'rink' just shrank the playable board.height for
    // nothing. Real hockey has no wall AT the goal line at all — just open boards, with a small
    // enclosed net at the mouth (see buildObstacles' 'rink' case) — this matches that: outside the
    // goal mouth and the rounded corners, the wall now only exists at the TRUE edge, so a puck can
    // freely sail past board.y anywhere along the boards, not just through the narrow corner arc.
    //
    // A puck merely touching the line doesn't count — it has to fully clear it, trailing edge and
    // all, same as real box hockey. So the goal opening simply has no wall (the puck passes
    // through uncollided while lined up with it) and scoring is a separate check below for "has
    // the whole puck now passed the line", not "has any part of it reached the line".
    const outerTop = board.y - board.behindGoalDepth
    const outerBottom = board.y + board.height + board.behindGoalDepth
    if (y - r < outerTop && !inGoalX) {
      y = outerTop + r
      vy = Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }

    if (y + r > outerBottom && !inGoalX) {
      y = outerBottom - r
      vy = -Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }
  }

  // The puck entering a goal scores for whoever ATTACKS it, not the player whose crease it is —
  // see aiOpponent.ts's planAIShot / faceoff.ts's computeFaceoffKnock for the same convention.
  // Player 1 always sits at the bottom (see board.ts's faceoffZoneCenters), defending the bottom
  // goal and attacking the top one, so a puck exiting off the top scores for player 1. The inGoalX
  // requirement here is load-bearing on 'rink' boards: before rounded corners existed, the only
  // way for the puck to ever get y past board.y at all was through the (already goal-x-range-only)
  // gap above, so this check didn't need its own x-range guard — but a 'rink' puck can now also
  // reach behind the line by wrapping through a corner pocket nowhere near the goal, and without
  // this guard that would incorrectly register as a score.
  if (inGoalX && y + r < board.y) return { x, y, vx, vy, scored: 1, stopped: false, bounced: false, enteredWell: null }
  if (inGoalX && y - r > board.y + board.height) return { x, y, vx, vy, scored: 2, stopped: false, bounced: false, enteredWell: null }

  if (!corner) {
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
    const inGoalX = x - r > goalAbsLeft && x + r < goalAbsRight

    // Mirrors stepPhysics' rounded-corner handling exactly (see boardCornerQuadrant's own doc
    // comment) — null/no-op on every non-'rink' board.
    const corner = boardCornerQuadrant(x, y, board)
    if (corner) {
      const col = circleVsRoundedCorner(x, y, r, corner.arcCenterX, corner.arcCenterY, board.cornerRadius)
      if (col.hit) {
        x = col.x
        y = col.y
        const dot = vx * col.nx + vy * col.ny
        if (dot < 0) {
          vx -= (1 + WALL_RESTITUTION) * dot * col.nx
          vy -= (1 + WALL_RESTITUTION) * dot * col.ny
        }
        bounced = true
      }
    } else {
      // Mirrors stepPhysics' outerTop/outerBottom fix exactly — see its own comment for why this
      // has to be the true outer boundary, not board.y, on 'rink' boards.
      const outerTop = board.y - board.behindGoalDepth
      const outerBottom = board.y + board.height + board.behindGoalDepth
      if (y - r < outerTop && !inGoalX) {
        y = outerTop + r
        vy = Math.abs(vy) * WALL_RESTITUTION
        bounced = true
      }
      if (y + r > outerBottom && !inGoalX) {
        y = outerBottom - r
        vy = -Math.abs(vy) * WALL_RESTITUTION
        bounced = true
      }
    }

    // inGoalX-gated for the same reason stepPhysics' scored check is: on a 'rink' board the puck
    // can also end up past board.y via a corner pocket nowhere near the goal, and the preview
    // shouldn't end there as if it were a score.
    if (inGoalX && (y + r < board.y || y - r > board.y + board.height)) {
      points.push({ x, y })
      return points
    }
    if (!corner && x - r < board.x) {
      x = board.x + r
      vx = Math.abs(vx) * WALL_RESTITUTION
      bounced = true
    }
    if (!corner && x + r > board.x + board.width) {
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
