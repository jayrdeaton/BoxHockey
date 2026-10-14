import { BoardLayout } from '@/types'
import { AIDifficulty, planAIShot, randomAIThinkDelayMs, randomInterceptReactionMs } from '@/utils/aiOpponent'
import { stepPhysics } from '@/utils/physics'

// A standard open board with no obstacles/wells - mirrors the fixture in physics.test.ts.
const openBoard: BoardLayout = {
  x: 10,
  y: 10,
  width: 300,
  height: 500,
  wallThickness: 8,
  goalWidth: 80,
  goalLeft: 110,
  goalRight: 190,
  puckRadius: 18,
  centerX: 160,
  centerY: 260,
  obstacles: [],
  gravityWells: [],
  goalPosts: [],
  wallPosts: [],
  cornerRadius: 0,
  behindGoalDepth: 0,
  faceoffOffsetYRatio: 0.42,
  boardMarginTop: 0
}

const puckAtCenter = { x: openBoard.centerX, y: openBoard.centerY, vx: 0, vy: 0 }

function simulate(vx: number, vy: number, board: BoardLayout) {
  let p = { x: puckAtCenter.x, y: puckAtCenter.y, vx, vy }
  for (let i = 0; i < 500; i++) {
    const result = stepPhysics(p, board, 1)
    p = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    if (result.scored !== null) return result.scored
    if (result.stopped) return null
  }
  return null
}

describe('planAIShot', () => {
  const difficulties: AIDifficulty[] = ['easy', 'medium', 'hard']

  it.each(difficulties)('%s: returns a unit direction and in-range power', (difficulty) => {
    const shot = planAIShot(puckAtCenter, openBoard, 2, difficulty)
    expect(Math.hypot(shot.fx, shot.fy)).toBeCloseTo(1, 5)
    expect(shot.power).toBeGreaterThan(0)
    expect(shot.power).toBeLessThanOrEqual(1)
  })

  it.each(difficulties)('%s: aims player 1 toward the top goal and player 2 toward the bottom goal', (difficulty) => {
    const p1Shot = planAIShot(puckAtCenter, openBoard, 1, difficulty)
    const p2Shot = planAIShot(puckAtCenter, openBoard, 2, difficulty)
    expect(p1Shot.fy).toBeLessThan(0)
    expect(p2Shot.fy).toBeGreaterThan(0)
  })

  // Easy is deliberately blurrier than medium/hard, but a beginner tier still shouldn't whiff a
  // dead-straight, wide-open net most of the time - only harder shots (bank angles, obstacles)
  // should be where the difficulty gap really shows up.
  const OPEN_SHOT_SUCCESS_RATE: Record<AIDifficulty, number> = { easy: 0.55, medium: 0.75, hard: 0.9 }

  it.each(difficulties)('%s: on a wide-open board, mostly finds the scoring shot', (difficulty) => {
    let scored = 0
    const trials = 20
    for (let i = 0; i < trials; i++) {
      const shot = planAIShot(puckAtCenter, openBoard, 2, difficulty)
      const speed = shot.power * 22 // MAX_SPEED
      const outcome = simulate(shot.fx * speed, shot.fy * speed, openBoard)
      if (outcome === 2) scored++
    }
    expect(scored).toBeGreaterThanOrEqual(trials * OPEN_SHOT_SUCCESS_RATE[difficulty])
  })

  it('never chooses an own-goal shot when a scoring shot is available', () => {
    let ownGoals = 0
    for (let i = 0; i < 20; i++) {
      const shot = planAIShot(puckAtCenter, openBoard, 2, 'hard')
      const speed = shot.power * 22
      const outcome = simulate(shot.fx * speed, shot.fy * speed, openBoard)
      if (outcome === 1) ownGoals++
    }
    expect(ownGoals).toBe(0)
  })
})

describe('randomAIThinkDelayMs', () => {
  it("stays within each difficulty's configured range", () => {
    const ranges: Record<AIDifficulty, [number, number]> = { easy: [300, 550], medium: [400, 650], hard: [500, 800] }
    for (const [difficulty, [min, max]] of Object.entries(ranges) as [AIDifficulty, [number, number]][]) {
      for (let i = 0; i < 10; i++) {
        const delay = randomAIThinkDelayMs(difficulty)
        expect(delay).toBeGreaterThanOrEqual(min)
        expect(delay).toBeLessThanOrEqual(max)
      }
    }
  })
})

describe('randomInterceptReactionMs', () => {
  it("stays within each difficulty's configured range", () => {
    // Reuses FACEOFF_REACTION_MS's own ranges (see utils/aiOpponent.ts's own comment on why) -
    // both are "notice a state change and react" tasks, not shot-planning ones.
    const ranges: Record<AIDifficulty, [number, number]> = { easy: [340, 620], medium: [230, 430], hard: [150, 280] }
    for (const [difficulty, [min, max]] of Object.entries(ranges) as [AIDifficulty, [number, number]][]) {
      for (let i = 0; i < 10; i++) {
        const delay = randomInterceptReactionMs(difficulty)
        expect(delay).toBeGreaterThanOrEqual(min)
        expect(delay).toBeLessThanOrEqual(max)
      }
    }
  })
})
