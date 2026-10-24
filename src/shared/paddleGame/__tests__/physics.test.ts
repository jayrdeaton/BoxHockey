import { MAX_PADDLE_SPEED, MAX_TICK_SUBSTEPS, PADDLE_COLLISION_RESTITUTION, SERVE_ANGLE_MAX_DEG } from '@/shared/paddleGame/constants/game'
import { BoardLayout } from '@/shared/paddleGame/types'
import { applyBrickCollision, applyPaddleCollision, clampPaddleSpeed, computePaddleVelocity, computeServeVelocity, computeTickSubsteps, stepPhysics } from '@/shared/paddleGame/utils/physics'

// A standard test board - isolates wall/edge-scoring behavior from paddle-collision behavior, same
// discipline AirHockey's own physics.test.ts fixture uses. Landscape-shaped (width > height, unlike
// AirHockey's portrait fixture): Pong's local space always has the paddles at local-left/-right
// (the long axis) and the walls at local-top/-bottom (the short axis).
const board: BoardLayout = {
  x: 10,
  y: 10,
  width: 500,
  height: 300,
  wallThickness: 8,
  ballRadius: 8,
  paddleWidth: 10,
  paddleHeight: 60,
  paddleX: { 1: 30, 2: 480 },
  paddleMinY: 40,
  paddleMaxY: 280,
  centerX: 260,
  centerY: 160
}

const cx = board.x + board.width / 2 // 260
const cy = board.y + board.height / 2 // 160
const r = board.ballRadius // 8

