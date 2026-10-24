import { AchievementDefinition as BaseAchievementDefinition, DayStreakState, OutcomeRecord, RoundResult, WinStreakState } from '@tastic/achievements'

export type Player = 1 | 2

export type GamePhase = 'idle' | 'aiming' | 'striking' | 'simulating' | 'scored' | 'gameOver' | 'faceoff' | 'coinFlip' | 'tripleTap'

export type BoardVariant = 'classic' | 'gauntlet' | 'gravity'

export type GameMode = 'twoPlayer' | 'vsCpu'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// How a shot is aimed & released - per-PLAYER, not a single round-wide choice (two people sharing
// one device may simply prefer a different feel - see Settings.controlScheme below, and
// LightCycles' identically-shaped keyScheme setting, the pattern this one mirrors). Read by
// useGameState.ts's STRIKE case (via CONTROL_SCHEME_SIGN and resolveStrikeVelocity in
// constants/game.ts and useGameState.ts respectively) to decide both the sign and the power model
// applied to the raw gesture, and mirrored by Board.tsx for the stick/chevron-preview direction.
// 'pull' and 'push' share ONE mechanic - distance-based power (see MAX_STICK_PULLBACK_PIXELS/
// MIN_SHOOT_DRAG in constants/game.ts): how far the finger travels from touch-down to release sets
// the power, up to a cap, and Board.tsx shows a pulled-back stick + trajectory preview the whole
// time. They differ only in direction:
// 'pull': slingshot/pool-cue - drag AWAY from where you want to shoot, puck fires in the opposite
// direction on release. The original/only behavior before either of the other two existed.
// 'push': drag TOWARD where you want to shoot, puck fires in the SAME direction as the drag -
// otherwise identical to 'pull' (same stick, same preview, same distance-based power).
// 'flick' is a genuinely different THIRD mechanic, not a variant of push: velocity-based power (see
// MAX_FLICK_VELOCITY/MIN_FLICK_VELOCITY) - a fast, short swipe fires hard even if the finger barely
// traveled, and a slow long drag fires weakly even if it traveled far. Fires along the swipe
// direction, same sign as 'push'. Board.tsx never shows the pulled-back stick for this scheme -
// there's nothing to visually "pull back" when power comes from speed, not distance - though the
// trajectory preview (chevron trail / front arrow, per ShotPreviewLength) still applies.
// 'stick' is a FOURTH mechanic, closest to real box hockey: the finger is the stick blade, and the
// shot is whatever happens when it runs into the puck (utils/stick.ts) - no release, no "from
// anywhere". The puck flies off along the line from where the blade hit it through its center,
// as hard as the blade was moving into it, so a square hit is a full shot and a glancing one a soft
// deflection. The blade stays inside the walls, so a puck in a corner can only be dug out from the
// open side. Missing is free (swing again, like the real game); only the first hit counts. Works
// mid-slide too (an intercept), where a blade held in the puck's path deflects it.
export type ControlScheme = 'pull' | 'push' | 'flick' | 'stick'

// A player profile is the pack's (@tastic/profile's base Profile: name, color, tag), shared by
// every game. Box Hockey's own per-profile shot style lives in redux/profileExtensionsSlice.ts.
export type { Profile } from '@tastic/profile'

