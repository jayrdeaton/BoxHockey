export type Player = 1 | 2

export type GamePhase = 'idle' | 'aiming' | 'striking' | 'simulating' | 'scored' | 'gameOver' | 'faceoff'

export type BoardVariant = 'classic' | 'gauntlet' | 'gauntletPlus' | 'gravity' | 'gravityClassic' | 'rink'

export type GameMode = 'twoPlayer' | 'vsCpu'

// How possession is decided at the start of a game and (for 'faceoff' only) after every goal —
// see useFaceoff.ts. Neither mode announces a winner — the puck's own landing spot/color says it
// (see game.tsx and Board.tsx). 'coinFlip' is the lighter-weight option: no separate phase at all,
// it's resolved instantly by placing the puck at a random one of the current player's own rink
// faceoff dots (see faceoffZoneCenter in utils/board.ts) — normal alternating turns then handle
// everything else exactly as they already do. 'faceoff' is the real hockey rule: a 3-2-1-tap-race
// mini-game, every single score, whose margin of victory knocks the puck toward the loser (see
// computeFaceoffKnock in utils/faceoff.ts).
export type TipoffMode = 'coinFlip' | 'faceoff'

// Seating arrangement for the loadout screen's player panels — 'portrait' splits it into a
// face-to-face layout (P2's panel rotated 180° so it reads right-side-up from across the table),
// 'landscape' places both panels upright side by side. Derived live from the device's current
// physical shape (see useDeviceOrientation) rather than a stored preference — turn the phone
// sideways and /loadout follows immediately. /game always stays locked portrait regardless (see
// its own useOrientationLock call) — the board's fixed top/bottom goal geometry assumes a
// tall aspect ratio, unlike /loadout's panel arrangement, which reads fine either way.
export type OrientationMode = 'portrait' | 'landscape'

// Per-round puck deceleration tier — see FRICTION_LEVELS in constants/game.ts (the numeric
// coefficient each level maps to) and stepPhysics in utils/physics.ts (where it's actually
// applied as frictionFactor = FRICTION_LEVELS[level] ** dt). 'medium' matches the single fixed
// FRICTION constant this setting replaces, so existing rounds default to unchanged behavior.
export type FrictionLevel = 'low' | 'medium' | 'high'

// Per-round puck radius tier — see PUCK_SIZE_RATIOS in constants/game.ts (the fraction of
// board.width each tier maps to) and computeBoardLayout in utils/board.ts, where it's the one
// source of puckRadius. 'medium' matches the single fixed PUCK_RADIUS_RATIO constant this setting
// replaces, so existing rounds default to unchanged behavior. The goal opening and the classic
// board's center-divider holes are BOTH sized directly off puckRadius (see
// DIVIDER_HOLE_TO_PUCK_RADIUS in constants/game.ts) rather than off board.width independently, so
// changing puck size scales the goal and the divider gaps together, in lockstep — a bigger puck
// gets a bigger goal and bigger gaps to match, not a fixed-size goal that just gets easier/harder.
export type PuckSizeLevel = 'small' | 'medium' | 'large'

// How far the aim chevron trajectory preview is allowed to reach — see
// SHOT_PREVIEW_LENGTH_RATIOS in constants/game.ts (the fraction of board.width each tier maps
// to) and Board.tsx's chevron rendering, where it caps how many bounce waypoints (from
// computeTrajectory in utils/physics.ts) the preview can walk before truncating. 'off' shows no
// preview at all.
export type ShotPreviewLength = 'off' | 'short' | 'medium' | 'long'

export interface GameSettings {
  gameMode: GameMode
  boardVariant: BoardVariant
  scoreToWin: number
  aiDifficulty: 'easy' | 'medium' | 'hard'
  // Opt-in — see useOrientationLock. Off by default: /loadout's panel arrangement just follows
  // however the phone is actually being held, rather than being a stored preference itself.
  lockOrientation: boolean
  tipoffMode: TipoffMode
  friction: FrictionLevel
  shotPreviewLength: ShotPreviewLength
  puckSize: PuckSizeLevel
}

export interface Obstacle {
  x: number
  y: number
  width: number
  height: number
}

export interface GravityWell {
  x: number
  y: number
  radius: number // influence radius (px); force is 0 at/beyond this distance
  strength: number // signed peak accel at well center; + = attract, − = repel
  // true = this well applies even to a puck at rest, bypassing the STOP_THRESHOLD gate that
  // otherwise stops applyGravityWellForces entirely below that speed (see its own doc comment) —
  // for wells whose entire purpose is to actively evict a stalled puck (corner repellers) rather
  // than pull it toward a resting equilibrium. Default/undefined keeps today's gated behavior;
  // only ever set true on a repeller, never an attractor (see gravityClassic in utils/board.ts).
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
  // Both 0 for every variant except 'rink' — see buildRinkGeometry in utils/board.ts.
  cornerRadius: number // rounded-corner radius at the 4 outer boundary corners
  behindGoalDepth: number // how far the true collision boundary extends past board.y/board.y+height behind each goal
  // How far each faceoff dot sits from its own goal line, as a fraction of height/2 — see
  // faceoffZoneCenters in utils/board.ts, which is the only reader. 0.42 (today's value) on every
  // variant except 'gauntletPlus', whose walls at y-fractions 0.25/0.75 (see buildObstacles'
  // 'gauntletPlus' case) sit too close to the default 0.42 for the dots to clear them — pulling
  // the dots in for that one variant is the "tweak to the faceoff zones" a wall-position change
  // can require.
  faceoffOffsetYRatio: number
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
}

