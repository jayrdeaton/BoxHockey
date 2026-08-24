import { ControlScheme, FrictionLevel, PuckSizeLevel, ShotPreviewLength } from '@/types'

// Per-round puck deceleration tier (see types/index.ts's FrictionLevel and stepPhysics in
// utils/physics.ts, where frictionFactor = FRICTION_LEVELS[level] ** dt). Closer to 1 means less
// resistance, so the puck glides farther per shot. 'medium' is unchanged from the single fixed
// FRICTION constant this replaces, so a round with no explicit choice plays identically to before.
export const FRICTION_LEVELS: Record<FrictionLevel, number> = {
  low: 0.992,
  medium: 0.986,
  high: 0.976
}

// How far the aim chevron trajectory preview reaches, as a fraction of board.width — see
// ShotPreviewLength in types/index.ts and Board.tsx's chevron rendering. The board is much
// taller than it is wide (BOARD_ASPECT_RATIO ~0.41), so the side walls (~width/2 from center)
// are the only walls a length-capped preview can plausibly reach: 'long' comfortably clears one
// from most starting points with room for a second bounce segment beyond it, 'medium' just barely
// reaches one from dead-center, 'short' essentially never does, 'off' shows nothing.
export const SHOT_PREVIEW_LENGTH_RATIOS: Record<ShotPreviewLength, number> = {
  off: 0,
  short: 0.35,
  medium: 0.55,
  long: 1.4
}
export const WALL_RESTITUTION = 0.72
export const MAX_SPEED = 22
export const MAX_DRAG_PIXELS = 160
// Below this drag distance, useGameState's shoot() cancels the aim (AIM_CANCEL) instead of firing
// a shot — the intended way to back out mid-aim and reset without losing your turn (see
// AIM_CANCEL's own comment in useGameState.ts: it doesn't touch currentPlayer). Bumped from the
// original 12 per user feedback ("really hard to release a shot so you can set up again") — 12px
// was tight enough to be an unreliable target in practice, undersized even against Board.tsx's own
// phantom-puck cancel-zone indicator (drawn at radius puckRadius, which comfortably exceeds 12px
// at every puck size), so the visual affordance implied a bigger safe-return zone than the actual
// threshold honored.
export const MIN_SHOOT_DRAG = 28

// Sign applied to a shot's raw drag vector before computeAimVector — see ControlScheme in
// types/index.ts. 'pull' fires opposite the drag (slingshot), 'push' fires along it (swipe/flick).
// The single place this is read is useGameState.ts's STRIKE case (and useAIOpponent.ts, which has
// to cancel it back out so a CPU seat's own intended shot direction stays scheme-independent).
export const CONTROL_SCHEME_SIGN: Record<ControlScheme, 1 | -1> = { pull: -1, push: 1 }

// Per-round puck radius, as a fraction of board.width — see PuckSizeLevel in types/index.ts.
// 'medium' is unchanged from the single fixed PUCK_RADIUS_RATIO constant this replaces, so a
// round with no explicit choice plays identically to before.
export const PUCK_SIZE_RATIOS: Record<PuckSizeLevel, number> = {
  small: 0.045,
  medium: 0.058,
  large: 0.074
}
// Both the goal opening (computeBoardLayout's goalWidth) and the classic board variant's
// center-divider holes (buildObstacles) are sized as this multiple of the CURRENT puckRadius —
// deliberately the same formula in both places (see PuckSizeLevel's doc comment) so the two
// openings a puck has to fit through are always the same size as each other, and both scale
// together when puck size changes rather than the goal staying a fixed board-width fraction.
// Scoring (stepPhysics in physics.ts) requires the puck's WHOLE diameter (2x puckRadius) to
// clear the opening, not just its center — so the actual margin for error is
// (this multiplier - 2) puck radii total, split across both sides. A single shared value of 3
// (only half a puck radius of slack per side) turned out to make the GOAL itself nearly
// impossible to hit even on a well-aimed "clear" shot, since that's well within normal shot
// variance — bumped to 4 for a full puck radius of margin per side, matching what the old fixed
// GOAL_WIDTH_RATIO (~4.66x puck radius, pre-puckSize-setting) always gave for goal-scoring.
// Per user feedback, puck size now doubles as a difficulty/accessibility tier, not just a visual
// scale: a bigger puck should feel MORE forgiving, not just proportionally identical-but-bigger,
// so this margin grows with puckSize rather than staying one constant. 'medium' keeps the
// verified-working value of 4 unchanged; 'small' is tighter (more precision-demanding) and
// 'large' looser (easier to land a shot), while every tier still keeps a comfortably-above-2
// multiplier so a truly dead-center shot always scores regardless of tier (see
// boardGeometry.test.ts, which asserts this at all three levels).
export const DIVIDER_HOLE_TO_PUCK_RADIUS: Record<PuckSizeLevel, number> = {
  small: 3.5,
  medium: 4,
  large: 5
}
export const WALL_THICKNESS = 10
export const STOP_THRESHOLD = 0.12
export const SCORE_TO_WIN = 5
export const STRIKE_DURATION_MS = 130

