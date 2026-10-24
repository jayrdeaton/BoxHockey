// Drives the real reducer (makeReducer in src/hooks/useGameState.ts) through hundreds of full
// rounds - faceoffs, launches, physics simulation to a stop/score, and plain idle->aiming->
// striking->simulating shots - via pure dispatch() calls, no React, no timers. Regression
// coverage for a real reported bug: this is a turn-based game (box hockey), not soccer - a miss
// always passes the turn to the other player, in EVERY tipoff mode, never just off the back of a
// goal. tipoffMode only changes HOW the very first shooter of the game (and, in 'faceoff' mode,
// every post-goal shooter) is decided; in 'coinFlip' mode it also decides which player's own zone
// the puck starts at after a goal (the conceding player gets it - see NEXT_ROUND's own comment in
// useGameState.ts) - but never whether an ordinary miss changes possession mid-rally. This
// includes the faceoff winner's own knock (see FACEOFF_LAUNCH's own comment in useGameState.ts):
// real user feedback, explicit, that the winner must NEVER get a follow-up shot off their own
// knock - on a MISS the loser always takes the very next real turn, no exceptions. On a GOAL, the
// rule is really "the conceding player always takes the next turn" (soccer-style, see PHYSICS_
// STEP's 'scored' branch in useGameState.ts) - ordinarily identical to "the loser", since the
// winner's knock scores in the loser's net, but the two diverge on the rare own goal where the
// winner's own knock ricochets into the WINNER's own net: the winner conceded that one, so the
// winner (not the loser) gets the puck back. Regression coverage for exactly that gap: an earlier
// version always flipped to otherPlayer(shooter)/otherPlayer(winner) on ANY goal, which happened to
// match "conceding player" in the ordinary case but handed the puck to the wrong player - the
// beneficiary, not the conceder - on an own goal.

import { CONTROL_SCHEME_SIGN, FRICTION_LEVELS, MAX_FLICK_VELOCITY, MIN_FLICK_VELOCITY, MIN_SHOOT_DRAG } from '@/games/boxhockey/constants/game'
import { makeReducer } from '@/games/boxhockey/hooks/useGameState'
import { BoardLayout, ControlScheme, FaceoffState, GameState, Player, TipoffMode } from '@/games/boxhockey/types'
import { computeFaceoffKnock } from '@/games/boxhockey/utils/faceoff'

