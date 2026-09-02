import { FRICTION_LEVELS, MAX_FLICK_VELOCITY, MAX_SPEED, MAX_STICK_PULLBACK_PIXELS, MIN_FLICK_VELOCITY, MIN_SHOOT_DRAG } from '@/constants/game'
import { BoardLayout, Player, PuckState } from '@/types'
import { stepPhysics } from '@/utils/physics'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

export const AI_DIFFICULTY_LABELS: Record<AIDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard'
}

interface DifficultyTuning {
  angleSpreadDeg: number // half-width of the goal-facing sweep, in degrees either side of dead-on
  angleSamples: number // candidate angles across that sweep
  powerLevels: number[] // candidate power fractions (0..1) tried per angle
  bankShots: boolean // also sweep a full circle of angles (not just goal-facing) to find wall banks
  defenseWeight: number // penalty weight for leaving the puck near the AI's own goal on a non-scoring shot
  pickFromTopN: number // choose randomly among the top N scored candidates instead of always the best
  aimNoiseDeg: number // random angle jitter applied to the final choice
  powerNoise: number // random +/- fraction applied to the final power
  thinkMs: [number, number] // [min, max] "thinking" pause before the AI commits to its shot
}

// All three tiers share one search-and-noise algorithm; only these knobs differ. Easy searches a
// narrow, direct-shot-only cone and then deliberately blurs its own choice; Hard sweeps a full
// bank-shot-aware field and barely blurs at all.
const TUNING: Record<AIDifficulty, DifficultyTuning> = {
  easy: { angleSpreadDeg: 25, angleSamples: 9, powerLevels: [0.7, 1], bankShots: false, defenseWeight: 0, pickFromTopN: 2, aimNoiseDeg: 6, powerNoise: 0.22, thinkMs: [300, 550] },
  medium: { angleSpreadDeg: 55, angleSamples: 13, powerLevels: [0.55, 0.8, 1], bankShots: false, defenseWeight: 0.15, pickFromTopN: 2, aimNoiseDeg: 5, powerNoise: 0.1, thinkMs: [400, 650] },
  hard: { angleSpreadDeg: 90, angleSamples: 25, powerLevels: [0.5, 0.7, 0.85, 1], bankShots: true, defenseWeight: 0.35, pickFromTopN: 1, aimNoiseDeg: 1.5, powerNoise: 0.04, thinkMs: [500, 800] }
}

const SIM_MAX_STEPS = 500
// Keep a margin above the cancel threshold so post-noise power never accidentally produces a shot
// the reducer treats as "too short/slow, cancel the shot" — now TWO independent gates (distance
// AND velocity, see MIN_SHOOT_DRAG/MIN_FLICK_VELOCITY's own comments in constants/game.ts), so this
// takes whichever ratio is more restrictive rather than assuming distance always dominates.
const MIN_POWER = 1.4 * Math.max(MIN_SHOOT_DRAG / MAX_STICK_PULLBACK_PIXELS, MIN_FLICK_VELOCITY / MAX_FLICK_VELOCITY)

function otherPlayer(p: Player): Player {
  return p === 1 ? 2 : 1
}

interface SimResult {
  scored: Player | null
  finalX: number
  finalY: number
  bounces: number
}

// Runs the exact same stepPhysics the real game loop uses, so "will this shot score" is answered
// by replaying it rather than by a closed-form angle formula — the only way to account for wall
// banks, obstacles and gravity wells without duplicating that logic.
function simulateShot(puck: PuckState, board: BoardLayout, vx: number, vy: number, friction: number = FRICTION_LEVELS.medium): SimResult {
  let p: PuckState = { x: puck.x, y: puck.y, vx, vy }
  let bounces = 0
  for (let i = 0; i < SIM_MAX_STEPS; i++) {
    const result = stepPhysics(p, board, 1, friction)
    p = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    if (result.bounced) bounces++
    if (result.scored !== null) return { scored: result.scored, finalX: p.x, finalY: p.y, bounces }
    if (result.stopped) return { scored: null, finalX: p.x, finalY: p.y, bounces }
  }
  return { scored: null, finalX: p.x, finalY: p.y, bounces }
}

interface Candidate {
  angleRad: number
  power: number
  score: number
}

export interface PlannedShot {
  fx: number
  fy: number
  power: number
}

