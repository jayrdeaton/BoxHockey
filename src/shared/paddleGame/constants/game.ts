import { BallSpeedLevel, PaddleSizeLevel } from '@/shared/paddleGame/types'

export const WALL_THICKNESS = 10

// width:height for the outer letterboxed container on desktop web only - a much wider, shallower
// shape than AirHockey's TABLE_LONG_TO_SHORT_RATIO (a real air-hockey table's ~2:1), matching a
// classic Pong court's own proportions instead.
export const TABLE_WIDTH_TO_HEIGHT_RATIO = 16 / 9
export const DESKTOP_WEB_MIN_WIDTH = 768

// Ball/paddle sizing, all as a fraction of board HEIGHT (unlike AirHockey's short-edge-fraction
// convention) - Pong's court is fixed wide/landscape-native in local space (paddles always at
// local-left/local-right along the long axis), so height is the axis that stays meaningful across
// both seating orientations once game.tsx swaps which real screen dimension feeds computeBoardLayout.
export const BALL_RADIUS_RATIO = 0.018
export const PADDLE_WIDTH_RATIO = 0.022
export const PADDLE_INSET_RATIO = 0.035
export const PADDLE_HEIGHT_RATIOS: Record<PaddleSizeLevel, number> = { small: 0.14, medium: 0.18, large: 0.24 }

export const PADDLE_VELOCITY_SMOOTHING_FRAMES = 3 // unchanged from AirHockey
export const MAX_PADDLE_SPEED = 26 // unchanged from AirHockey

// How many frames the AI's own aim-error wanders over (see useAIOpponent) - a fresh Math.random()
// draw is re-EMA'd into a persisted value at this rate rather than fed straight into
// computeAIPaddleTarget's jitter formula each tick, so the AI's imprecision drifts smoothly like a
// real opponent's wavering aim instead of snapping to a brand-new independent offset 60 times a
// second, which is what actually read as paddle shake rather than "slightly imprecise aim".
export const AI_AIM_WANDER_SMOOTHING_FRAMES = 20

// Wall bounces are lossless by design - direction flips, magnitude untouched, matching a classic
// Pong court's own flat top/bottom walls. Unlike AirHockey's WALL_RESTITUTION (0.72, a real
// mallet-and-ice feel), any restitution below 1 here would make the ball quietly bleed speed on
// every wall bounce despite the whole speed model being an explicit, deliberate ratchet elsewhere
// - the two mechanisms would fight each other. Ratchet-on-hit-only lives entirely in
// applyPaddleCollision.
export const WALL_RESTITUTION = 1
export const PADDLE_COLLISION_RESTITUTION = 1
// Extra vy nudge from WHERE on the paddle the ball struck (see applyPaddleCollision) - without
// this, a ball met by a paddle holding still reflects at vy≈0 off a pure geometric bounce and can
// rally dead-straight along the same horizontal line forever, which reads as broken rather than
// as a legitimate rally.
export const PADDLE_STEER_FACTOR = 0.6

export const BALL_SPEED_TIERS: Record<BallSpeedLevel, { base: number; increment: number; max: number }> = {
  slow: { base: 6, increment: 1.0, max: 14 },
  medium: { base: 8, increment: 1.4, max: 20 },
  fast: { base: 11, increment: 1.8, max: 26 }
}

export const SCORE_TO_WIN = 5
export const SERVE_PAUSE_MS = 900
export const SERVE_ANGLE_MAX_DEG = 30

// Sizes the TICK-level substep loop (see computeTickSubsteps below and useGameState.ts's TICK
// handler) against the thinnest feature a fast ball must not tunnel through - the paddle BAR, not
// the wall. A wall spans the board's full width so a single large-dt step can never skip past it
// entirely, but a paddle is only ~2% of board height thick, and the ball's own max speed is capped
// well above what a single 60fps frame's worth of displacement could safely resolve against
// something that thin.
export const PADDLE_TUNNEL_SAFETY_RATIO = 0.4
export const MAX_TICK_SUBSTEPS = 8

