import { boardCornerQuadrant } from '@tastic/physics'

import { MAX_SPEED, STICK_BLADE_RADIUS_RATIO, STICK_CARRY, STICK_MIN_HIT_SPEED, STICK_RESTITUTION, STICK_VELOCITY_SCALE } from '@/games/boxhockey/constants/game'
import { BoardLayout } from '@/games/boxhockey/types'

// 'stick' scheme contact physics (see ControlScheme in types/index.ts): the finger is the stick
// blade, a small circle, and a shot is what happens when it runs into the puck. Pure, so the
// reducer (useGameState.ts's AIM_UPDATE/PHYSICS_STEP) and the tests share one implementation.

export interface Point {
  x: number
  y: number
}

export function stickBladeRadius(board: BoardLayout): number {
  return board.puckRadius * STICK_BLADE_RADIUS_RATIO
}

// Keeps the blade on the ice: inside the same walls stepPhysics bounces the puck off (the outer
// boundary, including behind the goals when the rink is on, and the rounded corners when they're
// drawn). Without this a finger could reach past a wall on screen and drive a cornered puck out
// along the boards, which a real stick can't do - digging a puck out of a corner is the point.
// The goal mouths and obstacles aren't walls here: the blade can reach into a goal mouth, and
// passes over the center divider and gauntlet blocks (a real stick reaches over them too).
export function clampBladeToBoard(x: number, y: number, board: BoardLayout): Point {
  const rb = stickBladeRadius(board)
  const top = board.y - board.behindGoalDepth
  const bottom = board.y + board.height + board.behindGoalDepth
  let cx = Math.min(Math.max(x, board.x + rb), board.x + board.width - rb)
  let cy = Math.min(Math.max(y, top + rb), bottom - rb)
  const corner = boardCornerQuadrant(cx, cy, board)
  if (corner) {
    const maxR = Math.max(0, board.cornerRadius - rb)
    const dx = cx - corner.arcCenterX
    const dy = cy - corner.arcCenterY
    const d = Math.hypot(dx, dy)
    if (d > maxR && d > 0) {
      cx = corner.arcCenterX + (dx / d) * maxR
      cy = corner.arcCenterY + (dy / d) * maxR
    }
  }
  return { x: cx, y: cy }
}

// Whether the blade at `blade` is clear of the puck (not touching it). A blade that lands on the
// puck, or is still pressed against it after a nudge, has to leave before it can hit.
export function isBladeClear(blade: Point, puck: Point, board: BoardLayout): boolean {
  return Math.hypot(blade.x - puck.x, blade.y - puck.y) >= board.puckRadius + stickBladeRadius(board)
}

export interface StickContactInput {
  // Where the blade was and is, over the same step the puck moved from puckFrom to puckTo (both
  // already clamped to the board, see clampBladeToBoard).
  bladeFrom: Point
  bladeTo: Point
  // The blade's own velocity (points/sec, the gesture's), and the puck's (points per step).
  bladeVx: number
  bladeVy: number
  puckFrom: Point
  puckTo: Point
  puckVx: number
  puckVy: number
}

