import { MAX_PADDLE_SPEED } from '@/shared/paddleGame/constants/game'
import { BallState, BoardLayout, PaddleState, Player } from '@/shared/paddleGame/types'
import { clampPaddleY } from '@/shared/paddleGame/utils/board'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

export interface AITuning {
  // How far ahead (ms) the AI predicts the ball's straight-line Y position - no wall-bounce-aware
  // lookahead in v1 (see the design spec), same "watch and adjust" philosophy AirHockey's own AI
  // uses rather than committing to a pre-planned trajectory.
  interceptLookaheadMs: number
  // Random offset (px) applied to the AI's own predicted Y each tick. Narrowed from AirHockey's
  // polar (angle + magnitude) jitter to a plain 1D scalar offset - there's only one axis left to
  // blur once a paddle can't move in X at all.
  aimJitterPx: number
  // Fraction of MAX_PADDLE_SPEED the AI's own target-approach rate is capped at - same mechanism
  // as AirHockey's identical field: a low-tier AI's target is computed just as promptly as a
  // high-tier one's, it just physically can't get there as fast, which alone is what produces
  // believable reaction lag with no setTimeout scheduling needed.
  maxApproachSpeed: number
}

const TUNING: Record<AIDifficulty, AITuning> = {
  easy: { interceptLookaheadMs: 80, aimJitterPx: 22, maxApproachSpeed: 0.5 },
  medium: { interceptLookaheadMs: 140, aimJitterPx: 10, maxApproachSpeed: 0.72 },
  hard: { interceptLookaheadMs: 200, aimJitterPx: 3, maxApproachSpeed: 0.92 }
}

// dt=1 in @tastic/core's useGameLoop means "one nominal 60fps frame" - ball.vx/vy are already
// expressed per that same unit, so predicting interceptLookaheadMs ahead means converting it into
// the same frame-unit before scaling velocity by it. Unchanged from AirHockey.
const MS_PER_FRAME = 1000 / 60

// Pure, per-tick decision function - called once per physics tick for the AI's own seat (see
// useAIOpponent) and returns a TARGET POSITION, exactly the shape a human's own drag produces (see
// TouchInputLayer's setPaddleTarget) - preserving AirHockey's own "AI plays through the human's
// input contract" principle. Drops AirHockey's entire isThreat/onOwnHalf/movingTowardOwnGoal/
// defendHomeBiasWhenFar branch outright: there is no "own half to retreat to" once a paddle sits
// at a fixed local X with nothing behind it to defend by falling back - every ball, regardless of
// which direction it's moving, is simply tracked straight-line, always.
export function computeAIPaddleTarget(ball: BallState, ownPaddle: PaddleState, board: BoardLayout, aiPlayer: Player, difficulty: AIDifficulty, random: () => number = Math.random): { x: number; y: number } {
  const tuning = TUNING[difficulty]
  const lookaheadFrames = tuning.interceptLookaheadMs / MS_PER_FRAME
  let targetY = ball.y + ball.vy * lookaheadFrames
  targetY += (random() * 2 - 1) * tuning.aimJitterPx

  const clampedY = clampPaddleY(targetY, board)
  const maxStep = tuning.maxApproachSpeed * MAX_PADDLE_SPEED
  const dy = clampedY - ownPaddle.y
  if (Math.abs(dy) <= maxStep) return { x: board.paddleX[aiPlayer], y: clampedY }
  return { x: board.paddleX[aiPlayer], y: ownPaddle.y + Math.sign(dy) * maxStep }
}