// How possession is decided at the start of a game and (for 'faceoff' only) after every goal -
// see useFaceoff.ts. 'coinFlip' is the lighter-weight option: the winner and puck placement (a
// random one of that player's own rink faceoff dots - see faceoffZoneCenter in utils/board.ts)
// are both decided instantly, before the game's own 'coinFlip' phase ever renders a frame (see
// makeInitialState in useGameState.ts) - the brief ceremony that phase plays out (see Board.tsx's
// coin-flip animation) is pure cosmetic dramatization of an already-final result, never a second
// source of truth for it, and never repeats after the game's first draw. 'faceoff' is the real
// hockey rule: a 3-2-1-tap-race mini-game, every single score, whose margin of victory drives a
// real knock (see computeFaceoffKnock in utils/faceoff.ts) into the LOSER's own territory - but
// the winner never gets a follow-up shot off of it, hit or miss: PHYSICS_STEP always hands the
// very next real turn to the loser (see its 'scored' and 'stopped' branches, both unconditional),
// exactly like winning a real faceoff pins the other team back without letting you also take
// their next shot for them. Turn always passes to the other player on an ordinary miss taken from
// a normal, self-aimed shot too (this is a turn-based game, not soccer); the only thing that's
// soccer-style is who gets the puck back after a GOAL - the conceding player, in their own zone
// (see useGameState.ts's PHYSICS_STEP 'scored' branch and NEXT_ROUND).
//
// 'tripleTap' is the third mode - modeled on the real box-hockey ritual of tapping sticks together
// before going for the puck. Both players tap their own half TRIPLE_TAP_TAPS times IN STEP: a tap
// only counts once the other player has caught up (you can be at most one tap ahead), so nobody can
// race through the taps alone. Once both have every tap in, it's a swipe race (flick power, see
// TripleTapState): the first real swipe launches the puck off center at once, and the other
// player's swipe, if it lands within TRIPLE_TAP_CLASH_WINDOW_MS, is added onto the moving puck (a
// "stick clash", combineAndClampVelocity in useGameState.ts) and knocks it off its line. Later than
// that, it's too late. Touch/mobile only - see loadout.tsx, which hides this option on web.
export type TipoffMode = 'coinFlip' | 'faceoff' | 'tripleTap'

// Per-round puck deceleration tier - see FRICTION_LEVELS in constants/game.ts (the numeric
// coefficient each level maps to) and stepPhysics in utils/physics.ts (where it's actually
// applied as frictionFactor = FRICTION_LEVELS[level] ** dt). 'medium' matches the single fixed
// FRICTION constant this setting replaces, so existing rounds default to unchanged behavior.
export type FrictionLevel = 'low' | 'medium' | 'high'

// Per-round puck radius tier - see PUCK_SIZE_RATIOS in constants/game.ts (the fraction of
// board.width each tier maps to) and computeBoardLayout in utils/board.ts, where it's the one
// source of puckRadius. 'medium' matches the single fixed PUCK_RADIUS_RATIO constant this setting
// replaces, so existing rounds default to unchanged behavior. The goal opening and the classic
// board's center-divider holes are BOTH sized directly off puckRadius (see
// DIVIDER_HOLE_TO_PUCK_RADIUS in constants/game.ts) rather than off board.width independently, so
// changing puck size scales the goal and the divider gaps together, in lockstep - a bigger puck
// gets a bigger goal and bigger gaps to match, not a fixed-size goal that just gets easier/harder.
export type PuckSizeLevel = 'small' | 'medium' | 'large'

// Per-round tier controlling how slow the puck must be before the RECEIVING player (whoever
// doesn't currently hold GameState.currentPlayer) can reach in and redirect it with their own
// shot, without waiting for a full natural stop - see INTERCEPT_SPEED_THRESHOLDS in
// constants/game.ts (the numeric speed threshold each tier maps to) and useGameState.ts's
// AIM_START/STRIKE cases, which compare a live Math.hypot(puck.vx, puck.vy) against it. The
// puck keeps moving in real time for the whole intercept drag (see GameState.interceptAim) -
// this is NOT the same thing as stepPhysics' own STOP_THRESHOLD, which is untouched and still
// governs when the puck naturally comes to rest on its own if nobody intercepts it. 'low' matches
// STOP_THRESHOLD exactly, which is mathematically an empty intercept window (see
// INTERCEPT_SPEED_THRESHOLDS' own comment) - so existing rounds default to unchanged behavior.
export type InterceptSpeed = 'low' | 'medium' | 'high'

// How far the aim chevron trajectory preview is allowed to reach - see
// SHOT_PREVIEW_LENGTH_RATIOS in constants/game.ts (the fraction of board.width each tier maps
// to) and Board.tsx's chevron rendering, where it caps how many bounce waypoints (from
// computeTrajectory in utils/physics.ts) the preview can walk before truncating. 'off' shows no
// preview at all.
export type ShotPreviewLength = 'off' | 'short' | 'medium' | 'long'