// Brick field sizing - all fractions of board height/width, same idiom as the ratios above. Solo's
// field fills most of the court (runway near paddle 1, margin before the far wall); the shared
// vsCpu/twoPlayer field is a narrower block centered on the court so it can never overlap either
// paddle's reachable area, since a paddle only ever moves in Y at a fixed X.
export const BRICK_GAP_RATIO = 0.006 // of board.height, applied to both axes
export const SOLO_BRICK_COLS = 6
export const SOLO_BRICK_ROWS = 8
export const SOLO_BRICK_FIELD_X_START_RATIO = 0.3
export const SOLO_BRICK_FIELD_X_END_RATIO = 0.92
export const SOLO_BRICK_FIELD_Y_MARGIN_RATIO = 0.06
export const SHARED_BRICK_COLS = 3
export const SHARED_BRICK_ROWS = 8
export const SHARED_BRICK_FIELD_WIDTH_RATIO = 0.24 // total width, centered on board.centerX
export const SHARED_BRICK_FIELD_Y_MARGIN_RATIO = 0.08

// Solo/Brickbreaker only.
export const SOLO_LIVES = 3

// ─── Tilt control (vsCpu/solo only - see tiltControlActiveFor in utils/gameMode.ts) ────────────

// Fast DeviceMotion sampling while a tilt-controlled paddle is actively steering - much finer
// grained than @tastic/core's own useOrientationState (see ORIENTATION_SENSOR_DEFAULT_INTERVAL_MS
// below), which only needs to detect coarse hold changes every ~100ms. Continuous paddle steering
// reads as noticeably laggier/steppier at that rate, so TiltInputLayer requests this faster one
// ONLY while its own subscription is active - expo-sensors' DeviceMotion.setUpdateInterval is a
// GLOBAL setting on the shared sensor singleton, not scoped per listener, so this has to be paired
// with restoring the default below whenever tilt control isn't active.
export const TILT_UPDATE_INTERVAL_MS = 20

// Local mirror of @tastic/core's own useOrientationState.tsx UPDATE_INTERVAL_MS (100) - that
// constant isn't exported by the package, so it can't be imported directly. TiltInputLayer restores
// the shared DeviceMotion singleton to exactly this rate whenever its own subscription tears down
// (disabled, paused, or unmounted), so the app's baseline orientation-hold-detection sampling rate
// is never left elevated for the rest of the session after a tilt-controlled round ends.
export const ORIENTATION_SENSOR_DEFAULT_INTERVAL_MS = 100

// Degrees of beta/gamma drift from the calibrated baseline (see utils/tiltInput.ts) that produce
// ZERO paddle movement - absorbs natural hand tremor and grip micro-adjustments that would
// otherwise read as constant low-amplitude paddle jitter rather than deliberate steering.
export const TILT_DEAD_ZONE_DEG = 2

// Degrees of beta/gamma drift (beyond the dead zone above) at which the paddle reaches the extreme
// of its own travel range (paddleMinY/paddleMaxY). A first-guess tuning value - like the axis
// mapping itself (see tiltInput.ts's own doc), how far someone naturally tilts a device while
// holding it is something to spot-check on a real device/simulator, not derive from first
// principles.
export const TILT_MAX_DEG = 25

// A brick or wall bounce (unlike a paddle hit) has no steering and is perfectly elastic - with
// zero jitter, the ball can settle into a stable periodic orbit inside a partially-cleared pocket
// (bouncing the same closed path between the remaining brick faces and/or the top/bottom walls
// forever) and never make further progress - confirmed live: a ball can get trapped bouncing
// between the court's own top/bottom walls with too few brick hits along the way for brick-only
// jitter to ever break the cycle. A few degrees of random angle nudge per bounce is enough to
// de-sync any such cycle within a handful of bounces without reading as anything other than
// physics to a player - same idea as computeServeVelocity's own SERVE_ANGLE_MAX_DEG randomization.
// Applied to EVERY reflective surface (bricks, top/bottom walls, solo's far wall) whenever bricks
// are active for the round - never to classic Pong's own wall bounces, which stay exactly as
// deterministic/lossless as they've always been (see WALL_RESTITUTION's own doc comment): that
// simpler geometry can't form a closed loop the way a brick field can, so there's nothing to guard
// against there, and two competing players don't want their rally's wall bounces made unpredictable.
export const BOUNCE_JITTER_MAX_DEG = 4