// Returns a value that lets a caller supply exactly N deterministic random() draws in order,
// repeating the final value forever after - needed because computeServeVelocity calls random()
// up to twice per invocation (once for angle, once for direction when towardPlayer is null), so a
// single constant-returning mock can't isolate one draw's effect from the other's.
function sequence(...values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('stepPhysics - wall bounces', () => {
  it('bounces off the top wall and reverses vy', () => {
    const ball = { x: cx, y: board.y + r + 1, vx: 0, vy: -5, speed: 5 }
    const result = stepPhysics(ball, board)
    expect(result.y).toBeGreaterThanOrEqual(board.y + r)
    expect(result.vy).toBeGreaterThan(0)
    expect(result.bounced).toBe(true)
    expect(result.scored).toBeNull()
  })

  it('bounces off the bottom wall and reverses vy', () => {
    const ball = { x: cx, y: board.y + board.height - r - 1, vx: 0, vy: 5, speed: 5 }
    const result = stepPhysics(ball, board)
    expect(result.y).toBeLessThanOrEqual(board.y + board.height - r)
    expect(result.vy).toBeLessThan(0)
    expect(result.bounced).toBe(true)
  })

  it('is lossless - vy magnitude is exactly preserved and vx is untouched (WALL_RESTITUTION = 1, unlike AirHockey)', () => {
    const ball = { x: cx, y: board.y + r + 1, vx: 3, vy: -7, speed: Math.hypot(3, 7) }
    const result = stepPhysics(ball, board)
    expect(Math.abs(result.vy)).toBeCloseTo(7, 5)
    expect(result.vx).toBeCloseTo(3, 5)
  })

  it('does not bounce when the ball is not near a wall', () => {
    const ball = { x: cx, y: cy, vx: 2, vy: 2, speed: Math.hypot(2, 2) }
    const result = stepPhysics(ball, board)
    expect(result.bounced).toBe(false)
    expect(result.scored).toBeNull()
  })
})

describe('stepPhysics - edge scoring', () => {
  it("scores P2 once the ball has fully cleared player 1's edge", () => {
    const ball = { x: board.x + r - 5, y: cy, vx: -50, vy: 0, speed: 50 }
    const result = stepPhysics(ball, board)
    expect(result.scored).toBe(2)
  })

  it("scores P1 once the ball has fully cleared player 2's edge", () => {
    const ball = { x: board.x + board.width - r + 5, y: cy, vx: 50, vy: 0, speed: 50 }
    const result = stepPhysics(ball, board)
    expect(result.scored).toBe(1)
  })

  it('does NOT score merely touching the edge - the ball has to clear it entirely, center included', () => {
    const ball = { x: board.x - r + 1, y: cy, vx: 0, vy: 0, speed: 0 }
    const result = stepPhysics(ball, board)
    expect(result.scored).toBeNull()
  })

  it('does not score when the ball stays well within the board mid-court', () => {
    const ball = { x: cx, y: cy, vx: 1, vy: 0, speed: 1 }
    const result = stepPhysics(ball, board)
    expect(result.scored).toBeNull()
  })
})

describe('stepPhysics - bounce jitter', () => {
  it('jitters a wall bounce only when random is provided - classic Pong stays perfectly deterministic by default', () => {
    const ball = { x: cx, y: board.y + r + 1, vx: 3, vy: -7, speed: Math.hypot(3, 7) }
    const withoutJitter = stepPhysics(ball, board)
    const withJitter = stepPhysics(ball, board, 1, false, () => 0.9)
    expect(withoutJitter.vx).toBeCloseTo(3, 5) // no random passed -> vx untouched, exactly as every existing caller already expects
    expect(withJitter.vx).not.toBeCloseTo(3, 5) // random passed -> the wall bounce got jittered too
    expect(Math.hypot(withJitter.vx, withJitter.vy)).toBeCloseTo(Math.hypot(3, 7), 5) // magnitude still preserved - a direction-only nudge
  })

  it('different random draws produce different jittered angles off the same wall bounce', () => {
    const ball = { x: cx, y: board.y + r + 1, vx: 3, vy: -7, speed: Math.hypot(3, 7) }
    const a = stepPhysics(ball, board, 1, false, () => 0.9)
    const b = stepPhysics(ball, board, 1, false, () => 0.1)
    expect(a.vx).not.toBeCloseTo(b.vx, 5)
  })

  it('never jitters when the ball did not bounce at all this step', () => {
    const ball = { x: cx, y: cy, vx: 2, vy: 2, speed: Math.hypot(2, 2) }
    const result = stepPhysics(ball, board, 1, false, () => 0.9)
    expect(result.vx).toBeCloseTo(2, 5)
    expect(result.vy).toBeCloseTo(2, 5)
  })
})

describe('stepPhysics - solo far wall (farEdgeIsWall)', () => {
  it('bounces off the far edge instead of scoring when true - solo has no second paddle to concede a point to', () => {
    const ball = { x: board.x + board.width - r + 5, y: cy, vx: 50, vy: 0, speed: 50 }
    const result = stepPhysics(ball, board, 1, true)
    expect(result.scored).toBeNull()
    expect(result.bounced).toBe(true)
    expect(result.vx).toBeLessThan(0) // reflected back leftward, into the court
    expect(result.x).toBeLessThanOrEqual(board.x + board.width - r)
  })

  it('still scores P2 off the near (P1) edge when true - only the far edge changes', () => {
    const ball = { x: board.x + r - 5, y: cy, vx: -50, vy: 0, speed: 50 }
    const result = stepPhysics(ball, board, 1, true)
    expect(result.scored).toBe(2)
  })

  it('defaults to false - every existing caller/test keeps scoring at the far edge unchanged', () => {
    const ball = { x: board.x + board.width - r + 5, y: cy, vx: 50, vy: 0, speed: 50 }
    const result = stepPhysics(ball, board)
    expect(result.scored).toBe(1)
  })
})

describe('applyPaddleCollision', () => {
  const halfW = board.paddleWidth / 2
  const halfH = board.paddleHeight / 2
  const combined = r + halfW
  const speedIncrement = 2
  const maxSpeed = 30

  it('is a no-op when the ball and paddle are not overlapping', () => {
    const ball = { x: 0, y: 0, vx: 3, vy: 3, speed: Math.hypot(3, 3) }
    const paddle = { x: 500, y: 500, vx: 0, vy: 0 }
    const result = applyPaddleCollision(ball, paddle, board, speedIncrement, maxSpeed)
    expect(result).toEqual(ball)
  })

  it('a stationary paddle produces an ordinary elastic reflection along the contact normal, ratcheted to speed + speedIncrement', () => {
    // Ball approaching a stationary paddle head-on from the right (paddle's right face).
    const ball = { x: combined - 2, y: 0, vx: -5, vy: 0, speed: 5 }
    const paddle = { x: 0, y: 0, vx: 0, vy: 0 }
    const result = applyPaddleCollision(ball, paddle, board, speedIncrement, maxSpeed)
    expect(result.vx).toBeGreaterThan(0) // reflected back toward +x, away from the paddle
    expect(result.vy).toBeCloseTo(0, 5) // dead-center contact - no steer to apply
    expect(result.speed).toBeCloseTo(5 + speedIncrement, 5)
    expect(Math.hypot(result.vx, result.vy)).toBeCloseTo(5 + speedIncrement, 5)
  })

  it('a moving paddle launches a resting ball - direction reflects the contact, but magnitude is set by the ratchet, not by the paddle speed', () => {
    const ball = { x: combined - 2, y: 0, vx: 0, vy: 0, speed: 0 }
    const paddle = { x: 0, y: 0, vx: 8, vy: 0 }
    const result = applyPaddleCollision(ball, paddle, board, speedIncrement, maxSpeed)
    expect(result.vx).toBeGreaterThan(0) // launched, not left at rest
    expect(result.speed).toBeCloseTo(speedIncrement, 5) // 0 + speedIncrement - the ratchet's own magnitude, not the paddle's velocity
  })

  it('a faster paddle and a slower paddle both ratchet to the IDENTICAL resulting speed - unlike AirHockey, where a faster mallet hits harder', () => {
    // Pong's ball speed is a designed ratchet (see BALL_SPEED_TIERS), not a direct physical
    // consequence of the paddle's own velocity like AirHockey's puck - post-collision speed comes
    // from ball.speed + speedIncrement regardless of how fast the paddle that struck it was moving.
    const ball = { x: combined - 2, y: 0, vx: 0, vy: 0, speed: 0 }
    const slowPaddle = { x: 0, y: 0, vx: 8, vy: 0 }
    const fastPaddle = { x: 0, y: 0, vx: 20, vy: 0 }
    const slowResult = applyPaddleCollision(ball, slowPaddle, board, speedIncrement, maxSpeed)
    const fastResult = applyPaddleCollision(ball, fastPaddle, board, speedIncrement, maxSpeed)
    expect(slowResult.speed).toBeCloseTo(fastResult.speed, 5)
  })

  it("never mutates the paddle's own position or velocity - the paddle stays 100% finger/AI-controlled", () => {
    const ball = { x: combined - 2, y: 0, vx: -3, vy: 1, speed: 4 }
    const paddle = { x: 0, y: 0, vx: 12, vy: -4 }
    const snapshot = { ...paddle }
    applyPaddleCollision(ball, paddle, board, speedIncrement, maxSpeed)
    expect(paddle).toEqual(snapshot)
  })

  it('ratchets speed by speedIncrement per hit and caps at maxSpeed across repeated hits', () => {
    const paddle = { x: 0, y: 0, vx: 0, vy: 0 }
    let ball = { x: combined - 2, y: 0, vx: -5, vy: 0, speed: 5 }
    ball = applyPaddleCollision(ball, paddle, board, 3, 12)
    expect(ball.speed).toBeCloseTo(8, 5) // 5 + 3
    ball = { ...ball, x: combined - 2, vx: -ball.speed, vy: 0 } // re-approach for a second strike
    ball = applyPaddleCollision(ball, paddle, board, 3, 12)
    expect(ball.speed).toBeCloseTo(11, 5) // 8 + 3
    ball = { ...ball, x: combined - 2, vx: -ball.speed, vy: 0 }
    ball = applyPaddleCollision(ball, paddle, board, 3, 12)
    expect(ball.speed).toBeCloseTo(12, 5) // capped at maxSpeed (12), not 14
  })

  it("contact-offset steering biases vy toward the strike position along the paddle's own length", () => {
    const paddle = { x: 0, y: 0, vx: 0, vy: 0 }
    const struckNearTop = { x: combined - 2, y: -halfH * 0.6, vx: -5, vy: 0, speed: 5 }
    const struckNearBottom = { x: combined - 2, y: halfH * 0.6, vx: -5, vy: 0, speed: 5 }
    const resultTop = applyPaddleCollision(struckNearTop, paddle, board, speedIncrement, maxSpeed)
    const resultBottom = applyPaddleCollision(struckNearBottom, paddle, board, speedIncrement, maxSpeed)
    expect(resultTop.vy).toBeLessThan(0) // steered further toward the top
    expect(resultBottom.vy).toBeGreaterThan(0) // steered further toward the bottom
  })

  it('a ball geometrically overlapping the paddle but already separating still gets pushed out and ratcheted - col.hit is a pure overlap test, not an approach-direction test', () => {
    const ball = { x: combined - 2, y: 0, vx: 5, vy: 0, speed: 5 } // already moving further in +x, away from the paddle at origin
    const paddle = { x: 0, y: 0, vx: 0, vy: 0 }
    const result = applyPaddleCollision(ball, paddle, board, speedIncrement, maxSpeed)
    // reflectOffNormal's own internal dot >= 0 check leaves an already-separating RELATIVE
    // velocity untouched - but applyPaddleCollision still re-normalizes that (direction-preserved)
    // result onto the ratcheted magnitude regardless, since col.hit alone (a pure geometric
    // overlap test) is what gates the ratchet here, not whether the ball was approaching or
    // separating. Direction stays +x (unchanged); only the MAGNITUDE moves to speed + increment.
    expect(result.vx).toBeGreaterThan(0)
    expect(result.speed).toBeCloseTo(5 + speedIncrement, 5)
    expect(Math.hypot(result.vx, result.vy)).toBeCloseTo(5 + speedIncrement, 5)
  })
})

describe('applyBrickCollision', () => {
  it('is a no-op when the ball overlaps no brick', () => {
    const brick = { x: 0, y: 0, width: 10, height: 10, destroyed: false }
    const ball = { x: 500, y: 500, vx: 3, vy: 3, speed: Math.hypot(3, 3) }
    const result = applyBrickCollision(ball, [brick], board)
    expect(result.ball).toEqual(ball)
    expect(result.hitIndex).toBeNull()
  })

  it("reflects off the brick's face, reports the hit index, and is lossless - no ratchet, unlike a paddle hit", () => {
    const brick = { x: cx, y: cy - 5, width: 10, height: 10, destroyed: false }
    const ball = { x: cx - 6, y: cy, vx: 5, vy: 0, speed: 5 } // overlapping the brick's left face
    // random: () => 0.5 -> exactly zero jitter (see the jitter tests below), so the reflection is
    // pure geometry here, matching this test's own precise assertions.
    const result = applyBrickCollision(ball, [brick], board, () => 0.5)
    expect(result.hitIndex).toBe(0)
    expect(result.ball.vx).toBeLessThan(0) // bounced back away from the brick
    expect(result.ball.speed).toBeCloseTo(5, 5)
    expect(Math.hypot(result.ball.vx, result.ball.vy)).toBeCloseTo(5, 5)
  })

  it('skips a destroyed brick entirely, even when geometrically overlapping', () => {
    const brick = { x: cx, y: cy - 5, width: 10, height: 10, destroyed: true }
    const ball = { x: cx - 6, y: cy, vx: 5, vy: 0, speed: 5 }
    const result = applyBrickCollision(ball, [brick], board)
    expect(result.ball).toEqual(ball)
    expect(result.hitIndex).toBeNull()
  })

  it('resolves only the first overlapping brick in the array, not every one in a single call', () => {
    const overlapping = { x: cx, y: cy - 5, width: 10, height: 10, destroyed: false }
    const ball = { x: cx - 6, y: cy, vx: 5, vy: 0, speed: 5 }
    const result = applyBrickCollision(ball, [overlapping, overlapping], board, () => 0.5)
    expect(result.hitIndex).toBe(0)
  })

  it('applies a small random angle jitter per hit - the anti-stall device: a perfectly elastic, unsteered bounce could otherwise settle into a stable periodic orbit inside a partially-cleared pocket and never make further progress', () => {
    const brick = { x: cx, y: cy - 5, width: 10, height: 10, destroyed: false }
    const ball = { x: cx - 6, y: cy, vx: 5, vy: 0, speed: 5 }
    const a = applyBrickCollision(ball, [brick], board, () => 0.9)
    const b = applyBrickCollision(ball, [brick], board, () => 0.1)
    expect(a.ball.vy).not.toBeCloseTo(b.ball.vy, 5) // different draws -> measurably different angles
    // Jitter rotates the vector - it never changes its magnitude, so speed stays exact either way.
    expect(Math.hypot(a.ball.vx, a.ball.vy)).toBeCloseTo(5, 5)
    expect(Math.hypot(b.ball.vx, b.ball.vy)).toBeCloseTo(5, 5)
  })

  it('random defaults to Math.random when omitted, so live gameplay is naturally randomized without a caller having to opt in', () => {
    const brick = { x: cx, y: cy - 5, width: 10, height: 10, destroyed: false }
    const ball = { x: cx - 6, y: cy, vx: 5, vy: 0, speed: 5 }
    const result = applyBrickCollision(ball, [brick], board)
    expect(Math.hypot(result.ball.vx, result.ball.vy)).toBeCloseTo(5, 5)
  })
})

describe('computeServeVelocity', () => {
  it('always produces the exact baseSpeed magnitude, regardless of angle', () => {
    const v = computeServeVelocity(10, null, sequence(0.9, 0.5))
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(10, 5)
  })

  it('constrains the angle to within ±SERVE_ANGLE_MAX_DEG of the horizontal', () => {
    const v = computeServeVelocity(10, null, sequence(1, 0.5)) // random()=1 on the angle draw -> the max possible angle
    const angleDeg = (Math.abs(Math.atan2(v.vy, Math.abs(v.vx))) * 180) / Math.PI
    expect(angleDeg).toBeLessThanOrEqual(SERVE_ANGLE_MAX_DEG + 0.001)
    expect(angleDeg).toBeCloseTo(SERVE_ANGLE_MAX_DEG, 3)
  })

  it('serves toward player 2 (positive vx) when towardPlayer is 2', () => {
    const v = computeServeVelocity(10, 2, sequence(0.5))
    expect(v.vx).toBeGreaterThan(0)
  })

  it('serves toward player 1 (negative vx) when towardPlayer is 1', () => {
    const v = computeServeVelocity(10, 1, sequence(0.5))
    expect(v.vx).toBeLessThan(0)
  })

  it('is a coin flip in direction when towardPlayer is null - the FIRST serve of a match', () => {
    // goingRight = (2nd draw) < 0.5 - so a LOW 2nd draw serves right (toward P2), a HIGH one left.
    const towardP2 = computeServeVelocity(10, null, sequence(0.5, 0.1))
    const towardP1 = computeServeVelocity(10, null, sequence(0.5, 0.9))
    expect(towardP1.vx).toBeLessThan(0)
    expect(towardP2.vx).toBeGreaterThan(0)
  })
})

describe('computeTickSubsteps', () => {
  const paddleWidth = 10 // safeDisplacement = paddleWidth * PADDLE_TUNNEL_SAFETY_RATIO(0.4) = 4

  it('returns 1 substep when the per-tick displacement stays within the safety threshold', () => {
    expect(computeTickSubsteps(3, 1, paddleWidth)).toBe(1)
  })

  it('returns more than 1 once displacement exceeds the safety threshold', () => {
    expect(computeTickSubsteps(10, 1, paddleWidth)).toBeGreaterThan(1)
  })

  it('caps at MAX_TICK_SUBSTEPS regardless of how large the displacement gets', () => {
    expect(computeTickSubsteps(10000, 2.5, paddleWidth)).toBe(MAX_TICK_SUBSTEPS)
  })
})

// Copied VERBATIM from AirHockey's own utils/physics.ts - same test bodies, since the functions
// themselves are unchanged.
describe('computePaddleVelocity', () => {
  it('derives velocity from the position delta over dt', () => {
    const v = computePaddleVelocity(0, 0, 10, 0, 1)
    expect(v.vx).toBeCloseTo(10, 5)
    expect(v.vy).toBeCloseTo(0, 5)
  })

  it('returns zero velocity for a non-positive dt rather than dividing by zero', () => {
    expect(computePaddleVelocity(0, 0, 10, 10, 0)).toEqual({ vx: 0, vy: 0 })
  })
})

describe('clampPaddleSpeed', () => {
  it('leaves a slow velocity untouched', () => {
    expect(clampPaddleSpeed(3, 4)).toEqual({ vx: 3, vy: 4 })
  })

  it('scales a too-fast velocity down to MAX_PADDLE_SPEED, preserving direction', () => {
    const clamped = clampPaddleSpeed(300, 400) // speed 500, well over the cap
    const speed = Math.hypot(clamped.vx, clamped.vy)
    expect(speed).toBeCloseTo(MAX_PADDLE_SPEED, 5)
    expect(clamped.vx / clamped.vy).toBeCloseTo(300 / 400, 5)
  })
})

// Sanity check that PADDLE_COLLISION_RESTITUTION is genuinely 1 (lossless), the same way
// stepPhysics's wall bounces are - otherwise the ratchet's fixed-increment model and a
// restitution-driven decay would silently fight each other on every strike.
it('PADDLE_COLLISION_RESTITUTION is lossless', () => {
  expect(PADDLE_COLLISION_RESTITUTION).toBe(1)
})
