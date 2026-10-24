import { FrictionLevel, PaddleSizeLevel, PuckSizeLevel } from '@/games/airhockey/types'

// Real physical/motion constants, unchanged from BoxHockey - a wall bounce, a puck's own top
// speed, and "at rest" all mean the same thing regardless of what's driving the puck around.
export const WALL_RESTITUTION = 0.72
export const MAX_SPEED = 22
export const STOP_THRESHOLD = 0.12
export const SCORE_TO_WIN = 5

// Per-round puck deceleration tier (see FrictionLevel and stepPhysics in utils/physics.ts, where
// frictionFactor = FRICTION_LEVELS[level] ** dt). Closer to 1 means less resistance, so the puck
// glides farther between touches.
export const FRICTION_LEVELS: Record<FrictionLevel, number> = {
  low: 0.992,
  medium: 0.986,
  high: 0.976
}

// Puck radius, as a fraction of the board's SHORT (goal) edge - see PuckSizeLevel and
// computeBoardLayout in utils/board.ts. Sized off the short edge specifically (not board.width
// directly, which means something different depending on GoalAxis) so the puck never jumps
// size discontinuously when the device rotates between face-to-face and side-by-side.
export const PUCK_SIZE_RATIOS: Record<PuckSizeLevel, number> = {
  small: 0.045,
  medium: 0.058,
  large: 0.074
}

// Paddle (mallet) radius, same short-edge-fraction convention as PUCK_SIZE_RATIOS. A real
// air-hockey mallet is only slightly bigger than the puck - 'medium' here is ~1.3x the 'medium'
// puck's radius, not a multiple of its diameter. The tiers exist for the same reason puck size's
// do: a bigger paddle is a bigger, more forgiving defensive/offensive surface, so it doubles as a
// difficulty/accessibility knob rather than being purely cosmetic.
export const PADDLE_SIZE_RATIOS: Record<PaddleSizeLevel, number> = {
  small: 0.06,
  medium: 0.075,
  large: 0.095
}

// How much of the goal must stay open around a single stationary, perfectly centered paddle -
// replaces a prior flat-fraction-of-the-table-width GOAL_WIDTH_RATIO table (keyed only by
// puckSize) that let a defender camp dead center and block literally every shot forever at
// default settings: circle-vs-circle contact means a centered paddle blocks any shot whose
// centerline passes within (paddleRadius + puckRadius) of it on either side - a "blocking span"
// of 2x that sum - and the old table sized the goal as a flat fraction of the table's short edge
// with no reference to that span at all, let alone to paddleSize, which is an entirely
// independent user setting (see PaddleSizeLevel/LoadoutSharedControls) the old table couldn't see
// even in principle. Goal width is now DERIVED from the actual blocking span (see
// computeBoardLayout in utils/board.ts), so this fraction is the one number that actually decides
// how campable the goal is, for every puckSize/paddleSize combination alike. 0.3 leaves roughly
// the same ~30% gap around a centered paddle that a real air-hockey mallet/puck leaves around a
// real table's goal.
export const GOAL_OPEN_FRACTION = 0.3

// Radius of each rink faceoff circle, as a fraction of the board's width - ported from BoxHockey
// unchanged (its FACEOFF_ZONE_RADIUS_RATIO). AirHockey has no turn-based faceoff draw for these
// to gate, so Board.tsx only ever renders their permanent resting chrome (ring + center dot),
// never BoxHockey's live/pulse/ripple states - but useGameState's GOAL_SERVE does use their
// positions functionally, as the scored-on player's post-goal puck spawn (see faceoffZoneCenter
// in utils/board.ts).
export const FACEOFF_ZONE_RADIUS_RATIO = 0.15

export const WALL_THICKNESS = 10
// Goal line stroke width (Board.tsx's 4 goal-line <Line> segments and 2 zone-line segments).
// Also reused as the perimeter wall/rink-pocket thickness fed into computeBoardLayout (see its
// wallThickness local) - same BoxHockey convention: "walls as thin as the goal line" stays a
// real equality rather than two independently-tuned literals that could drift apart.
export const GOAL_LINE_STROKE_WIDTH = 4