// Box Hockey's own settings, stored under the `settings` key BoxHockey 1.0 saved them under (see
// redux/settingsSlice.ts). A 1.0 player's saved blob also still holds that build's gameMode,
// lockOrientation, lockedRotation and deferBottomEdgeGestures; nothing reads them here any more
// (seat 2 and the pack-wide settings are the shell's now, seeded from them once by pack.ts).
export interface Settings {
  boardVariant: BoardVariant
  scoreToWin: number
  aiDifficulty: AiDifficulty
  tipoffMode: TipoffMode
  friction: FrictionLevel
  shotPreviewLength: ShotPreviewLength
  puckSize: PuckSizeLevel
  interceptSpeed: InterceptSpeed
  // Per-player - see ControlScheme's own doc comment above. Keyed by Player (1 | 2) the same
  // Record<Player, T> shape LightCycles' keyScheme setting uses, for the same reason: two people
  // share one device and may want a different input feel each.
  controlScheme: Record<Player, ControlScheme>
  // Independent of boardVariant - per explicit correction, "rink" was originally its own 4th,
  // mutually-exclusive BoardVariant, but the rounded-corner/behind-goal-pocket/wraparound treatment
  // it added is really an orthogonal modifier, not a different obstacle layout: it now layers on
  // top of whichever boardVariant is picked (see computeBoardLayout in utils/board.ts, which takes
  // this as its own `rink` parameter alongside `variant`). The goalpost-based goal-mouth mechanic
  // this setting used to gate (see GoalPost's own comment) is NOT part of what this toggles anymore
  // - per explicit correction, that's preferred over the old plain-gap goal line unconditionally,
  // so it's built for every variant regardless of this setting's value (see buildGoalPosts). All
  // this setting still controls is cornerRadius/behindGoalDepth: on, the boards get rounded outer
  // corners and a real pocket behind each goal to skate around in (plus the one-way door guarding
  // it); off, both are 0 and the goal line is simply permeable - a puck whose center clears the
  // posts and the line scores immediately, with no depth behind it to travel into. Off by default,
  // matching every other variant's original, pre-rink-work behavior.
  rink: boolean
}

export interface Obstacle {
  x: number
  y: number
  width: number
  height: number
}

// A small round peg at one edge of a goal mouth - built for EVERY board variant (see
// buildGoalPosts in utils/board.ts), independent of the rink pocket/wraparound setting (see
// Settings.rink's own comment). Deliberately its own shape, not an Obstacle: a post is round
// (real hockey posts are cylinders, and circleVsCircle gives a true curved deflection unlike a
// rect's flat faces/hard corners) and colored per-goal rather than the neutral wall color (see
// GoalPost.player).
export interface GoalPost {
  x: number
  y: number
  radius: number
  // Whose goal this post belongs to - p1Color/p2Color in Board.tsx use this to color the post the
  // same as that goal's own crease/line, rather than the neutral wall color every other obstacle
  // gets. Also used by stepPhysics/computeTrajectory to identify which of wasBehindTop/
  // wasBehindBottom gates this post's collision (player 2 == the top goal's posts, player 1 == the
  // bottom goal's - see buildGoalPosts) - a puck already fully behind that post's own goal line
  // shouldn't still clang off it from the pocket side (see that gate's own comment).
  player: Player
}

// A small round peg capping one edge of a divider/gauntlet-wall gap - purely decorative (see
// buildWallPosts in utils/board.ts). The corresponding Obstacle rect's own corner already
// collides correctly at this exact point (rect-vs-circle collision clamps to the rect's nearest
// point, including its corners), so this carries no `player` field (unlike GoalPost) and is
// rendered in the neutral wallColor, not a per-goal accent color. Built for every variant and
// mode, including rink - see BoardLayout.wallPosts.
export interface WallPost {
  x: number
  y: number
  radius: number
}

export interface GravityWell {
  x: number
  y: number
  radius: number // influence radius (px); force is 0 at/beyond this distance
  strength: number // signed peak accel at well center; + = attract, − = repel
  // true = this well applies even to a puck at rest, bypassing the STOP_THRESHOLD gate that
  // otherwise stops applyGravityWellForces entirely below that speed (see its own doc comment) -
  // for wells whose entire purpose is to actively evict a stalled puck (corner repellers) rather
  // than pull it toward a resting equilibrium. Default/undefined keeps today's gated behavior;
  // only ever set true on a repeller, never an attractor (see gravity in utils/board.ts).
  activeAtRest?: boolean
}

