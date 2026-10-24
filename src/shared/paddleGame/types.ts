import { AchievementDefinition as BaseAchievementDefinition, DayStreakState, OutcomeRecord, RoundResult, WinStreakState } from '@tastic/achievements'

import type { ControlScheme } from '@/shared/controlScheme'
import type { RoundMode } from '@/shell/types'

export type Player = 1 | 2

// A seat's desktop input: the mouse or a key cluster (see the shared controlScheme.ts).
export type { ControlScheme }

// Dramatically simpler than AirHockey's own phase machine, which needed a 'goalScored' pause for
// puck+paddle re-centering AND a distinct goal-mouth/post/corner geometry underneath it. Pong's
// underlying mechanic is the same shape (score, brief pause, re-serve) so the phase names mirror
// it 1:1, just renamed to match this game's own "point" vocabulary rather than "goal" - see the
// naming-convention note at the top of the design spec this file implements.
export type GamePhase = 'idle' | 'live' | 'pointScored' | 'gameOver'

// The shell's round mode: seat 2 is the CPU, a second person, or nobody (Breaker's solo round).
export type GameMode = RoundMode

export type AiDifficulty = 'easy' | 'medium' | 'hard'

export type PaddleSizeLevel = 'small' | 'medium' | 'large'

// Ball pace tier - governs BOTH the base serve speed and the per-hit ratchet increment (see
// BALL_SPEED_TIERS in constants/game.ts). Replaces AirHockey's FrictionLevel outright: Pong's
// ball has no deceleration model at all, so there's nothing for a "friction tier" to modulate -
// pace here is entirely a function of how fast the ball starts and how much each strike adds.
export type BallSpeedLevel = 'slow' | 'medium' | 'fast'

// One paddle game's own settings, under that game's own store key (Paddles' paddlesSettings,
// Breaker's breakerSettings). Seat 2 and the pack-wide settings (Lock Orientation, Edge Guard) are
// the shell's; whether a round has bricks is the game's (Paddles never, Breaker always).
export interface Settings {
  scoreToWin: number
  aiDifficulty: AiDifficulty
  paddleSize: PaddleSizeLevel
  ballSpeed: BallSpeedLevel
  // Web-only per-seat picker (the loadout's ControlSchemePicker): which physical input drives each
  // seat's paddle. 'mouse' keeps TouchInputLayer's drag input only; any key scheme adds
  // KeyboardInputLayer's keys on top.
  controlScheme: Record<Player, ControlScheme>
  // Opt-in device-tilt paddle steering, only while one person plays (see tiltControlActiveFor in
  // utils/gameMode.ts): two people share one device through TouchInputLayer's split touch zones,
  // and one tilt reading can't steer two paddles. Adds to TouchInputLayer's drag input, never
  // replaces it. Off by default.
  tiltControlEnabled: boolean
}

// A single destructible brick, in the same LOCAL space as BoardLayout. Deliberately its own type
// rather than a generic Obstacle - every obstacle in this game is destructible, so there's no
// non-destructible shape worth factoring out separately (unlike AirHockey/BoxHockey's permanent
// Obstacle, which this otherwise mirrors).
export interface Brick {
  x: number
  y: number
  width: number
  height: number
  destroyed: boolean
}

// Single source of truth for court geometry, always expressed in canonical LOCAL space: player 1
// is always at local-left, player 2 always at local-right, the ball always travels along the
// local X axis - regardless of how the device is physically held. Unlike AirHockey's BoardLayout,
// there is no GoalAxis/rotation field here at all: the rendering layer (game.tsx) is solely
// responsible for rotating this local rectangle onto the real screen via @tastic/split-screen's
// getFixedZoneRotation (see the design spec's board.ts section), so board/physics/AI code never
// needs to branch on real device orientation.
export interface BoardLayout {
  x: number
  y: number
  width: number
  height: number
  wallThickness: number
  ballRadius: number
  paddleWidth: number // thickness (short dimension) - a fixed ratio of board height, not tiered
  paddleHeight: number // length (long dimension) - tiered by PaddleSizeLevel
  // Each player's fixed X (their paddle rect's center-x) in LOCAL space - always paddleX[1] <
  // paddleX[2], for the whole match. A Pong paddle never moves in X at all (unlike AirHockey's
  // free-roam mallet), so this is computed once per BoardLayout rather than tracked as live state.
  paddleX: Record<Player, number>
  // A paddle's CENTER travel range in local Y, already inset by paddleHeight/2 from the top/bottom
  // walls so the paddle's own edge - not its center - is what actually touches a wall. Spans the
  // FULL board height: unlike AirHockey's own-half clamp (a mallet defends one goal), a Pong
  // paddle has always covered the entire court vertically, since it's the only thing defending
  // its edge.
  paddleMinY: number
  paddleMaxY: number
  centerX: number
  centerY: number
}