// ─── Board fixture (same synthetic board physics.test.ts uses - no obstacles, no gravity wells,
// no goalposts, cornerRadius 0 / behindGoalDepth 0, so geometry is the simplest possible flat
// rectangle with a permeable goal slot top and bottom). Friction + wall restitution guarantee any
// launched puck decays below STOP_THRESHOLD in a bounded number of steps regardless of how it's
// aimed, so a fixed iteration cap on PHYSICS_STEP is safe. ────────────────────────────────────
const board: BoardLayout = {
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

const CONTROL_SCHEME: Record<Player, ControlScheme> = { 1: 'pull', 2: 'pull' }
const SCORE_TO_WIN_NEVER = 999 // long uninterrupted rallies - game should never actually end
const MAX_PHYSICS_STEPS = 2000

function other(p: Player): Player {
  return p === 1 ? 2 : 1
}

// ─── Seeded PRNG (mulberry32) - deterministic so a failure is reproducible from the seed alone. ──
function mulberry32(seed: number) {
  let s = seed
  return function (): number {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number

function randPlayer(rng: Rng): Player {
  return rng() < 0.5 ? 1 : 2
}
function randZoneIndex(rng: Rng): 0 | 1 {
  return rng() < 0.5 ? 0 : 1
}
function randFaceoffZones(rng: Rng): [0 | 1, 0 | 1] {
  return [randZoneIndex(rng), randZoneIndex(rng)]
}
function randReadyGuess(rng: Rng): [0 | 1, 0 | 1] {
  return [randZoneIndex(rng), randZoneIndex(rng)]
}

// A structurally-valid GameState only ever used as the throwaway "previous state" argument to a
// RESET dispatch, whose reducer case ignores it entirely and returns a freshly-built initial
// state regardless of what's passed in here.
const DUMMY_STATE: GameState = {
  phase: 'idle',
  currentPlayer: 1,
  scores: [0, 0],
  puck: { x: 0, y: 0, vx: 0, vy: 0 },
  aim: null,
  interceptAim: null,
  pendingShot: null,
  bounceCount: 0,
  lastScoredGoal: null,
  wellEnterCount: 0,
  lastWellPolarity: null,
  goalDoorHitCount: 0,
  lastGoalDoorSide: null,
  faceoff: null,
  faceoffRound: 0,
  tripleTap: null,
  tripleTapRound: 0
}

type Reducer = (state: GameState, action: Parameters<ReturnType<typeof makeReducer>>[1]) => GameState

// Drag vector (dx, dy - cosmetic pixel-space target for the AIM_UPDATE dispatch below, no longer
// power-bearing) and velocity vector (vx, vy - the actual power/direction STRIKE fires with, once
// it applies the shooting player's own ControlScheme sign) sharing one direction toward `player`'s
// attacking goal - with random x jitter (so shots sometimes score, sometimes miss wide) and random
// power (so rallies vary in length).
function randomDragForPlayer(rng: Rng, player: Player, puckX: number, puckY: number, controlScheme: Record<Player, ControlScheme>): { dx: number; dy: number; vx: number; vy: number } {
  const targetY = player === 1 ? board.y - 20 : board.y + board.height + 20
  const targetX = board.centerX + (rng() - 0.5) * board.width * 0.9
  const rawDx = targetX - puckX
  const rawDy = targetY - puckY
  const norm = Math.hypot(rawDx, rawDy) || 1
  const dirX = rawDx / norm
  const dirY = rawDy / norm
  const dragMag = MIN_SHOOT_DRAG * 1.5 + rng() * 140
  const velMag = MIN_FLICK_VELOCITY * 1.5 + rng() * (MAX_FLICK_VELOCITY - MIN_FLICK_VELOCITY * 1.5)
  const sign = CONTROL_SCHEME_SIGN[controlScheme[player]]
  // sign * (sign * dirX) === dirX, so this always yields a final velocity direction of
  // (dirX, dirY) regardless of which ControlScheme sign STRIKE applies. dragMag/velMag are sized
  // to clear both pull/push's distance gate and flick's distance+speed gate at once, so the same
  // synthesized gesture works unmodified for whichever scheme is passed in.
  return { dx: sign * dirX * dragMag, dy: sign * dirY * dragMag, vx: sign * dirX * velMag, vy: sign * dirY * velMag }
}

function runPhysicsToStop(reducer: Reducer, state: GameState, log: unknown[]): GameState {
  let s = state
  let steps = 0
  while (s.phase === 'simulating' && steps < MAX_PHYSICS_STEPS) {
    s = reducer(s, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    steps++
  }
  log.push({ physicsSteps: steps, endedPhase: s.phase })
  if (s.phase === 'simulating') {
    throw new Error(`PHYSICS_STEP did not resolve within ${MAX_PHYSICS_STEPS} steps. Log:\n${JSON.stringify(log, null, 2)}`)
  }
  return s
}

type ResolutionMode = 'raceP1Faster' | 'raceP2Faster' | 'raceTie' | 'wrongThenCorrect' | 'correctThenWrong' | 'bothWrong' | 'timeoutOnePressed' | 'timeoutNeitherPressed'

const RESOLUTION_MODES: ResolutionMode[] = ['raceP1Faster', 'raceP2Faster', 'raceTie', 'wrongThenCorrect', 'correctThenWrong', 'bothWrong', 'timeoutOnePressed', 'timeoutNeitherPressed']

function pickResolutionMode(rng: Rng): ResolutionMode {
  return RESOLUTION_MODES[Math.floor(rng() * RESOLUTION_MODES.length)]
}

// Resolves one live faceoff draw (state.faceoff.stage === 'live') down to 'resolved', covering
// every FACEOFF_TAP/FACEOFF_TIMEOUT resolution path in the reducer: a genuine race (either player
// faster, or an exact tie), a wrong-zone disqualification followed by the other player's real
// press (in both orders), both players disqualifying themselves, and a timeout (with the other
// player having pressed, or with total silence).
function resolveFaceoffDraw(reducer: Reducer, state: GameState, rng: Rng, mode: ResolutionMode, log: unknown[]): GameState {
  const fo = state.faceoff as FaceoffState
  const zones = fo.zones
  const goAt = fo.goAt
  if (goAt === null) throw new Error('expected goAt to be set before resolving a draw')
  const correctZone = (p: Player): 0 | 1 => zones[p - 1]
  const wrongZone = (p: Player): 0 | 1 => (zones[p - 1] === 0 ? 1 : 0)

  let s = state
  const dispatch = (action: Parameters<Reducer>[1]) => {
    s = reducer(s, action)
    log.push(action)
  }

  switch (mode) {
    case 'raceP1Faster': {
      const r1 = goAt + 20 + rng() * 100
      const r2 = r1 + 10 + rng() * 200
      dispatch({ type: 'FACEOFF_TAP', player: 1, atMs: r1, zoneIndex: correctZone(1) })
      dispatch({ type: 'FACEOFF_TAP', player: 2, atMs: r2, zoneIndex: correctZone(2) })
      break
    }
    case 'raceP2Faster': {
      const r2 = goAt + 20 + rng() * 100
      const r1 = r2 + 10 + rng() * 200
      dispatch({ type: 'FACEOFF_TAP', player: 2, atMs: r2, zoneIndex: correctZone(2) })
      dispatch({ type: 'FACEOFF_TAP', player: 1, atMs: r1, zoneIndex: correctZone(1) })
      break
    }
    case 'raceTie': {
      const t = goAt + 50 + rng() * 100
      dispatch({ type: 'FACEOFF_TAP', player: 1, atMs: t, zoneIndex: correctZone(1) })
      dispatch({ type: 'FACEOFF_TAP', player: 2, atMs: t, zoneIndex: correctZone(2) })
      break
    }
    case 'wrongThenCorrect': {
      dispatch({ type: 'FACEOFF_TAP', player: 1, atMs: goAt + 30, zoneIndex: wrongZone(1) })
      dispatch({ type: 'FACEOFF_TAP', player: 2, atMs: goAt + 80, zoneIndex: correctZone(2) })
      break
    }
    case 'correctThenWrong': {
      dispatch({ type: 'FACEOFF_TAP', player: 1, atMs: goAt + 30, zoneIndex: correctZone(1) })
      dispatch({ type: 'FACEOFF_TAP', player: 2, atMs: goAt + 80, zoneIndex: wrongZone(2) })
      break
    }
    case 'bothWrong': {
      dispatch({ type: 'FACEOFF_TAP', player: 1, atMs: goAt + 30, zoneIndex: wrongZone(1) })
      dispatch({ type: 'FACEOFF_TAP', player: 2, atMs: goAt + 80, zoneIndex: wrongZone(2) })
      break
    }
    case 'timeoutOnePressed': {
      const presser: Player = randPlayer(rng)
      dispatch({ type: 'FACEOFF_TAP', player: presser, atMs: goAt + 40, zoneIndex: correctZone(presser) })
      dispatch({ type: 'FACEOFF_TIMEOUT', player: other(presser) })
      break
    }
    case 'timeoutNeitherPressed': {
      dispatch({ type: 'FACEOFF_TIMEOUT', player: randPlayer(rng) })
      break
    }
  }

  if (!s.faceoff || s.faceoff.stage !== 'resolved' || !s.faceoff.result) {
    throw new Error(`faceoff draw did not resolve after mode "${mode}". Log:\n${JSON.stringify(log, null, 2)}`)
  }
  return s
}

interface FuzzSummary {
  shots: number
  faceoffDraws: number
  goals: number
  misses: number
  modeCounts: Record<string, number>
}

// Drives one full fuzz run. tipoffMode === 'faceoff' resolves a real tap-race draw at game start
// and after every goal; tipoffMode === 'coinFlip' resolves the coin flip once and never again -
// but a miss still always passes the turn to the other player in both modes (see PHYSICS_STEP's
// 'stopped' branch in useGameState.ts) - only who gets the puck (and where) after a GOAL is
// soccer-style in 'coinFlip' mode.
function driveFuzzRun(tipoffMode: TipoffMode, totalShots: number, seed: number, controlScheme: Record<Player, ControlScheme> = CONTROL_SCHEME): FuzzSummary {
  const reducer = makeReducer(SCORE_TO_WIN_NEVER, tipoffMode, FRICTION_LEVELS.medium, controlScheme, 0)
  const rng = mulberry32(seed)

  let state = reducer(DUMMY_STATE, {
    type: 'RESET',
    board,
    coinFlipWinner: randPlayer(rng),
    zoneIndex: randZoneIndex(rng),
    faceoffZones: randFaceoffZones(rng),
    faceoffReadyGuess: randReadyGuess(rng)
  })

  if (tipoffMode === 'coinFlip') {
    expect(state.phase).toBe('coinFlip')
    state = reducer(state, { type: 'COIN_FLIP_DONE' })
    expect(state.phase).toBe('idle')
  } else {
    expect(state.phase).toBe('faceoff')
  }

  let shots = 0
  let faceoffDraws = 0
  let goals = 0
  let misses = 0
  const modeCounts: Record<string, number> = {}
  // Tracks the shooter of the most recent PLAIN (idle->aiming->striking->simulating) shot, reset
  // to null whenever the chain is broken by a faceoff win or a goal - those are the two
  // legitimate, reducer-decided ways possession can change hands outside the plain miss-flip path.
  let previousPlainShooter: Player | null = null
  // Rolling log of recent actions, for a readable dump if an assertion below ever fails.
  let recentLog: unknown[] = []

  const resetLog = () => {
    recentLog = []
  }

  while (shots < totalShots) {
    if (state.phase === 'faceoff') {
      faceoffDraws++
      resetLog()
      state = reducer(state, { type: 'FACEOFF_READY', player: 1 })
      recentLog.push({ type: 'FACEOFF_READY', player: 1 })
      state = reducer(state, { type: 'FACEOFF_READY', player: 2 })
      recentLog.push({ type: 'FACEOFF_READY', player: 2 })

      if (!state.faceoff || state.faceoff.stage !== 'countdown') {
        throw new Error(`expected 'countdown' after both FACEOFF_READY. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }

      const goAt = 1000 + rng() * 1000
      state = reducer(state, { type: 'FACEOFF_HOLD', goAt })
      recentLog.push({ type: 'FACEOFF_HOLD', goAt })
      state = reducer(state, { type: 'FACEOFF_LIVE' })
      recentLog.push({ type: 'FACEOFF_LIVE' })

      const mode = pickResolutionMode(rng)
      modeCounts[mode] = (modeCounts[mode] ?? 0) + 1
      state = resolveFaceoffDraw(reducer, state, rng, mode, recentLog)

      const winner = state.faceoff!.result!.winner
      const { marginMs, reactionMs } = state.faceoff!.result!
      const knock = computeFaceoffKnock(board, winner, marginMs, reactionMs)
      state = reducer(state, { type: 'FACEOFF_LAUNCH', vx: knock.vx, vy: knock.vy })
      recentLog.push({ type: 'FACEOFF_LAUNCH', vx: knock.vx, vy: knock.vy })

      if (state.phase !== 'simulating') {
        throw new Error(`FACEOFF_LAUNCH did not enter 'simulating'. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }
      if (state.currentPlayer !== winner) {
        throw new Error(`currentPlayer (${state.currentPlayer}) !== faceoff winner (${winner}) right after FACEOFF_LAUNCH. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }

      shots++ // the knock is a genuine physics-simulated attempt, same as any other shot
      const scoresBeforeKnock = state.scores
      state = runPhysicsToStop(reducer, state, recentLog)
      previousPlainShooter = null // a faceoff win legitimately breaks the plain-shot alternation chain

      if (state.phase === 'scored') {
        goals++
        // The CONCEDING player - whoever's net was actually breached - always gets the puck next,
        // soccer-style (see PHYSICS_STEP's own comment in useGameState.ts). Ordinarily that's the
        // loser (the winner's knock scores in the LOSER's net) - same as the "loser always takes
        // the next turn off the winner's knock" framing the top-of-file comment describes. But the
        // winner's own knock can (rarely) ricochet all the way around into the WINNER's own net -
        // an own goal - in which case the WINNER is who conceded and must get the puck back, not
        // the loser. scorer is derived from the actual score delta, not assumed from `winner`, so
        // this holds either way.
        const scorer: Player = state.scores[0] !== scoresBeforeKnock[0] ? 1 : 2
        if (state.currentPlayer !== other(scorer)) {
          throw new Error(`TURN ALTERNATION BUG: after the faceoff winner's (player ${winner}) knock scored for player ${scorer}, ` + `currentPlayer is ${state.currentPlayer} (expected the conceding player, ${other(scorer)}). Action log:\n${JSON.stringify(recentLog, null, 2)}`)
        }
        state = reducer(state, { type: 'NEXT_ROUND', board, zoneIndex: randZoneIndex(rng), faceoffZones: randFaceoffZones(rng), faceoffReadyGuess: randReadyGuess(rng) })
      } else if (state.phase === 'idle') {
        misses++
        // A miss always flips the turn to the other player, no exceptions (see PHYSICS_STEP's
        // 'stopped' branch) - this is the "hit or miss, the winner never gets a follow-up shot"
        // half of the invariant; the scored half is checked above instead, since a miss can never
        // be an own goal.
        if (state.currentPlayer !== other(winner)) {
          throw new Error(`TURN ALTERNATION BUG: after the faceoff winner's own knock missed, currentPlayer is ` + `${state.currentPlayer} (expected the loser, ${other(winner)}). Action log:\n${JSON.stringify(recentLog, null, 2)}`)
        }
      } else {
        throw new Error(`unexpected phase '${state.phase}' after a faceoff-launched knock resolved. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }
    } else if (state.phase === 'idle') {
      const shooter = state.currentPlayer
      resetLog()

      state = reducer(state, { type: 'AIM_START', x: state.puck.x, y: state.puck.y })
      recentLog.push({ type: 'AIM_START', shooter })
      const { dx, dy, vx, vy } = randomDragForPlayer(rng, shooter, state.puck.x, state.puck.y, controlScheme)
      state = reducer(state, { type: 'AIM_UPDATE', x: state.puck.x + dx, y: state.puck.y + dy, vx, vy })
      recentLog.push({ type: 'AIM_UPDATE' })
      state = reducer(state, { type: 'STRIKE', dx, dy, vx, vy })
      recentLog.push({ type: 'STRIKE', vx, vy, shooter })
      // flick applies directly inside STRIKE and skips 'striking' entirely (see useGameState.ts) -
      // only pull/push hand off through a pending APPLY_STRIKE.
      if (state.phase === 'striking') {
        state = reducer(state, { type: 'APPLY_STRIKE' })
        recentLog.push({ type: 'APPLY_STRIKE' })
      }

      if (state.phase !== 'simulating') {
        throw new Error(`shot did not enter 'simulating'. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }

      // ── The core invariant: two consecutive PLAIN shots (both reached via the idle->aiming->
      // striking->simulating path, i.e. neither preceded by a fresh faceoff win) must alternate
      // shooters, in EVERY tipoff mode - the reducer's own PHYSICS_STEP 'stopped' branch always
      // calls otherPlayer() unconditionally now. 'coinFlip' mode used to be exempted here (the
      // reducer deliberately did not flip on a miss, treating a whole rally as one soccer-style
      // possession) - that was the actual reported bug ("turn taking bug", worse in coinFlip
      // mode, since it triggered on every miss there instead of only after a rare repeat faceoff
      // win) and is fixed now, so both modes are held to the same standard here.
      if (previousPlainShooter !== null && shooter === previousPlainShooter) {
        throw new Error(`TURN ALTERNATION BUG (mode=${tipoffMode}): consecutive plain shots both taken by player ${shooter}, ` + `with no intervening faceoff win or goal. Action log:\n${JSON.stringify(recentLog, null, 2)}`)
      }
      previousPlainShooter = shooter

      shots++
      const scoresBeforeShot = state.scores
      state = runPhysicsToStop(reducer, state, recentLog)

      if (state.phase === 'scored') {
        goals++
        // The conceding player gets the puck next - ordinarily other(shooter) (the shooter scores
        // in the opponent's net), but a shot can also ricochet into the SHOOTER's own net (an own
        // goal), which credits the opponent while the shooter is who actually conceded. scorer is
        // derived from the real score delta so both cases are checked correctly - see
        // PHYSICS_STEP's own comment in useGameState.ts.
        const scorer: Player = state.scores[0] !== scoresBeforeShot[0] ? 1 : 2
        if (state.currentPlayer !== other(scorer)) {
          throw new Error(`TURN ALTERNATION BUG: after a 'scored' PHYSICS_STEP following a plain shot by player ${shooter} (scored for player ${scorer}), ` + `currentPlayer is ${state.currentPlayer} (expected ${other(scorer)}). Action log:\n${JSON.stringify(recentLog, null, 2)}`)
        }
        state = reducer(state, { type: 'NEXT_ROUND', board, zoneIndex: randZoneIndex(rng), faceoffZones: randFaceoffZones(rng), faceoffReadyGuess: randReadyGuess(rng) })
        previousPlainShooter = null // a goal legitimately breaks the plain-shot alternation chain
      } else if (state.phase === 'idle') {
        misses++
      } else {
        throw new Error(`unexpected phase '${state.phase}' after a plain shot resolved. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }
    } else {
      throw new Error(`unexpected phase '${state.phase}' at top of drive loop (shots so far: ${shots})`)
    }
  }

  return { shots, faceoffDraws, goals, misses, modeCounts }
}

describe('turn alternation fuzz - reducer level (no React, no timers)', () => {
  it('faceoff mode: never lets the same player take two consecutive plain shots without a faceoff win or goal in between (300+ shots)', () => {
    const summary = driveFuzzRun('faceoff', 320, 12345)
    expect(summary.shots).toBeGreaterThanOrEqual(300)
  })

  it('coinFlip mode: also never lets the same player take two consecutive plain shots without a goal in between (100+ shots)', () => {
    const summary = driveFuzzRun('coinFlip', 120, 67890)
    expect(summary.shots).toBeGreaterThanOrEqual(100)
  })

  it('faceoff mode: a second, differently-seeded run also holds (defense against a seed-specific fluke)', () => {
    const summary = driveFuzzRun('faceoff', 320, 999999)
    expect(summary.shots).toBeGreaterThanOrEqual(300)
  })

  // flick applies directly inside STRIKE and never enters 'striking' at all (see useGameState.ts)
  // - this confirms turn alternation still holds when a plain shot reaches 'simulating' off a
  // single STRIKE dispatch, with no APPLY_STRIKE handoff in between.
  it("flick scheme: turn alternation still holds when STRIKE alone (not STRIKE+APPLY_STRIKE) reaches 'simulating' (300+ shots)", () => {
    const summary = driveFuzzRun('faceoff', 320, 24680, { 1: 'flick', 2: 'flick' })
    expect(summary.shots).toBeGreaterThanOrEqual(300)
  })
})

// Regression coverage for a real bug caught in adversarial review: PHYSICS_STEP's 'stopped' branch
// (a separate early return from the fallthrough that actually applies goalDoorHitCount/
// lastGoalDoorSide - see useGameState.ts) used to drop a goal-door hit that happens on the very
// same step the puck comes to rest. That's not a rare edge case - it's the single most natural way
// to trigger the effect in real play: a puck drifting back toward the front of the goal from
// behind, tapping the invisible door, and settling right there. The two puck states below are
// hand-tuned (not simulated to this point) so a single PHYSICS_STEP call deterministically both
// bounces off the door AND drops under STOP_THRESHOLD in that same call - see the inline math.
describe('PHYSICS_STEP: goalDoorHitCount/lastGoalDoorSide survive a same-step stop', () => {
  const rinkBoard: BoardLayout = { ...board, cornerRadius: 40, behindGoalDepth: 60 }
  const r = rinkBoard.puckRadius
  // vy_in = 0.16 (top: moving toward increasing y, i.e. toward the front line from behind it):
  // after one dt=1 friction pass (FRICTION_LEVELS.medium = 0.986) the puck reaches the door at
  // 0.16 * 0.986 ≈ 0.1578; after WALL_RESTITUTION (0.72) the bounced-off speed is ≈0.1136,
  // comfortably under STOP_THRESHOLD (0.12) with vx already 0 - so stopped and goalDoorHit land in
  // the very same PhysicsResult, well below the substep threshold (no risk of this being diluted
  // across multiple stepPhysicsOnce calls).
  const APPROACH_VY = 0.16

  it('keeps goalDoorHitCount/lastGoalDoorSide when the puck stops on the SAME step it hits the top door', () => {
    const reducer = makeReducer(SCORE_TO_WIN_NEVER, 'coinFlip', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
    // Just short of the front line, already behind it (wasBehindTop), drifting toward it.
    const state: GameState = { ...DUMMY_STATE, phase: 'simulating', currentPlayer: 1, puck: { x: rinkBoard.centerX, y: rinkBoard.y - r - 0.05, vx: 0, vy: APPROACH_VY } }
    const next = reducer(state, { type: 'PHYSICS_STEP', board: rinkBoard, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('idle') // confirms the 'stopped' branch, not the fallthrough, was taken
    expect(next.goalDoorHitCount).toBe(1)
    expect(next.lastGoalDoorSide).toBe('top')
  })

  it('same, for the bottom door', () => {
    const reducer = makeReducer(SCORE_TO_WIN_NEVER, 'coinFlip', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
    const state: GameState = { ...DUMMY_STATE, phase: 'simulating', currentPlayer: 1, puck: { x: rinkBoard.centerX, y: rinkBoard.y + rinkBoard.height + r + 0.05, vx: 0, vy: -APPROACH_VY } }
    const next = reducer(state, { type: 'PHYSICS_STEP', board: rinkBoard, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('idle')
    expect(next.goalDoorHitCount).toBe(1)
    expect(next.lastGoalDoorSide).toBe('bottom')
  })
})

// Regression coverage for a real reported bug: the CPU never went after the puck after winning the
// initial coin flip. Root cause: useAIOpponent.ts's main effect deliberately depends on state.puck's
// object REFERENCE, not state.phase directly (see that effect's own comment), so it can notice a
// fresh CPU turn without tearing itself down mid-shot - every other transition into 'idle' (a
// physics stop, NEXT_ROUND, a faceoff knock coming to rest) naturally hands the puck a new
// reference. COIN_FLIP_DONE used to be the one exception: it only flipped `phase`, leaving `puck`
// byte-identical to the object RESET already placed, so a CPU that won the coin flip left that
// effect's dependencies completely unchanged and it never re-fired - the CPU just sat on the puck
// forever instead of taking its turn.
describe('COIN_FLIP_DONE: hands the puck a fresh reference so useAIOpponent notices the CPU turn', () => {
  it('gives puck a new object reference (values unchanged) when leaving coinFlip for idle', () => {
    const reducer = makeReducer(SCORE_TO_WIN_NEVER, 'coinFlip', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
    const state = reducer(DUMMY_STATE, { type: 'RESET', board, coinFlipWinner: 2, zoneIndex: 0, faceoffZones: [0, 1], faceoffReadyGuess: [0, 1] })
    expect(state.phase).toBe('coinFlip')

    const next = reducer(state, { type: 'COIN_FLIP_DONE' })

    expect(next.phase).toBe('idle')
    expect(next.currentPlayer).toBe(2) // control passes to the coin-flip winner, unchanged from RESET
    expect(next.puck).not.toBe(state.puck) // the actual fix - a new reference is what wakes useAIOpponent's effect
    expect(next.puck).toEqual(state.puck) // but nothing about position/velocity actually changes here
  })
})

// Regression coverage for a real reported bug: after a goal, the CONCEDING player (whoever's net
// was actually breached) must get the puck next - soccer-style, same rule 'coinFlip' mode's own
// TIPOFF_MODE_OPTIONS description promises ("loser gets the puck") - even on an OWN GOAL, where the
// shooter (state.currentPlayer) and the player who conceded are the same person, not opposites. The
// two own-goal cases below are hand-tuned exactly like the goalDoorHit pair above (a puck placed
// just short of a goal line, moving toward it fast enough to fully cross it in one dt=1 step) so a
// single PHYSICS_STEP deterministically scores - the only difference from an ordinary goal is which
// player is recorded as currentPlayer going in, relative to which goal the puck actually enters.
describe("PHYSICS_STEP 'scored': the conceding player always gets the puck next, even on an own goal", () => {
  it('an ordinary goal - player 1 shoots and scores in the top goal - hands the puck to player 2, the one who conceded', () => {
    const reducer = makeReducer(SCORE_TO_WIN_NEVER, 'coinFlip', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
    const state: GameState = { ...DUMMY_STATE, phase: 'simulating', currentPlayer: 1, puck: { x: board.centerX, y: board.y + 5, vx: 0, vy: -40 } }
    const next = reducer(state, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('scored')
    expect(next.scores).toEqual([1, 0])
    expect(next.currentPlayer).toBe(2)
  })

  it('an OWN GOAL - player 1 is currentPlayer, but the puck enters the BOTTOM goal (player 1s own crease) - still hands the puck to player 1, not player 2', () => {
    const reducer = makeReducer(SCORE_TO_WIN_NEVER, 'coinFlip', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
    const state: GameState = { ...DUMMY_STATE, phase: 'simulating', currentPlayer: 1, puck: { x: board.centerX, y: board.y + board.height - 5, vx: 0, vy: 40 } }
    const next = reducer(state, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('scored')
    expect(next.scores).toEqual([0, 1]) // bottom goal credits player 2...
    expect(next.currentPlayer).toBe(1) // ...but player 1 conceded it, so player 1 gets the puck back, NOT the beneficiary
  })

  it('same, mirrored: player 2 is currentPlayer, but the puck enters the TOP goal (player 2s own crease) - still hands the puck to player 2, not player 1', () => {
    const reducer = makeReducer(SCORE_TO_WIN_NEVER, 'coinFlip', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)
    const state: GameState = { ...DUMMY_STATE, phase: 'simulating', currentPlayer: 2, puck: { x: board.centerX, y: board.y + 5, vx: 0, vy: -40 } }
    const next = reducer(state, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(next.phase).toBe('scored')
    expect(next.scores).toEqual([1, 0]) // top goal credits player 1...
    expect(next.currentPlayer).toBe(2) // ...but player 2 conceded it, so player 2 gets the puck back, NOT the beneficiary
  })
})