export interface BoardLayout {
  x: number
  y: number
  width: number
  height: number
  wallThickness: number
  goalWidth: number
  goalLeft: number
  goalRight: number
  puckRadius: number
  centerX: number
  centerY: number
  obstacles: Obstacle[]
  gravityWells: GravityWell[]
  // Both goal mouths' posts - always populated, on every variant, regardless of the `rink` pocket
  // setting (see Settings.rink's own comment). See GoalPost's own comment for why these aren't
  // just more Obstacles.
  goalPosts: GoalPost[]
  // Decorative pegs capping each divider/gauntlet-wall gap's edges - see WallPost's own comment.
  // Always populated, in every mode including rink (wallThickness is goal-line-thin everywhere
  // now - see computeBoardLayout).
  wallPosts: WallPost[]
  // Both 0 unless Settings.rink is on - see computeBoardLayout in utils/board.ts.
  cornerRadius: number // rounded-corner radius at the 4 outer boundary corners
  behindGoalDepth: number // how far the true collision boundary extends past board.y/board.y+height behind each goal
  // How far each faceoff dot sits from its own goal line, as a fraction of height/2 - see
  // faceoffZoneCenters in utils/board.ts, which is the only reader. 0.42 (today's value) on every
  // variant except 'gauntlet', whose walls at y-fractions 0.25/0.75 (see buildObstacles'
  // 'gauntlet' case) sit too close to the default 0.42 for the dots to clear them - pulling
  // the dots in for that one variant is the "tweak to the faceoff zones" a wall-position change
  // can require.
  faceoffOffsetYRatio: number
  // What the board's own screen container should set as its top margin, in place of the raw
  // safe-area inset - see computeBoardLayout's own comment. Equal to insets.top whenever
  // Settings.rink is off, which "borrows" up to insets.top worth of the otherwise-empty
  // status-bar/notch space for its behind-the-goal pocket instead of shrinking the front-line
  // field for all of it when rink is on - the two coordinate systems (board.x/y here, and the
  // screen container's own layout) have to agree on where the container's origin actually is, so
  // this is the single source of truth for both, rather than every consumer separately reaching
  // for insets.top.
  boardMarginTop: number
}

export interface PuckState {
  x: number
  y: number
  vx: number
  vy: number
}

export interface AimIndicator {
  startX: number
  startY: number
  currentX: number
  currentY: number
  // Live release-velocity ESTIMATE (points/sec), smoothed (see AIM_VELOCITY_SMOOTHING_ALPHA in
  // constants/game.ts) - display-only, drives Board.tsx's live stick/chevron preview. The actual
  // shot fired on release reads the raw, unsmoothed velocity straight off the gesture event, never
  // this field - see useGameState.ts's STRIKE case.
  vx: number
  vy: number
  // 'stick' scheme only: whether the blade is clear of the puck right now (see utils/stick.ts). A
  // blade that lands on the puck has to leave it before it can hit; Board.tsx shows the aim line
  // only while it's clear.
  stickClear?: boolean
}

export interface PendingShot {
  vx: number
  vy: number
}

