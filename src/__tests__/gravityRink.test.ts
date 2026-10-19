import { FRICTION_LEVELS, MAX_SPEED } from '@/constants/game'
import { BoardLayout, BoardVariant, PuckState } from '@/types'
import { computeBoardLayout } from '@/utils/board'
import { stepPhysics } from '@/utils/physics'

// The bug seen while capturing App Store screenshots (2026-10-18): on Gravity with Rink, against
// the CPU on Hard, the puck came to rest behind the bottom goal line beside the goal mouth, outside
// the right post, and the next thing that happened was a face-off, i.e. a goal. A puck behind the
// line outside the posts is in the open rink pocket (legal ice), but it could score from there:
// sliding along just behind the line, one substep left it straddling the line by a fraction of a
// pixel with its center still outside the posts, the next carried its center inside the goal's
// x-range, the post (no longer skipped, since the puck wasn't FULLY behind) shoved it back past the
// line, and the score check read that as a fresh crossing. The Hard CPU plans by replaying
// stepPhysics, so it found and took those goals. Real geometry: the iPhone 17 Pro Max layout the
// screenshots were taken on.
const IPHONE_INSETS = { top: 62, bottom: 34, left: 0, right: 0 }
const friction = FRICTION_LEVELS.medium

function iphoneBoard(variant: BoardVariant, rink = true): BoardLayout {
  return computeBoardLayout(440, 956, IPHONE_INSETS, variant, 'medium', rink)
}

// Rolls a shot until it scores, stops or runs out of frames. For a goal, `throughMouth` says
// whether the puck's center last crossed the scoring line (front to back) between the posts, which
// is what a goal is: a puck that went wide of the net and then wandered behind it must never count.
function roll(board: BoardLayout, puck: PuckState, dt = 1, maxFrames = 3000): { scored: 1 | 2 | null; throughMouth: boolean; stopped: boolean } {
  const goalLeft = board.x + board.goalLeft
  const goalRight = board.x + board.goalRight
  const lines = { 1: { y: board.y, dir: -1 }, 2: { y: board.y + board.height, dir: 1 } }
  const lastCrossX: Record<1 | 2, number | null> = { 1: null, 2: null }
  let p = puck
  for (let i = 0; i < maxFrames; i++) {
    const result = stepPhysics(p, board, dt, friction)
    for (const side of [1, 2] as const) {
      const { y, dir } = lines[side]
      if ((p.y - y) * dir <= 0 && (result.y - y) * dir > 0) lastCrossX[side] = p.x + ((result.x - p.x) * (y - p.y)) / (result.y - p.y)
    }
    if (result.scored !== null) {
      const crossX = lastCrossX[result.scored]
      return { scored: result.scored, throughMouth: crossX !== null && crossX > goalLeft && crossX < goalRight, stopped: false }
    }
    if (result.stopped) return { scored: null, throughMouth: false, stopped: true }
    p = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
  }
  return { scored: null, throughMouth: false, stopped: false }
}

describe('rink: a puck behind a goal line beside the net can never score', () => {
  it('the screenshot repro: the Hard CPU shot from behind the bottom line beside the right post does not score', () => {
    const board = iphoneBoard('gravity')
    const r = board.puckRadius
    const bottomLine = board.y + board.height
    // At rest fully behind the bottom line, just outside the right post (bottom right).
    const puck = { x: 290, y: 912, vx: 0, vy: 0 }
    expect(puck.y - r).toBeGreaterThan(bottomLine)
    expect(puck.x).toBeGreaterThan(board.x + board.goalRight)
    // The shot planAIShot('hard') picked from there for the CPU (P2, attacking the bottom goal):
    // left along the back of the line, rising slightly.
    const result = roll(board, { ...puck, vx: -10.89, vy: -2.86 })
    expect(result.scored).toBeNull()
  })

  it.each(['gravity', 'classic', 'gauntlet'] as BoardVariant[])('%s: every goal from a fan of shots beside the posts goes in through the mouth', (variant) => {
    const board = iphoneBoard(variant)
    const r = board.puckRadius
    const posts = [board.x + board.goalLeft, board.x + board.goalRight]
    let goals = 0
    for (const postX of posts) {
      const outward = postX < board.centerX ? -1 : 1
      for (const dx of [8, 30]) {
        for (const depth of [2, 12]) {
          for (const y of [board.y - r - depth, board.y + board.height + r + depth]) {
            for (let a = 0; a < 24; a++) {
              for (const power of [0.5, 1]) {
                const angle = (a / 24) * Math.PI * 2
                const speed = power * MAX_SPEED
                const result = roll(board, { x: postX + outward * dx, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed })
                if (result.scored === null) continue
                goals++
                expect(result.throughMouth).toBe(true)
              }
            }
          }
        }
      }
    }
    // Some of these shots come back around the front and score for real (before the fix, as many
    // again scored from beside the net).
    expect(goals).toBeGreaterThan(0)
  })

  it('rink off: an ordinary shot through the mouth still scores, and still counts as through the mouth', () => {
    const board = iphoneBoard('gravity', false)
    const goalCenterX = board.x + (board.goalLeft + board.goalRight) / 2
    const result = roll(board, { x: goalCenterX, y: board.y + board.height - 60, vx: 0, vy: 12 })
    expect(result.scored).toBe(2)
    expect(result.throughMouth).toBe(true)
  })
})

describe('gravity: the center attractor cannot pin a sliding puck against the divider', () => {
  // A second softlock found while sweeping the same board: classic's center divider runs straight
  // through the attractor's center, and at a steady frame dt of about 1.25 or more (40 fps or
  // slower: a dropped-frame simulator, a slow web tab) the attractor's pull on a puck touching the
  // divider, bounced back by the wall at WALL_RESTITUTION, kept it above STOP_THRESHOLD every
  // frame. The puck looked still and 'simulating' never ended, so neither seat could ever shoot.
  // Whether a given shot falls into that cycle depends on how it arrives, so this fires a grid of
  // ordinary shots across the board rather than one hand-placed puck; before the fix 98 of these
  // 384 never ended at dt 2 (36 at dt 1.5, 136 at dt 2.5).
  it.each([1, 1.5, 2, 2.5])('every shot in a sweep across the board ends (scores or stops) at dt %s', (dt) => {
    const board = iphoneBoard('gravity')
    const r = board.puckRadius
    let neverEnded = 0
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = board.x + r + ((board.width - 2 * r) * (i + 0.5)) / 4
        const y = board.y + r + ((board.height - 2 * r) * (j + 0.5)) / 4
        for (let a = 0; a < 12; a++) {
          for (const speed of [3, 9]) {
            const angle = (a / 12) * Math.PI * 2 + 0.1
            const result = roll(board, { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }, dt, 2000)
            if (result.scored === null && !result.stopped) neverEnded++
          }
        }
      }
    }
    expect(neverEnded).toBe(0)
  })
})