// The puck's new velocity if the blade hit it this step, or null for no hit. The test is done in
// the puck's own frame (both bodies move during the step), so a blade held still in a moving
// puck's path is hit by it too. The hit itself is a heavy stick on a light puck: along the contact
// normal (from the blade through the puck's center) the puck leaves at (1 + STICK_RESTITUTION)
// times the blade's approach speed, plus STICK_CARRY of the blade's sideways motion, clamped to
// MAX_SPEED. So a square hit sends the puck straight away from the blade, a glancing one sends it
// mostly sideways and soft, and a blade moving away from the puck (or barely moving into it) is no
// hit at all. The blade has to start the step clear of the puck; the caller tracks that.
export function resolveStickContact(input: StickContactInput, board: BoardLayout): { vx: number; vy: number } | null {
  const R = board.puckRadius + stickBladeRadius(board)
  // Blade relative to the puck's center, at the start and end of the step.
  const q0x = input.bladeFrom.x - input.puckFrom.x
  const q0y = input.bladeFrom.y - input.puckFrom.y
  const q1x = input.bladeTo.x - input.puckTo.x
  const q1y = input.bladeTo.y - input.puckTo.y
  if (Math.hypot(q0x, q0y) < R) return null
  // First t in [0, 1] where |q0 + t (q1 - q0)| = R.
  const dx = q1x - q0x
  const dy = q1y - q0y
  const a = dx * dx + dy * dy
  if (a === 0) return null
  const b = 2 * (q0x * dx + q0y * dy)
  const c = q0x * q0x + q0y * q0y - R * R
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  if (t < 0 || t > 1) return null
  const cx = q0x + t * dx
  const cy = q0y + t * dy
  const len = Math.hypot(cx, cy)
  if (len === 0) return null
  // Contact normal, from the blade into the puck.
  const nx = -cx / len
  const ny = -cy / len
  // Blade velocity relative to the puck, in puck units.
  const ux = input.bladeVx * STICK_VELOCITY_SCALE - input.puckVx
  const uy = input.bladeVy * STICK_VELOCITY_SCALE - input.puckVy
  const approach = ux * nx + uy * ny
  if (approach < STICK_MIN_HIT_SPEED * STICK_VELOCITY_SCALE) return null
  const tx = ux - approach * nx
  const ty = uy - approach * ny
  let vx = input.puckVx + (1 + STICK_RESTITUTION) * approach * nx + STICK_CARRY * tx
  let vy = input.puckVy + (1 + STICK_RESTITUTION) * approach * ny + STICK_CARRY * ty
  const speed = Math.hypot(vx, vy)
  if (speed > MAX_SPEED) {
    vx *= MAX_SPEED / speed
    vy *= MAX_SPEED / speed
  }
  return { vx, vy }
}

// The blade speed (points/sec), straight into the puck, that a square hit on a resting puck needs
// to leave at `speed` (puck units) - the inverse of resolveStickContact for that case, used by the
// CPU (useAIOpponent.ts) to swing for the shot it planned.
export function bladeSpeedForShot(speed: number): number {
  return speed / (1 + STICK_RESTITUTION) / STICK_VELOCITY_SCALE
}

export interface StickSwingPlan {
  // Where the blade touches down, and the unit direction it swings in (which is also the shot
  // direction for a square hit).
  startX: number
  startY: number
  dirX: number
  dirY: number
  // How far the blade travels from the start: through the contact point and a little into the
  // puck, so the swing always crosses it.
  travel: number
  // Blade speed along dir (points/sec).
  bladeSpeed: number
}

// The CPU's swing for a shot it planned (useAIOpponent.ts): straight into the puck along the shot
// direction, from just behind it. A blade can't always get there - a puck against a wall or in a
// corner can't be hit from the wall side - so when the planned direction's contact point is off the
// ice (clampBladeToBoard would move it), this swings in the nearest direction that is reachable,
// the same constraint a human's blade has. The CPU only plans; the hit itself still goes through
// resolveStickContact in the reducer.
export function planStickSwing(puck: Point, fx: number, fy: number, speed: number, board: BoardLayout): StickSwingPlan {
  const R = board.puckRadius + stickBladeRadius(board)
  const base = Math.atan2(fy, fx)
  const reachable = (angle: number) => {
    const contact = { x: puck.x - Math.cos(angle) * R, y: puck.y - Math.sin(angle) * R }
    const clamped = clampBladeToBoard(contact.x, contact.y, board)
    return Math.hypot(clamped.x - contact.x, clamped.y - contact.y) < 0.5
  }
  let angle = base
  for (let k = 0; k <= 18 && !reachable(angle); k++) {
    const step = ((k + 1) * Math.PI) / 18
    if (reachable(base + step)) angle = base + step
    else if (reachable(base - step)) angle = base - step
  }
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)
  // A run-up of up to two contact radii, shortened if a wall is closer than that.
  let runUp = R * 2
  while (runUp > R * 0.3) {
    const sx = puck.x - dirX * (R + runUp)
    const sy = puck.y - dirY * (R + runUp)
    const clamped = clampBladeToBoard(sx, sy, board)
    if (Math.hypot(clamped.x - sx, clamped.y - sy) < 0.5) break
    runUp *= 0.8
  }
  return {
    startX: puck.x - dirX * (R + runUp),
    startY: puck.y - dirY * (R + runUp),
    dirX,
    dirY,
    travel: runUp + R * 0.5,
    bladeSpeed: Math.max(bladeSpeedForShot(speed), STICK_MIN_HIT_SPEED * 1.5)
  }
}