// Tip-off tap-race state, live only while phase === 'faceoff' (null otherwise). goAt is set the
// moment the post-countdown hold BEGINS, not when it ends/'live' fires - FACEOFF_TAP classifies a
// tap by comparing its own timestamp against this already-known value rather than against `stage`,
// since the hold timer and a tap's gesture-thread dispatch are two independent, unsynchronized
// delivery paths whose dispatch()-arrival order isn't guaranteed to match true wall-clock order
// (see useGameState.ts's FACEOFF_TAP case).
export interface FaceoffState {
  // Every draw - the game's first and every one after a goal - opens on 'ready': a linesman
  // doesn't drop the puck until both players are set, so the countdown doesn't start until both
  // have signaled ready (see FACEOFF_READY in useGameState.ts).
  stage: 'ready' | 'countdown' | 'hold' | 'live' | 'resolved'
  // Meaningful only during 'ready' - index 0 = P1 has signaled ready, 1 = P2.
  ready: [boolean, boolean]
  count: 3 | 2 | 1 | null
  // Which of each player's two rink faceoff dots (see faceoffZoneCenter in utils/board.ts) is
  // this draw's actual press target - index 0 = P1's zone, 1 = P2's. Randomized fresh per draw by
  // the caller (same discipline as coinFlipWinner/zoneIndex in useGameState.ts) so a player can't
  // rest a finger on a known spot ahead of time; they have to watch for the color flip and tap
  // wherever it actually happens (see game.tsx's stableFaceoffTap and Board.tsx's rendering).
  zones: [0 | 1, 0 | 1]
  // A per-player, per-draw blind guess at their own zones[idx] - index 0 = P1, 1 = P2 - randomized
  // fresh alongside `zones` itself by the SAME caller (never inside the reducer, same discipline
  // as zones/coinFlipWinner), completely independent of ready/where either player actually taps to
  // signal ready. Deliberately NOT informed by anything (not tied to tap position, not biased by
  // AI difficulty for a CPU player) - pure 50/50 luck for both sides alike, guessed before either
  // player has any way to know the real answer. A correct guess (readyGuess[idx] === zones[idx])
  // earns that player a small effective reaction-time bonus in FACEOFF_TAP's head-to-head race
  // resolution (see FACEOFF_GUESS_BONUS_MS in constants/game.ts) - close enough a margin that it
  // can occasionally flip who wins the draw, not just how hard the winning knock lands.
  readyGuess: [0 | 1, 0 | 1]
  goAt: number | null
  // Only ever set by a CORRECT-zone press (see FACEOFF_TAP in useGameState.ts) - a wrong-zone
  // press sets `disqualified` instead, never `tapAt`. This is what supplies a winner's own
  // reactionMs (tapAt - goAt) for computeFaceoffKnock's power calculation, so it must only ever
  // reflect a genuine press by that player, not a stand-in for "this player is done."
  tapAt: [number | null, number | null]
  // Index 0/1 = that player pressed the WRONG zone this draw and can no longer win it. Set
  // instantly on a wrong press, but unlike the old instant-forfeit behavior this does NOT resolve
  // the draw by itself - the other player still has to land (or fail to land) their own real
  // press before `result` is set, so a winner's knock power always comes from a genuine reactionMs
  // rather than an automatic max (see useGameState.ts's FACEOFF_TAP case).
  disqualified: [boolean, boolean]
  // Set to the raw press timestamp on EVERY FACEOFF_TAP for that player - right zone or wrong -
  // completely independent of tapAt/disqualified/result above (which only ever reflect a
  // CORRECT press or a wrong-zone forfeit respectively) and never itself read for win/knock
  // determination. Exists purely so a visual layer (Board.tsx's press ripple) can react to ANY
  // press the instant it lands, including a CPU press (useFaceoff.ts dispatches straight to the
  // reducer, bypassing game.tsx's client-side tap feedback entirely) or a wrong-zone human press,
  // neither of which tapAt ever records. Reset to [null, null] at the same three call sites as
  // tapAt/disqualified (see initialFaceoffState in useGameState.ts) so a ripple from a previous
  // draw never leaks into the next one.
  pressFlash: [number | null, number | null]
  // forfeit: true means the winner is credited by default (opponent's wrong-zone press or
  // timeout) rather than a genuine two-sided race - marginMs is pinned to FACEOFF_MARGIN_MAX_MS
  // ("no defense") in this case, but reactionMs still reflects the winner's own real press (or, in
  // the rare case they never pressed either, FACEOFF_REACTION_MAX_MS) - a forfeit no longer
  // implies max knock power on its own (see computeFaceoffKnock in utils/faceoff.ts).
  result: { winner: Player; marginMs: number; reactionMs: number; forfeit: boolean } | null
}

// 'tripleTap' tip-off state - see TipoffMode's own doc comment. Set while phase === 'tripleTap',
// and kept for TRIPLE_TAP_CLASH_WINDOW_MS after the first swipe launches the puck (phase is
// 'simulating' by then) so the other player's late swipe can still clash, and Board.tsx can finish
// drawing both swipes. TRIPLE_TAP_CLASH_END clears it.
export interface TripleTapState {
  // Taps landed per player (index 0 = P1, 1 = P2), 0..TRIPLE_TAP_TAPS. A tap only counts while the
  // player isn't already ahead of the other (see TRIPLE_TAP_PRESS), which is what keeps them in step.
  tapCount: [number, number]
  // Timestamp of each player's last counted tap or swipe - a visual ripple trigger for Board.tsx,
  // mirroring FaceoffState.pressFlash.
  pressFlash: [number | null, number | null]
  // Each player's own captured swipe velocity (flick power), set once and never overwritten. The
  // first one set is the one that launched the puck.
  swipe: [{ vx: number; vy: number } | null, { vx: number; vy: number } | null]
  // While non-null, a swipe from the player who didn't launch, at or before this time, clashes.
  // Set by the launching swipe, cleared by the clash itself.
  clashUntil: number | null
}

