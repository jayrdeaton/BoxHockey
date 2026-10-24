import { MAX_PADDLE_SPEED, PADDLE_COLLISION_RESTITUTION } from '@/games/airhockey/constants/game'
import { BoardLayout } from '@/games/airhockey/types'
import { applyPaddleCollision, clampPaddleSpeed, computePaddleVelocity, stepPhysics } from '@/games/airhockey/utils/physics'

// A standard test board with no goalposts/obstacles - isolates wall/goal-line behavior from
// goalpost deflection, same discipline BoxHockey's own physics.test.ts fixture uses.
const board: BoardLayout = {
  x: 10,
  y: 10,
  width: 300,
  height: 500,
  goalAxis: 'vertical',
  wallThickness: 8,
  goalWidth: 80,
  goalStart: 110, // (300 - 80) / 2
  goalEnd: 190, // goalStart + goalWidth
  puckRadius: 18,
  paddleRadius: 24,
  centerX: 160,
  centerY: 260,
  obstacles: [],
  goalPosts: [],
  cornerRadius: 0,
  behindGoalDepth: 0
}

const cx = board.x + board.width / 2 // 160
const cy = board.y + board.height / 2 // 260
const r = board.puckRadius // 18

describe('stepPhysics - wall bounces', () => {
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

  it('bounces off top wall outside the goal and reverses vy', () => {
    const outsideGoalX = board.x + 30 // well left of goalStart (110)
    const puck = { x: outsideGoalX, y: board.y + r + 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    expect(result.y).toBeGreaterThanOrEqual(board.y + r)
    expect(result.vy).toBeGreaterThan(0)
    expect(result.bounced).toBe(true)
    expect(result.scored).toBeNull()
  })

  it('bounces off bottom wall outside the goal and reverses vy', () => {
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

describe('stepPhysics - goal detection', () => {
  const goalAbsLeft = board.x + board.goalStart // 120
  const goalAbsRight = board.x + board.goalEnd // 200
  const safeX = (goalAbsLeft + goalAbsRight) / 2 // 160 - dead center

  it('scores P1 once the puck has fully cleared the top goal line (player 2 defends top)', () => {
    const puck = { x: safeX, y: board.y + 5, vx: 0, vy: -50 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBe(1)
    expect(result.stopped).toBe(false)
  })

  it('scores P2 once the puck has fully cleared the bottom goal line (player 1 defends bottom)', () => {
    const puck = { x: safeX, y: board.y + board.height - 5, vx: 0, vy: 50 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBe(2)
  })

  it('does NOT score merely touching the goal line - has to clear it entirely', () => {
    const puck = { x: safeX, y: board.y + r - 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBeNull()
    expect(result.bounced).toBe(false)
  })

  it('bounces off the flat wall when the puck center is still outside the goal opening', () => {
    const outsideX = goalAbsLeft - 10
    const puck = { x: outsideX, y: board.y + r - 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board)
    expect(result.scored).toBeNull()
    expect(result.bounced).toBe(true)
  })
})

// A rink pocket variant of the base fixture - the plain `board` above (cornerRadius/
// behindGoalDepth both 0) has no pocket for a puck to end up behind, so the one-way door never
// has anything to gate; AirHockey's own boards always carry a real pocket (see computeBoardLayout's
// "unconditional" cornerRadius/behindGoalDepth), so this is the representative shape.
describe('stepPhysics - rink pocket door', () => {
  const rinkBoard: BoardLayout = { ...board, cornerRadius: 40, behindGoalDepth: 60 }

  it("flags goalDoorHit: 'top' for a puck already behind the line bouncing off the door on its way back out", () => {
    const puck = { x: cx, y: board.y - r - 1, vx: 0, vy: 5 }
    const result = stepPhysics(puck, rinkBoard)
    expect(result.bounced).toBe(true)
    expect(result.goalDoorHit).toBe('top')
  })

  it("flags goalDoorHit: 'bottom' for a puck already behind the line bouncing off the door on its way back out", () => {
    const puck = { x: cx, y: board.y + board.height + r + 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, rinkBoard)
    expect(result.bounced).toBe(true)
    expect(result.goalDoorHit).toBe('bottom')
  })

  it('does NOT flag goalDoorHit - and does not even bounce - approaching the front line outside the goal x-range', () => {
    // Clear of both the top-corner quadrant (x < rinkBoard.x + cornerRadius) and the goal opening
    // (goalAbsLeft..goalAbsRight) - the flat front wall only exists across the goal opening itself
    // now (see stepPhysicsOnce's own comment); outside it, the true boundary sits all the way out
    // at outerTop (board.y - behindGoalDepth), so this puck sails straight past the front line
    // toward the wider pocket wraparound with nothing stopping it at all.
    const outsideGoalX = rinkBoard.x + rinkBoard.cornerRadius + 30
    const puck = { x: outsideGoalX, y: board.y - r - 1, vx: 0, vy: 5 }
    const result = stepPhysics(puck, rinkBoard)
    expect(result.bounced).toBe(false)
    expect(result.goalDoorHit).toBeNull()
  })

  it('does not decay a puck already behind the line, off to the side of the goal mouth - friction is what would otherwise strand it there with no paddle able to follow', () => {
    // Same off-to-the-side spot as the wraparound test above - outside the goal x-range, so
    // neither the score check nor the one-way door ever see it - but this time already resting
    // behind the front line rather than just crossing it, and moving purely sideways (parallel to
    // the line) so nothing else this step (wall/corner/post) touches its velocity either. A strong
    // friction coefficient makes any decay obvious if the exemption weren't working.
    const outsideGoalX = rinkBoard.x + rinkBoard.cornerRadius + 30
    const puck = { x: outsideGoalX, y: board.y - r - 5, vx: 3, vy: 0 }
    const result = stepPhysics(puck, rinkBoard, 1, 0.5)
    expect(result.bounced).toBe(false)
    expect(result.vx).toBeCloseTo(3, 5)
  })

  it('does decay the same puck normally once it is back in front of the line', () => {
    const outsideGoalX = rinkBoard.x + rinkBoard.cornerRadius + 30
    const puck = { x: outsideGoalX, y: board.y + r + 5, vx: 3, vy: 0 }
    const result = stepPhysics(puck, rinkBoard, 1, 0.5)
    expect(result.vx).toBeLessThan(3)
  })

  // Regression: with a pocket, the true outer boundary (outerTop/outerBottom) is solid across the
  // full width, goal mouth and post strips included. Behind-the-line pucks skip friction, so one
  // that got past this wall would never slow down or come back. Containment only: with no sideways
  // speed this puck slows to a stop in the pocket, and useGameState's TICK re-serves it (tested in
  // useGameState.test.ts).
  const outerTop = rinkBoard.y - rinkBoard.behindGoalDepth
  const outerBottom = rinkBoard.y + rinkBoard.height + rinkBoard.behindGoalDepth

  it.each([
    ['top', board.y - r - 1, 5],
    ['bottom', board.y + board.height + r + 1, -5]
  ])('keeps a puck that bounced off the %s door inside the pocket on every following step', (_side, y, vy) => {
    let puck = { x: cx, y, vx: 0, vy }
    for (let i = 0; i < 300; i++) {
      const result = stepPhysics(puck, rinkBoard)
      expect(result.scored).toBeNull()
      expect(result.y - r).toBeGreaterThanOrEqual(outerTop - 0.001)
      expect(result.y + r).toBeLessThanOrEqual(outerBottom + 0.001)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    }
  })

  it('keeps every angled shot inside the rink, including shots that pass beside a goalpost into the pocket', () => {
    const postRadius = r * 0.18
    const postedRinkBoard: BoardLayout = {
      ...rinkBoard,
      goalPosts: [
        { x: board.x + board.goalStart, y: board.y, radius: postRadius, player: 2 },
        { x: board.x + board.goalEnd, y: board.y, radius: postRadius, player: 2 },
        { x: board.x + board.goalStart, y: board.y + board.height, radius: postRadius, player: 1 },
        { x: board.x + board.goalEnd, y: board.y + board.height, radius: postRadius, player: 1 }
      ]
    }
    let escaped = 0
    for (let x = board.x + r; x <= board.x + board.width - r; x += 2) {
      for (const vx of [-4, -2, 0, 2, 4]) {
        for (const vy of [-9, 9]) {
          let puck = { x, y: vy < 0 ? board.y + board.height * 0.2 : board.y + board.height * 0.8, vx, vy }
          for (let i = 0; i < 300; i++) {
            const result = stepPhysics(puck, postedRinkBoard)
            if (result.scored !== null) break
            if (result.y - r < outerTop - 0.001 || result.y + r > outerBottom + 0.001) {
              escaped++
              break
            }
            puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
          }
        }
      }
    }
    expect(escaped).toBe(0)
  })
})

describe('applyPaddleCollision', () => {
  const puckRadius = 18
  const paddleRadius = 24

  it('is a no-op when the puck and paddle are not overlapping', () => {
    const puck = { x: 0, y: 0, vx: 3, vy: 3 }
    const paddle = { x: 500, y: 500, vx: 0, vy: 0 }
    const result = applyPaddleCollision(puck, paddle, paddle, puckRadius, paddleRadius)
    expect(result).toEqual(puck)
  })

  it('a stationary paddle produces an ordinary elastic bounce along the contact normal', () => {
    // Puck approaching a stationary paddle head-on from the left.
    const combined = puckRadius + paddleRadius
    const puck = { x: -combined + 2, y: 0, vx: 5, vy: 0 }
    const paddle = { x: 0, y: 0, vx: 0, vy: 0 }
    const result = applyPaddleCollision(puck, paddle, paddle, puckRadius, paddleRadius)
    // Normal points from paddle to puck, i.e. roughly (-1, 0) - puck's vx should reverse sign and
    // scale by restitution, tangential vy stays 0.
    expect(result.vx).toBeLessThan(0)
    expect(Math.abs(result.vx)).toBeCloseTo(5 * PADDLE_COLLISION_RESTITUTION, 5)
    expect(result.vy).toBeCloseTo(0, 5)
  })

  it('a moving paddle imparts its own velocity onto the puck - a resting puck gets launched by a fast paddle', () => {
    const combined = puckRadius + paddleRadius
    const puck = { x: combined - 2, y: 0, vx: 0, vy: 0 }
    const slowPaddle = { x: 0, y: 0, vx: 8, vy: 0 }
    const fastPaddle = { x: 0, y: 0, vx: 20, vy: 0 }
    const slowResult = applyPaddleCollision(puck, slowPaddle, slowPaddle, puckRadius, paddleRadius)
    const fastResult = applyPaddleCollision(puck, fastPaddle, fastPaddle, puckRadius, paddleRadius)
    expect(slowResult.vx).toBeGreaterThan(0) // launched, not left at rest
    expect(fastResult.vx).toBeGreaterThan(slowResult.vx) // a faster mallet hits harder
  })

  it("never mutates the paddle's own position or velocity - the paddle stays 100% finger-controlled", () => {
    const combined = puckRadius + paddleRadius
    const puck = { x: combined - 2, y: 0, vx: -3, vy: 1 }
    const paddle = { x: 0, y: 0, vx: 12, vy: -4 }
    const paddleSnapshot = { ...paddle }
    applyPaddleCollision(puck, paddle, paddle, puckRadius, paddleRadius)
    expect(paddle).toEqual(paddleSnapshot)
  })

  it('a puck already separating from the paddle (moving apart) is left unaffected on the normal axis', () => {
    // Puck overlapping the paddle but already moving directly away from it.
    const combined = puckRadius + paddleRadius
    const puck = { x: combined - 2, y: 0, vx: 5, vy: 0 } // moving further in +x, away from paddle at origin
    const paddle = { x: 0, y: 0, vx: 0, vy: 0 }
    const result = applyPaddleCollision(puck, paddle, paddle, puckRadius, paddleRadius)
    expect(result.vx).toBeCloseTo(5, 5)
    expect(result.vy).toBeCloseTo(0, 5)
  })

  it('a fast swipe clean past the puck (neither endpoint overlapping) still registers a strike', () => {
    // Paddle starts well clear on one side of the puck and ends well clear on the OTHER side,
    // all within a single tick - a fast swipe, or a dropped frame's larger dt. Neither the start
    // nor the end position overlaps the puck, so only a swept check along the path actually
    // traveled catches this; a plain endpoint-only check would have missed it entirely (the
    // tunneling bug this test guards against).
    const combined = puckRadius + paddleRadius
    const puck = { x: 0, y: 0, vx: 0, vy: 0 }
    const prevPaddle = { x: -combined * 3, y: 0, vx: 0, vy: 0 }
    const paddle = { x: combined * 3, y: 0, vx: 40, vy: 0 }
    const result = applyPaddleCollision(puck, prevPaddle, paddle, puckRadius, paddleRadius)
    expect(result.vx).toBeGreaterThan(0) // knocked forward, in the direction of the swipe
  })

  it('a paddle path that never comes near the puck is still a no-op', () => {
    const puck = { x: 0, y: 0, vx: 0, vy: 0 }
    const prevPaddle = { x: 500, y: 500, vx: 0, vy: 0 }
    const paddle = { x: 600, y: 600, vx: 40, vy: 40 }
    const result = applyPaddleCollision(puck, prevPaddle, paddle, puckRadius, paddleRadius)
    expect(result).toEqual(puck)
  })
})

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