export interface BallState {
  x: number
  y: number
  vx: number
  vy: number
  // Tracked scalar speed - the per-hit ratchet's own source of truth (see applyPaddleCollision in
  // utils/physics.ts). Re-projected onto vx/vy on each hit rather than re-derived via hypot() every
  // hit, so many ratchets in a row can't accumulate float drift the way repeatedly reconstructing
  // it from vx/vy would.
  speed: number
}

// Only y is ever live in practice - x is always board.paddleX[player], fixed for the whole match.
// Kept as a full 2D PaddleState (not narrowed to a bare Y scalar) rather than introduce a second,
// narrower shape: computePaddleVelocity/clampPaddleSpeed copy VERBATIM from AirHockey (see
// utils/physics.ts) and are still genuinely 2D, so PaddleState keeping their existing (x, y, vx,
// vy) signature lets those two functions come across unmodified. vx is simply always 0 in
// practice since x never changes tick to tick.
export interface PaddleState {
  x: number
  y: number
  vx: number
  vy: number
}

export type PaddleStates = Record<Player, PaddleState>

export interface GameState {
  phase: GamePhase
  scores: [number, number]
  ball: BallState
  paddles: PaddleStates
  lastScoredBy: Player | null
  // Bumped on every TICK where stepPhysics reports a wall bounce - an ever-incrementing counter
  // (not a plain boolean), same reason AirHockey's identical bounceCount exists: a boolean alone
  // can't tell "a NEW bounce just happened" apart from "one already happened a tick ago" across
  // renders, which is what a bounce SFX/haptic effect actually needs to key off of.
  bounceCount: number
  // Always present (empty when bricks aren't active this round) so the TICK substep loop never
  // needs a conditional just to skip the brick pass. Lives in GameState, not BoardLayout: unlike
  // AirHockey/BoxHockey's permanently-static obstacles, bricks are destructible round-progress
  // state, and BoardLayout is recomputed on every resize/rotation - storing destroyed-state there
  // would silently regenerate a fully-intact field on a mid-round rotation. Rescaled (not
  // regenerated) on RESCALE - see rescaleBricks in utils/board.ts.
  bricks: Brick[]
  // Meaningful only for 'solo' (0 otherwise) - decremented on a miss, <= 0 ends the round as a loss.
  lives: number
}

// ─── Stats & achievements ───────────────────────────────────────────────────
export type { AchievementTier, UnlockedAchievementsState } from '@tastic/achievements'
export type AchievementDefinition = BaseAchievementDefinition<StatsState>

export type MatchRecord = OutcomeRecord

// The human is always seat 1 in vsCpu mode. A match ends the instant one side reaches scoreToWin,
// so a draw is impossible and `draws` stays 0 - it rides along because @tastic/achievements'
// applyResult maintains the whole quadruple.
export interface VsCpuStats extends OutcomeRecord, WinStreakState {
  byDifficulty: Record<AiDifficulty, MatchRecord>
}

// Tallied by SEAT, not by person - so this deliberately isn't an OutcomeRecord.
export interface TwoPlayerStats {
  played: number
  p1Wins: number
  p2Wins: number
}

// Solo/Brickbreaker has no opponent and no score tuple, so it's neither an OutcomeRecord (vsCpu)
// nor a seat tally (twoPlayer) - its own minimal shape instead. `cleared` is solo's "win": every
// brick destroyed before running out of lives.
export interface SoloStats {
  played: number
  cleared: number
}

// Points for and against across every match, both modes.
export interface PointTotals {
  scored: number
  conceded: number
}

export interface ProfileStats extends DayStreakState {
  vsCpu: VsCpuStats
  twoPlayer: TwoPlayerStats
  solo: SoloStats
  points: PointTotals
  shutouts: number
  bestWinMargin: number
  // Per ball-speed tier - the closest thing Pong has to a difficulty modifier the player picks
  // themselves, so "win at every speed" is a meaningful goal.
  bySpeed: Record<BallSpeedLevel, MatchRecord>
  // Career total, mode-agnostic - bricks can be destroyed in solo OR the vsCpu/twoPlayer Bricks
  // toggle, and there's no reason to fragment one counter into two for that.
  bricksDestroyed: number
}

export interface StatsState extends ProfileStats {
  profiles: Record<string, ProfileStats>
  firstGameResult: RoundResult | null
}