export interface GameState {
  phase: GamePhase
  currentPlayer: Player
  scores: [number, number]
  puck: PuckState
  aim: AimIndicator | null
  // Mirrors `aim`'s exact shape, but tracks a mid-slide intercept attempt (see InterceptSpeed's own
  // doc comment) instead of a normal turn's aim - kept as a SEPARATE field, not a repurposed `aim`,
  // specifically so `phase` can stay 'simulating' (keeping useGameLoop's PHYSICS_STEP dispatch
  // alive, so the original puck keeps coasting/bouncing for real) for the whole drag instead of
  // flipping to 'aiming', which would freeze it. Only ever non-null while phase === 'simulating';
  // STRIKE copies it into `aim` and clears it the instant the interceptor actually releases.
  interceptAim: AimIndicator | null
  pendingShot: PendingShot | null
  bounceCount: number
  lastScoredGoal: 'top' | 'bottom' | null
  wellEnterCount: number
  lastWellPolarity: 'attract' | 'repel' | null
  // Same "counter + kind" shape as wellEnterCount/lastWellPolarity above - bumped whenever
  // stepPhysics reports the puck struck the invisible one-way door at the goal mouth (only
  // reachable when Settings.rink is on), so Board.tsx can flash that goal's own color right in
  // the visual gap between the posts. Never reset between rounds/games (same as bounceCount) -
  // Board.tsx guards against a stale nonzero value on mount by diffing against a ref, not by
  // expecting this to come back to 0.
  goalDoorHitCount: number
  lastGoalDoorSide: 'top' | 'bottom' | null
  faceoff: FaceoffState | null
  // Bumped every time a fresh tip-off draw begins (game start, post-goal restart, or a restart
  // when a pause clears mid-race, the app being backgrounded included - see useFaceoff.ts). A
  // primitive counter rather than keying off `faceoff`'s own object identity, which changes on
  // every sub-action dispatch (count ticks, taps, ...) and would make it impossible for an effect
  // to distinguish "a real new draw started" from "the same draw progressed" using object identity
  // alone.
  faceoffRound: number
  tripleTap: TripleTapState | null
  // Same "bump on a genuinely new draw" discipline as faceoffRound above - lets useTripleTap.ts's
  // CPU-timer effects key on "a new draw started" rather than every sub-action's new object
  // reference (each tap, each swipe).
  tripleTapRound: number
}

// ─── Stats & achievements ───────────────────────────────────────────────────
// Tier, unlock-map and definition types come from @tastic/achievements; the shapes below are
// BoxHockey's own - what this game tracks (per-variant records, goals, shutouts, win margins)
// is nothing another game would carry, which is exactly why that package stays generic over it.
export type { AchievementTier, UnlockedAchievementsState } from '@tastic/achievements'
export type AchievementDefinition = BaseAchievementDefinition<StatsState>

export type MatchRecord = OutcomeRecord

// The human's own record against the CPU - the human is always seat 1 in vsCpu mode (see
// hooks/useAIOpponent.ts). A draw is impossible in BoxHockey (a match ends the instant one side
// reaches scoreToWin), so `draws` here stays 0 forever; the field rides along because
// @tastic/achievements' applyResult maintains the whole quadruple, and a shape that matches the
// helper is worth more than a field saved.
export interface VsCpuStats extends OutcomeRecord, WinStreakState {
  byDifficulty: Record<AiDifficulty, MatchRecord>
}

// Tallied by SEAT, not by person - p1Wins/p2Wins is the whole point, so this isn't an OutcomeRecord.
export interface TwoPlayerStats {
  played: number
  p1Wins: number
  p2Wins: number
}

// Goals for/against across every match, both modes - the raw counters behind the scoring
// achievements. Seat 1's perspective device-wide; the profile's own perspective in a profile bucket.
export interface GoalTotals {
  scored: number
  conceded: number
}

export interface ProfileStats extends DayStreakState {
  vsCpu: VsCpuStats
  twoPlayer: TwoPlayerStats
  variants: Record<BoardVariant, MatchRecord>
  goals: GoalTotals
  shutouts: number
  bestWinMargin: number
}

export interface StatsState extends ProfileStats {
  profiles: Record<string, ProfileStats>
  // Set once, on the very first match ever recorded, from seat 1's perspective - powers the
  // one-off "your first game ever was a win" achievement, which cumulative totals can't express.
  firstGameResult: RoundResult | null
}
