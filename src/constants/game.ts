import { ControlScheme, FrictionLevel, InterceptSpeed, PuckSizeLevel, ShotPreviewLength } from '@/types'

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
// 'flick' scheme ONLY (see ControlScheme in types/index.ts) — release speed (points/sec, from
// react-native-gesture-handler's own velocityX/velocityY) at/above which a shot maxes out at
// MAX_SPEED. 'pull'/'push' never read this; their power comes from drag DISTANCE instead (see
// MAX_STICK_PULLBACK_PIXELS below). Retuned down from an initial 2200 — real user feedback was that
// a firm, deliberate flick still felt like it wasn't "translating" into real power, which pointed at
// this ceiling being set for a harder flick than most people actually throw. Still a feel-tuned
// value, not a hard-science one — retune here if shots max out too easily/rarely on a real device.
export const MAX_FLICK_VELOCITY = 1300
// 'flick' scheme ONLY. Release speed floor below which the shot is treated as too weak to count —
// see resolveStrikeVelocity in useGameState.ts (ANDed with MIN_SHOOT_DRAG below: a flick needs BOTH
// real distance AND real speed, so a fast-but-tiny jitter and a slow-but-long drag both cancel
// cleanly instead of firing a limp accidental shot). Scaled down alongside MAX_FLICK_VELOCITY above
// so the floor stays the same ~14% fraction of the ceiling.
export const MIN_FLICK_VELOCITY = 180
// One-pole exponential-smoothing factor applied to the live velocity reading stored on
// AimIndicator.vx/vy — display-only (drives Board.tsx's live flick-preview direction/power while
// aiming in 'flick' mode), since RNGH's raw per-frame velocity is noisy enough to jitter the
// preview. The actual shot fired at release reads the RAW, unsmoothed velocity straight off the
// gesture's onEnd event (see game.tsx's panGesture and useGameState's resolveStrikeVelocity), never
// this smoothed value — so smoothing can never rob real power from an actual release, only
// stabilize what's shown while still aiming. First-pass value.
export const AIM_VELOCITY_SMOOTHING_ALPHA = 0.3
// 'pull'/'push' schemes: the real power cap — drag distance (finger's net displacement from
// touch-down to release) up to this many pixels maps linearly to shot power, same mechanic either
// scheme has always used (see resolveStrikeVelocity in useGameState.ts). Also Board.tsx's aiming
// stick's own visual pullback cap for those two schemes, and the target distance
// useAIOpponent.ts's synthetic drag aims for (shared by all three schemes' CPU gesture math, even
// though 'flick' never renders a stick to show it — see ControlScheme's own doc comment). Named
// for the stick specifically (was MAX_DRAG_PIXELS) since 'flick' has its own separate, unrelated
// power cap (MAX_FLICK_VELOCITY above).
export const MAX_STICK_PULLBACK_PIXELS = 160
// Universal across all three ControlSchemes — below this drag DISTANCE (finger's net displacement
// from where it first touched down to where it released), the shot is treated as too weak to count
// (see resolveStrikeVelocity in useGameState.ts). For 'pull'/'push' this is their ONLY gate; for
// 'flick' it's ANDed with MIN_FLICK_VELOCITY above (see that constant's own comment for why both
// exist for that scheme). Bumped from the original 12 per user feedback ("really hard to release a
// shot so you can set up again") — 12px was tight enough to be an unreliable target in practice,
// undersized even against Board.tsx's own phantom-puck cancel-zone indicator (drawn at radius
// puckRadius, which comfortably exceeds 12px at every puck size), so the visual affordance implied
// a bigger safe-return zone than the actual threshold honored.
export const MIN_SHOOT_DRAG = 28
// 'flick' scheme ONLY. A flick has to be a short, decisive gesture — real box hockey doesn't let
// you "guide" the puck by holding the stick against it. If a flick drag is still live this long
// after AIM_START (see game.tsx's flickGestureRef/auto-commit effect), it auto-commits using the
// peak velocity already captured and the live drag distance at that instant, exactly as if
// released right then — a genuine release before this always wins and is unaffected. Per explicit
// user feedback: this should never read as the shot being rejected/unresponsive, only as it having
// already fired off the swipe's own early energy. First-pass value, not yet verified by feel.
export const MAX_FLICK_GESTURE_MS = 200