export const GRAVITY_WELL_MIN_DIST = 4
export const GRAVITY_WELL_ATTRACT_STRENGTH = 0.32
// gravity's 4 corner wells only, paired with GravityWell.activeAtRest — these are the sole
// gate keeping a puck from permanently dying in a corner, so a well that merely nudges isn't
// enough. Empirically (see physics.test.ts's "corner repel never stalls" test), the quadratic
// falloff means the puck can never be GUARANTEED to clear the well's full nominal radius no matter
// how strong this is — acceleration approaches 0 as distance approaches radius regardless of
// strength, so friction always wins that last stretch eventually. What strength actually buys is
// how CLOSE to the boundary (and how far from the literal corner) it settles; -10 in that test's
// synthetic 60px-radius well reliably cleared ~89% of the radius, well clear of the corner itself,
// vs ~81% at -4. Scaled for this well's much larger real radius (~0.17 * board width, deliberately
// generous after user feedback — see buildGravityWells' 'gravity' case) — needs real
// playtesting/tuning, this is a first-pass value, not a verified-by-feel one.
export const GRAVITY_WELL_CORNER_REPEL_STRENGTH = -3

// Tip-off (see useFaceoff.ts, utils/faceoff.ts). Countdown ticks at a fixed cadence, then a
// randomized hold (no visual cue) before the live tap window opens — the randomization keeps a
// player from just timing a fixed 3-2-1 rhythm instead of actually reacting to "go".
export const FACEOFF_COUNTDOWN_STEP_MS = 600
export const FACEOFF_HOLD_MIN_MS = 150
export const FACEOFF_HOLD_MAX_MS = 450
// How long to wait for a human who hasn't tapped at all before awarding the draw to whoever did.
export const FACEOFF_TAP_TIMEOUT_MS = 4000
// Margin (ms) between the two players' presses beyond which a win is treated as maximal "no
// defense" for angle purposes — also the margin substituted for a forfeit (wrong-zone or timeout)
// win, since an opponent who never landed a valid press contested the puck exactly as little as a
// blowout margin would. Drives knock ANGLE only (see computeFaceoffKnock) — how contested the race
// was, not how hard the winner hits it.
export const FACEOFF_MARGIN_MAX_MS = 350
// The winner's own raw reaction time (ms, their press minus goAt) at/above which knock power
// bottoms out at FACEOFF_KNOCK_MIN_POWER — a near-instant press approaches FACEOFF_KNOCK_MAX_POWER.
// Drives knock POWER only — independent of the opponent's timing, so a forfeit win doesn't get a
// free max-power knock the winner's own reflexes didn't earn.
export const FACEOFF_REACTION_MAX_MS = 500
// Knock power as a fraction of MAX_SPEED — MIN barely nudges the puck past center, MAX can
// plausibly reach/enter the loser's goal mouth (a lightning-fast reaction can score outright, same
// as real hockey occasionally allows straight off a faceoff). Real user feedback, explicit: the
// puck must come off the draw with genuine velocity (this IS a real physical knock, not a
// placement), and the winner must NEVER get a follow-up shot off of it, hit or miss — the loser
// always takes the very next real turn (see FACEOFF_LAUNCH's own comment in useGameState.ts). The
// knock itself is the winner's entire reward for the draw.
export const FACEOFF_KNOCK_MIN_POWER = 0.15
export const FACEOFF_KNOCK_MAX_POWER = 0.95
// Random angle jitter applied to the knock, off the straight center-line bearing toward the
// loser's goal — wider for a close/scrappy (contested) draw, tighter for an uncontested one. Capped
// well under 90° regardless of margin so a jittered close-margin knock can never point back across
// the halfway line toward the winner's own net (the puck launches from dead-center, equidistant
// from both goals, so a wider cap would risk an own-goal off the very draw the winner just took).
export const FACEOFF_JITTER_MIN_DEG = 6
export const FACEOFF_JITTER_MAX_DEG = 38
// Radius (as a fraction of board width) of the rink faceoff dots that double as this draw's press
// targets — shared between Board.tsx's rendering and the tap hit-test in game.tsx so the visible
// circle and the tappable area never drift apart. Matches Board.tsx's pre-existing decorative
// circle size (added by a concurrent session before this mechanic reused it for gameplay).
export const FACEOFF_ZONE_RADIUS_RATIO = 0.15
// Expand+fade duration (ms) of Board.tsx's per-press ripple (see FaceoffState.pressFlash) — short
// on purpose: the whole point is visualizing reaction SPEED, so a lazy animation would undercut
// its own premise.
export const FACEOFF_PRESS_RIPPLE_DURATION_MS = 280
// Shaved off a player's own effective reaction time (in the head-to-head race resolution only —
// see FACEOFF_TAP's genuine-race branch in useGameState.ts) when FaceoffState.readyGuess for that
// player happened to match this draw's real zones — a pure-luck hunch made blind, at ready time,
// with zero information to go on (see readyGuess's own doc comment in types/index.ts). Sized to be
// a real, close-race-flipping edge without being so large it overwhelms genuine reaction skill —
// most real margins are well under FACEOFF_MARGIN_MAX_MS.
export const FACEOFF_GUESS_BONUS_MS = 60