// Picks a shot for `aiPlayer` by simulating a batch of candidate (angle, power) pairs and scoring
// each by its outcome, then choosing among the top candidates and blurring the choice by
// difficulty — the same search runs at every tier, only its breadth/accuracy differ.
export function planAIShot(puck: PuckState, board: BoardLayout, aiPlayer: Player, difficulty: AIDifficulty, friction: number = FRICTION_LEVELS.medium): PlannedShot {
  const tuning = TUNING[difficulty]
  // Attacks the OPPONENT's goal, not the AI's own crease — see physics.ts's stepPhysics for the
  // matching scored:1/2 convention this must stay in sync with.
  const targetY = aiPlayer === 1 ? board.y : board.y + board.height
  const ownGoalY = aiPlayer === 1 ? board.y + board.height : board.y
  const goalCenterX = board.x + (board.goalLeft + board.goalRight) / 2

  const baseAngle = Math.atan2(targetY - puck.y, goalCenterX - puck.x)
  const spreadRad = (tuning.angleSpreadDeg * Math.PI) / 180
  const angles: number[] = []
  for (let i = 0; i < tuning.angleSamples; i++) {
    const t = tuning.angleSamples === 1 ? 0 : i / (tuning.angleSamples - 1) - 0.5
    angles.push(baseAngle + t * spreadRad * 2)
  }
  if (tuning.bankShots) {
    const extra = 16
    for (let i = 0; i < extra; i++) angles.push((i / extra) * Math.PI * 2)
  }

  const candidates: Candidate[] = []
  for (const angleRad of angles) {
    for (const power of tuning.powerLevels) {
      const fx = Math.cos(angleRad)
      const fy = Math.sin(angleRad)
      const speed = power * MAX_SPEED
      const sim = simulateShot(puck, board, fx * speed, fy * speed, friction)

      let score: number
      if (sim.scored === aiPlayer) {
        // Tie-broken toward the straightest scoring line (smallest deviation from dead-on)
        // rather than left as an arbitrary generation-order tie — otherwise pickFromTopN below
        // can end up choosing only among the sweep's grazing edge angles instead of its center.
        const offDeg = (Math.abs(angleRad - baseAngle) * 180) / Math.PI
        score = 10000 - sim.bounces * 5 - offDeg * 0.1
      } else if (sim.scored === otherPlayer(aiPlayer)) {
        score = -100000
      } else {
        const goalDist = Math.hypot(sim.finalX - goalCenterX, sim.finalY - targetY)
        const ownGoalDist = Math.hypot(sim.finalX - goalCenterX, sim.finalY - ownGoalY)
        score = -goalDist + tuning.defenseWeight * ownGoalDist
      }

      candidates.push({ angleRad, power, score })
    }
  }

  // Own-goal candidates (score <= -100000) are excluded whenever any safer option exists at all —
  // only fall back to them if literally everything sampled scores on the AI's own net.
  const viable = candidates.filter((c) => c.score > -100000)
  const pool = (viable.length > 0 ? viable : candidates).sort((a, b) => b.score - a.score).slice(0, Math.max(1, tuning.pickFromTopN))
  const chosen = pool[Math.floor(Math.random() * pool.length)]

  const noiseRad = ((Math.random() * 2 - 1) * tuning.aimNoiseDeg * Math.PI) / 180
  const noisyAngle = chosen.angleRad + noiseRad
  const noisyPower = Math.min(1, Math.max(MIN_POWER, chosen.power * (1 + (Math.random() * 2 - 1) * tuning.powerNoise)))

  return { fx: Math.cos(noisyAngle), fy: Math.sin(noisyAngle), power: noisyPower }
}

export function randomAIThinkDelayMs(difficulty: AIDifficulty): number {
  const [min, max] = TUNING[difficulty].thinkMs
  return min + Math.random() * (max - min)
}

// Tip-off reaction time (ms after the live window opens) — a separate, much tighter tuning table
// from thinkMs above, since a faceoff tests raw reaction speed rather than shot planning. Easy is
// slow and inconsistent; Hard is fast and tight, matching that tier's near-zero aimNoiseDeg/
// powerNoise above. Grounded against real simple-reaction-time data (visual-stimulus reaction
// averages ~200-250ms for an attentive adult; sub-150ms is elite/near the human floor) — the
// original ranges bottomed out at 90ms for Hard, faster than any human can physically react, which
// made even a genuinely quick real press feel unbeatable. Hard's window now straddles the human
// average (still a sharp, attentive opponent, occasionally right at the floor of what's humanly
// possible); Medium sits clearly slower than average (a decent but unremarkable reactor); Easy
// slower still (a beginner who's not fully locked in).
const FACEOFF_REACTION_MS: Record<AIDifficulty, [number, number]> = {
  easy: [340, 620],
  medium: [230, 430],
  hard: [150, 280]
}

export function randomFaceoffReactionMs(difficulty: AIDifficulty): number {
  const [min, max] = FACEOFF_REACTION_MS[difficulty]
  return min + Math.random() * (max - min)
}

// Reaction time before the CPU acts on a puck that's slowed into the interceptable band mid-slide
// (see InterceptSpeed in types/index.ts) — a separate tuning table from thinkMs (normal shot
// planning) and FACEOFF_REACTION_MS (tap-race reflexes), reusing the SAME ranges as the faceoff
// table: both are "notice a state change and react" tasks, not shot-planning ones, so the same
// grounding in real reaction-time data applies. Without this, the CPU would snipe an interceptable
// puck the instant the threshold is crossed — code has no reaction lag, so a human would never
// beat it to a fast puck at the higher InterceptSpeed tiers.
const INTERCEPT_REACTION_MS: Record<AIDifficulty, [number, number]> = FACEOFF_REACTION_MS

export function randomInterceptReactionMs(difficulty: AIDifficulty): number {
  const [min, max] = INTERCEPT_REACTION_MS[difficulty]
  return min + Math.random() * (max - min)
}

// Chance the AI misreads which of its two dots actually lit up and presses the wrong one — same
// forfeit consequence a human gets for the same mistake (see useGameState.ts's FACEOFF_TAP). Easy
// should feel like a beginner who's still learning to watch the right spot, not just a slow-but-
// flawless opponent; Hard stays perfect, matching its near-zero aim/power noise above.
const FACEOFF_WRONG_ZONE_CHANCE: Record<AIDifficulty, number> = {
  easy: 0.22,
  medium: 0.08,
  hard: 0
}

export function rollFaceoffWrongZone(difficulty: AIDifficulty): boolean {
  return Math.random() < FACEOFF_WRONG_ZONE_CHANCE[difficulty]
}