// Sign applied to a shot's raw drag/flick vector before computeAimVector — see ControlScheme in
// types/index.ts. 'pull' fires opposite the drag (slingshot); 'push' and 'flick' both fire along it
// (same sign, different power model — see resolveStrikeVelocity in useGameState.ts for which). The
// single place this is read is useGameState.ts's STRIKE case (and useAIOpponent.ts, which has to
// cancel it back out so a CPU seat's own intended shot direction stays scheme-independent).
export const CONTROL_SCHEME_SIGN: Record<ControlScheme, 1 | -1> = { pull: -1, push: 1, flick: 1 }

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
// Goal line stroke width (Board.tsx's 4 goal-line <Line> segments). Also reused, when
// GameSettings.rink is off, as the divider/perimeter wall thickness fed into computeBoardLayout
// (see its wallThickness local) — guarantees "walls as thin as the goal line" stays a real
// equality rather than two independently-tuned literals that could drift apart. NOT used for
// Board.tsx's separate zone-line <Line> segments, which happen to share this same literal value
// today by coincidence, not by relationship.
export const GOAL_LINE_STROKE_WIDTH = 4
// Radius (as a fraction of puckRadius) of the small round pegs capping a goal mouth's edges
// (buildGoalPosts) and, when GameSettings.rink is off, a divider/gauntlet wall's hole edges
// (buildWallPosts) — shared so both post styles read as the same kind of thing visually.
export const WALL_POST_RADIUS_RATIO = 0.18
export const STOP_THRESHOLD = 0.12
// Per-round tier for the speed threshold useGameState.ts's AIM_START/STRIKE cases compare a live
// puck speed against to decide whether the RECEIVING player can reach in and redirect a still-
// coasting puck — see InterceptSpeed in types/index.ts. Deliberately separate from, and never
// passed into, stepPhysics' own STOP_THRESHOLD (which still governs the puck's natural, no-one-
// intervened stop unchanged). 'low' is exactly STOP_THRESHOLD — mathematically an empty intercept
// window, since hypot(vx,vy) < STOP_THRESHOLD implies stepPhysics' own per-axis stopped check has
// already fired on that same tick, so a round with no explicit choice behaves exactly as before.
// 'medium'/'high' are first-pass values, not yet verified by feel — retune here if intercepting
// feels too easy/hard to reach, or (see PHYSICS_STEP's own comment) if a hard-to-notice interval
// distinguishing "eligible" from "not yet" turns out to matter for pacing.
export const INTERCEPT_SPEED_THRESHOLDS: Record<InterceptSpeed, number> = {
  low: STOP_THRESHOLD,
  medium: 1.0,
  high: 2.5
}
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
//
// Widened from the original 6°/38° per real user feedback ("a direct shot on goal after a tipoff
// is far too common, it should be harder to get the angle perfect"). The goal's own angular width
// as seen from center ice is small — roughly a puck-goal's half-width over the center-to-goal-line
// distance, only a few degrees for a typical board — so even the OLD minimum (6°, a decisive/
// uncontested win's jitter) was already comparable to the goal's own half-width, meaning a clean
// win landed inside the goal mouth far more often than "a hard shot to line up" should. These
// values push scoring off the knock itself back to a genuine longshot at every margin, not a
// near-guarantee on a fast/decisive win.
export const FACEOFF_JITTER_MIN_DEG = 22
export const FACEOFF_JITTER_MAX_DEG = 55
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

// 'tripleTap' mode (see TipoffMode's own doc comment in types/index.ts and useTripleTap.ts).
// Radius (as a fraction of board width) of each player's own single press/swipe zone — a bit
// larger than FACEOFF_ZONE_RADIUS_RATIO since this is one non-paired target, not two to
// distinguish between.
export const TRIPLE_TAP_ZONE_RADIUS_RATIO = 0.2
// The third press's real power cap — drag distance (finger's net displacement from touch-down to
// release) up to this many pixels maps linearly to swipe power, same distance-based mechanic
// MAX_STICK_PULLBACK_PIXELS drives for the ordinary 'pull'/'push' shot — reusing that exact value
// as this mode's starting point rather than an unrelated new number, tunable independently by feel
// once this is in front of a real device.
export const TRIPLE_TAP_MAX_DRAG_PIXELS = MAX_STICK_PULLBACK_PIXELS
// Expand+fade duration (ms) of Board.tsx's directional swipe-captured flash — longer than
// FACEOFF_PRESS_RIPPLE_DURATION_MS since this is showing a whole direction+power, not just a
// reaction-speed blip.
export const TRIPLE_TAP_SWIPE_FLASH_DURATION_MS = 450