export interface PendingShot {
  vx: number
  vy: number
}

// Tip-off tap-race state, live only while phase === 'faceoff' (null otherwise). goAt is set the
// moment the post-countdown hold BEGINS, not when it ends/'live' fires — FACEOFF_TAP classifies a
// tap by comparing its own timestamp against this already-known value rather than against `stage`,
// since the hold timer and a tap's gesture-thread dispatch are two independent, unsynchronized
// delivery paths whose dispatch()-arrival order isn't guaranteed to match true wall-clock order
// (see useGameState.ts's FACEOFF_TAP case).
export interface FaceoffState {
  // 'ready' only ever appears on the game's very first draw (requiresReady below) — a linesman
  // doesn't drop the puck until both players are set, so the countdown itself doesn't start until
  // both have signaled ready (see FACEOFF_READY in useGameState.ts). Every later draw (after a
  // goal) skips straight to 'countdown' — mid-game players are already engaged, and gating every
  // single draw would just add drag.
  stage: 'ready' | 'countdown' | 'hold' | 'live' | 'resolved'
  // Meaningful only during 'ready' — index 0 = P1 has signaled ready, 1 = P2.
  ready: [boolean, boolean]
  // Whether THIS draw ever needed the ready-check — true only for the game's first draw, false
  // for every post-goal one. Persisted for the draw's whole lifetime (not just while stage ===
  // 'ready') so FACEOFF_RESTART (app backgrounded mid-race) can tell which behavior to resume
  // into, since faceoffRound itself bumps on every restart and can't answer "was this the first
  // draw" on its own past the first bump.
  requiresReady: boolean
  count: 3 | 2 | 1 | null
  // Which of each player's two rink faceoff dots (see faceoffZoneCenter in utils/board.ts) is
  // this draw's actual press target — index 0 = P1's zone, 1 = P2's. Randomized fresh per draw by
  // the caller (same discipline as coinFlipWinner/zoneIndex in useGameState.ts) so a player can't
  // rest a finger on a known spot ahead of time; they have to watch for the color flip and tap
  // wherever it actually happens (see game.tsx's stableFaceoffTap and Board.tsx's rendering).
  zones: [0 | 1, 0 | 1]
  goAt: number | null
  // Only ever set by a CORRECT-zone press (see FACEOFF_TAP in useGameState.ts) — a wrong-zone
  // press sets `disqualified` instead, never `tapAt`. This is what supplies a winner's own
  // reactionMs (tapAt - goAt) for computeFaceoffKnock's power calculation, so it must only ever
  // reflect a genuine press by that player, not a stand-in for "this player is done."
  tapAt: [number | null, number | null]
  // Index 0/1 = that player pressed the WRONG zone this draw and can no longer win it. Set
  // instantly on a wrong press, but unlike the old instant-forfeit behavior this does NOT resolve
  // the draw by itself — the other player still has to land (or fail to land) their own real
  // press before `result` is set, so a winner's knock power always comes from a genuine reactionMs
  // rather than an automatic max (see useGameState.ts's FACEOFF_TAP case).
  disqualified: [boolean, boolean]
  // Set to the raw press timestamp on EVERY FACEOFF_TAP for that player — right zone or wrong —
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
  // timeout) rather than a genuine two-sided race — marginMs is pinned to FACEOFF_MARGIN_MAX_MS
  // ("no defense") in this case, but reactionMs still reflects the winner's own real press (or, in
  // the rare case they never pressed either, FACEOFF_REACTION_MAX_MS) — a forfeit no longer
  // implies max knock power on its own (see computeFaceoffKnock in utils/faceoff.ts).
  result: { winner: Player; marginMs: number; reactionMs: number; forfeit: boolean } | null
}

export interface GameState {
  phase: GamePhase
  currentPlayer: Player
  scores: [number, number]
  puck: PuckState
  aim: AimIndicator | null
  pendingShot: PendingShot | null
  bounceCount: number
  lastScoredGoal: 'top' | 'bottom' | null
  wellEnterCount: number
  lastWellPolarity: 'attract' | 'repel' | null
  faceoff: FaceoffState | null
  // Bumped every time a fresh tip-off draw begins (game start, post-goal restart, or an
  // AppState-triggered restart after the app was backgrounded mid-race — see useFaceoff.ts). A
  // primitive counter rather than keying off `faceoff`'s own object identity, which changes on
  // every sub-action dispatch (count ticks, taps, ...) and would make it impossible for an effect
  // to distinguish "a real new draw started" from "the same draw progressed" using object identity
  // alone.
  faceoffRound: number
}