// Threshold (in CSS px) above which web is treated as "desktop" rather than phone-shaped — the
// one context that fixes the board to BOARD_ASPECT_RATIO and draws the perimeter walls (see
// game.tsx's isDesktopWeb and utils/board.ts's isDesktopLayout), since there's no physical device
// edge of its own to lean on there the way native or mobile web has.
export const DESKTOP_WEB_MIN_WIDTH = 768

// width:height of a real box hockey table (~8ft x 3.3ft — https://en.wikipedia.org/wiki/Box_hockey).
// Only desktop web fixes the board to this ratio (letterboxing whichever dimension isn't the
// tighter constraint) — native and mobile web deliberately don't: the board just fills the
// device's own screen exactly, whatever shape that happens to be, so there's never a gap between
// the visual wall and the physical edge a bank shot actually bounces off. See computeBoardLayout().
export const BOARD_ASPECT_RATIO = 3.3 / 8

// Board/wall/player/line colors now come from the live theme (useAutoPaperTheme, see Board.tsx and
// Theme.tsx) rather than fixed constants — the board's structure is drawn in the derived "primary"
// color and player colors are picked per-session, so there's no static palette to hardcode anymore.
// wellAttract/wellRepel stay fixed: gravity wells are a gameplay signal (polarity), not a themed
// surface, so they keep a constant, always-recognizable pair of accent hues.
export const COLORS = {
  wellAttract: '#8B5CF6',
  wellRepel: '#F59E0B'
} as const

// Coin-flip tip-off ceremony (see useGameState.ts's 'coinFlip' phase and Board.tsx's rendering) —
// purely cosmetic, played once at the start of a 'coinFlip'-mode game over a winner/puck placement
// that's already final the instant it starts (see TipoffMode's doc comment in types/index.ts).
// Gated behind a tap (game.tsx's coinFlipStarted) rather than firing on its own — somebody has to
// actually flip it — and until that tap, Board.tsx shows only a plain neutral ring at board center,
// breathing with the same invite-pulse language 'faceoff' mode's own ready-check circles already
// use (see Board.tsx's p1ReadyPulse/p2ReadyPulse), no separate text prompt of its own. That ring IS
// already the coin's own eventual size/position, so the tap hands off straight into the sequence
// below with no separate "grow into place" beat first:
//   1. Spin — rapid rotation, squashing to a sliver and swapping face color each half-turn before
//      landing exactly on the winner's face.
//   2. Hold — a brief beat to register that landed face.
//   3. Fade — that face color bleeds to black while a ring in the same color fades in, becoming
//      the puck's own black-fill/colored-ring look.
//   4. Depart — shrinks and slides from board center back down to the puck's actual resting spot,
//      landing pixel-identical to where the real puck appears the instant game.tsx's own
//      COIN_FLIP_TOTAL_MS timer (started on the same tap) flips phase to 'idle'.
export const COIN_FLIP_SPIN_MS = 1100
export const COIN_FLIP_HOLD_MS = 200
export const COIN_FLIP_FADE_MS = 250
export const COIN_FLIP_TRAVEL_MS = 400
export const COIN_FLIP_TOTAL_MS = COIN_FLIP_SPIN_MS + COIN_FLIP_HOLD_MS + COIN_FLIP_FADE_MS + COIN_FLIP_TRAVEL_MS
// Half-turns the coin completes before landing (plus one more if the result lands on player 2's
// face — see Board.tsx) — high enough to read as a real spin, not a couple of lazy wobbles.
export const COIN_FLIP_BASE_HALF_TURNS = 8
// Floor on the coin's horizontal squash (see Board.tsx's coinFlipScaleX) — 0 would make the
// edge-on instant a literal zero-width invisible line for a frame; a small floor keeps a thin
// sliver visible throughout the spin instead.
export const COIN_FLIP_MIN_SCALE_X = 0.08

// Loadout player-panel area (see loadout.tsx): whenever a real device rotation changes
// orientationMode or which physical side P1 lands on (see useP1OnRight), the panels fade out, the
// layout underneath swaps while invisible, then they fade back in — masking what would otherwise
// be an instant jump-cut as panels reflow or swap sides. Short and symmetric on purpose: this is
// masking a reflow that already happened at the OS's own pace, not a deliberate reveal.
export const LOADOUT_PANEL_SWAP_FADE_MS = 180