// Board.tsx's goal-door hit indicator — the invisible one-way door at the goal mouth (rink-on
// only: lets the puck IN toward the pocket but not back OUT the same way once it's behind the
// line — see stepPhysics' own "one-way door" comment) sits in the same visual gap the static
// goal-line <Line>s deliberately leave open between the posts, so a puck bouncing off it needs a
// flash right there to read as "that gap isn't actually open, that's what you just bounced off
// of". Two independently-timed layers, both snapping straight to full on impact (no fade-in tween
// — an impact reads as sudden): GOAL_DOOR_FLASH_COLOR_DECAY_MS is how fast the hot-white peak cools
// to the goal's own color AND how fast the wide soft glow halo (Board.tsx's own "brighter" pass —
// a translucent oversized line behind the crisp one, same halo technique as the puck's own idle
// glow) burns off; GOAL_DOOR_FLASH_OPACITY_DECAY_MS is how slowly the crisp core line, now settled
// into the goal's own color, lingers before fading to fully invisible — deliberately much longer,
// per explicit user feedback ("fade a lot slower from primary or secondary to off after the
// flash") — so the impact itself still reads instant while the afterglow lingers.
export const GOAL_DOOR_FLASH_COLOR_DECAY_MS = 120
export const GOAL_DOOR_FLASH_OPACITY_DECAY_MS = 1200
export const GOAL_DOOR_FLASH_GLOW_WIDTH_RATIO = 4
export const GOAL_DOOR_FLASH_GLOW_PEAK_OPACITY = 0.55

// Goal celebration "punch" — on top of the existing three expanding rings (which stay hardcoded
// 850ms/160ms-stagger inline in Board.tsx, unchanged): a translucent full-board wash + a matching
// goal-line/post flash and crease light-up (share GOAL_BOARD_FLASH_DECAY_MS), a staggered build-up
// sweep through the scorer's own newly-lit crease wedges, and a puck fade/burst. All fire once per
// goal off Board.tsx's existing useEffect(..., [lastScoredGoal]) and must fit inside game.tsx's
// 1200ms 'scored' hold.
export const GOAL_BOARD_FLASH_PEAK_OPACITY = 0.22
export const GOAL_BOARD_FLASH_DECAY_MS = 350
// Peak opacity of the scored-on goal's crease half-circle light-up (layered on top of its own
// always-present 0.28 ambient tint — see p1CreaseFill/p2CreaseFill) — bright enough to read as
// "lit up," short of a flat opaque disc that would hide the wedges/faceoff dots underneath it.
export const GOAL_CREASE_FLASH_PEAK_OPACITY = 0.85

// Wedge build-up sweep: each already-earned crease segment flashes in sequence, landing on the
// just-earned one. GOAL_WEDGE_FLASH_STEP_MS is the per-step stagger; GOAL_WEDGE_SWEEP_BUDGET_MS
// caps the total span of stagger alone so a long sweep (scoreToWin=10, worst case 9 steps)
// compresses instead of scaling linearly — 9 steps at the 250ms budget is ~28ms/step, not 450ms.
// The final (just-earned) segment blinks GOAL_WEDGE_FLASH_FINAL_BLINKS times (see
// WedgeFlashOverlay's blinkCount) before settling on its resting solid color, rather than a single
// decay like the earlier build-up steps — long enough (GOAL_WEDGE_FLASH_FINAL_MS) for each blink to
// actually read. Total worst case: 9 * (250/9) + GOAL_WEDGE_FLASH_FINAL_MS ≈ 900ms, comfortably
// inside 1200ms.
export const GOAL_WEDGE_FLASH_STEP_MS = 50
export const GOAL_WEDGE_SWEEP_BUDGET_MS = 250
export const GOAL_WEDGE_FLASH_SEG_MS = 150
export const GOAL_WEDGE_FLASH_FINAL_MS = 650
export const GOAL_WEDGE_FLASH_FINAL_BLINKS = 3

// Puck departure on a goal ("explode, or fade out, or something" per explicit request) — a short
// grace delay (PUCK_SCORE_FADE_DELAY_MS) so the puck is still visible for the first beat of the
// ring/flash burst before it disappears, not vanishing the instant the goal registers, then the
// puck itself fades out (PUCK_SCORE_FADE_MS) while a small burst of shard particles (see
// PuckShard in Board.tsx) flies outward from its resting position and fades over
// PUCK_BURST_DURATION_MS. PUCK_BURST_MAX_DIST_RATIO is how far a shard travels, as a multiple of
// puckRadius, before fully fading.
export const PUCK_SCORE_FADE_DELAY_MS = 150
export const PUCK_SCORE_FADE_MS = 300
export const PUCK_BURST_DURATION_MS = 500
export const PUCK_BURST_SHARD_COUNT = 8
export const PUCK_BURST_MAX_DIST_RATIO = 4

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