// Goal door flash (Board.tsx, driven by physics.ts's goalDoorHit/useGameState's goalDoorHitCount)
// - the invisible one-way door at the goal mouth (open front-to-back, solid back-to-front) flares
// right there to read as "that gap isn't actually open, that's what you just bounced off of".
// Ported from BoxHockey unchanged: two independently-timed layers, both snapping straight to full
// on impact (no fade-in tween - an impact reads as sudden). GOAL_DOOR_FLASH_COLOR_DECAY_MS is how
// fast the hot-white peak cools to the goal's own color AND how fast the wide soft glow halo
// (Board.tsx's own oversized-translucent-line-behind-the-crisp-one "brighter" technique, same as
// the puck's own idle glow) burns off; GOAL_DOOR_FLASH_OPACITY_DECAY_MS is how slowly the crisp
// core line, now settled into the goal's own color, lingers before fading to fully invisible -
// deliberately much longer, so the impact itself still reads instant while the afterglow lingers.
export const GOAL_DOOR_FLASH_COLOR_DECAY_MS = 120
export const GOAL_DOOR_FLASH_OPACITY_DECAY_MS = 1200
export const GOAL_DOOR_FLASH_GLOW_WIDTH_RATIO = 4
export const GOAL_DOOR_FLASH_GLOW_PEAK_OPACITY = 0.55

// width:height of a real air-hockey table (~8ft x 4ft, a roughly 2:1 long:short ratio) - replaces
// BoxHockey's BOARD_ASPECT_RATIO (a much narrower 3.3:8 box-hockey table). Only used the same way:
// to fix the board's shape on desktop web (see computeBoardLayout's isDesktopLayout branch) -
// native/mobile web still just fill the device's own screen exactly. Expressed as long:short
// (not width:height) since which physical axis is "long" depends on the live GoalAxis, unlike
// BoxHockey's fixed-portrait assumption.
export const TABLE_LONG_TO_SHORT_RATIO = 2.0

// A paddle's velocity, for collision purposes, is derived from how far its committed position
// moved this physics tick divided by dt (see computePaddleVelocity in utils/physics.ts) - not
// from the gesture's own translation delta, which is cumulative since touch-down, not per-frame.
// Smoothed over this many ticks (a simple moving average) so a single jittery touch sample can't
// produce a wild, physically-implausible instantaneous velocity that then gets imparted onto the
// puck on contact.
export const PADDLE_VELOCITY_SMOOTHING_FRAMES = 3

// Caps how fast a paddle's own (smoothed) velocity is allowed to read before it's imparted onto
// the puck at contact (see applyPaddleCollision in utils/physics.ts) - a real mallet's max
// practical swing speed, in the same units as MAX_SPEED, so a paddle whose tracked position spikes
// from a single fast/jittery touch sample can't launch the puck harder than the puck's own
// integrator elsewhere assumes is possible.
export const MAX_PADDLE_SPEED = 26

// Livelier than a wall bounce (WALL_RESTITUTION 0.72) - a mallet strike should feel snappy, not
// like just another wall.
export const PADDLE_COLLISION_RESTITUTION = 0.85

// Brief pause after a goal before the puck (and both paddles) reset to center for the next serve
// - real air hockey re-serves fast, no faceoff ceremony.
export const GOAL_SERVE_PAUSE_MS = 900

// Threshold (in CSS px) above which web is treated as "desktop" rather than phone-shaped - the
// one context that fixes the board to TABLE_LONG_TO_SHORT_RATIO and draws literal perimeter
// walls, since there's no physical device edge of its own to lean on there.
export const DESKTOP_WEB_MIN_WIDTH = 768

// Also the app's own theme identity: redux/store.ts feeds these straight into @rific/auto-paper as
// the primary/secondary of its color triad (tertiary derived via getThirdColor) AND as
// redux/seatColorsSlice.ts's own default "remembered" seat colors, so a fresh install's live theme
// and its guest-color memory can never drift apart. Moved here (rather than living in
// components/Theme.tsx, where they lived pre-Redux) specifically so the Redux store module - which
// must seed its theme reducer with these - never has to import a React component file to get them;
// this is a plain, framework-free constants module, same role Snake's SNAKE_COLORS plays in its own
// utils/snakeEngine.ts. Values unchanged from Theme.tsx's own prior DEFAULT_P1_COLOR/DEFAULT_P2_COLOR.
export const DEFAULT_P1_COLOR = '#f44336'
export const DEFAULT_P2_COLOR = '#2196f3'
