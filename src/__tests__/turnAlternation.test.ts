// Drives the real reducer (makeReducer in src/hooks/useGameState.ts) through hundreds of full
// rounds — faceoffs, launches, physics simulation to a stop/score, and plain idle->aiming->
// striking->simulating shots — via pure dispatch() calls, no React, no timers. Regression
// coverage for a real reported bug: this is a turn-based game (box hockey), not soccer — a miss
// always passes the turn to the other player, in EVERY tipoff mode, never just off the back of a
// goal. tipoffMode only changes HOW the very first shooter of the game (and, in 'faceoff' mode,
// every post-goal shooter) is decided; in 'coinFlip' mode it also decides which player's own zone
// the puck starts at after a goal (the conceding player gets it — see NEXT_ROUND's own comment in
// useGameState.ts) — but never whether an ordinary miss changes possession mid-rally. This
// includes the faceoff winner's own knock (see FACEOFF_LAUNCH's own comment in useGameState.ts):
// real user feedback, explicit, that the winner must NEVER get a follow-up shot off their own
// knock — the loser always takes the very next real turn, hit or miss.

import { CONTROL_SCHEME_SIGN, FRICTION_LEVELS, MIN_SHOOT_DRAG } from '@/constants/game'
import { makeReducer } from '@/hooks/useGameState'
import { BoardLayout, ControlScheme, FaceoffState, GameState, Player, TipoffMode } from '@/types'
import { computeFaceoffKnock } from '@/utils/faceoff'

// ─── Board fixture (same synthetic board physics.test.ts uses — no obstacles, no gravity wells,
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
  cornerRadius: 0,
  behindGoalDepth: 0,
  faceoffOffsetYRatio: 0.42,
  boardMarginTop: 0
}

const CONTROL_SCHEME: Record<Player, ControlScheme> = { 1: 'pull', 2: 'pull' }
const SCORE_TO_WIN_NEVER = 999 // long uninterrupted rallies — game should never actually end
const MAX_PHYSICS_STEPS = 2000

function other(p: Player): Player {
  return p === 1 ? 2 : 1
}

// ─── Seeded PRNG (mulberry32) — deterministic so a failure is reproducible from the seed alone. ──
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
  pendingShot: null,
  bounceCount: 0,
  lastScoredGoal: null,
  wellEnterCount: 0,
  lastWellPolarity: null,
  faceoff: null,
  faceoffRound: 0
}

type Reducer = (state: GameState, action: Parameters<ReturnType<typeof makeReducer>>[1]) => GameState

// Drag vector (dx, dy) that, once STRIKE applies the shooting player's own ControlScheme sign,
// yields a launch direction roughly toward `player`'s attacking goal — with random x jitter (so
// shots sometimes score, sometimes miss wide) and random power (so rallies vary in length).
function randomDragForPlayer(rng: Rng, player: Player, puckX: number, puckY: number): { dx: number; dy: number } {
  const targetY = player === 1 ? board.y - 20 : board.y + board.height + 20
  const targetX = board.centerX + (rng() - 0.5) * board.width * 0.9
  const rawDx = targetX - puckX
  const rawDy = targetY - puckY
  const norm = Math.hypot(rawDx, rawDy) || 1
  const dirX = rawDx / norm
  const dirY = rawDy / norm
  const mag = MIN_SHOOT_DRAG * 1.5 + rng() * 140
  const sign = CONTROL_SCHEME_SIGN[CONTROL_SCHEME[player]]
  // sign * (sign * dirX) === dirX, so this always yields a final velocity direction of
  // (dirX, dirY) regardless of which ControlScheme sign STRIKE applies.
  return { dx: sign * dirX * mag, dy: sign * dirY * mag }
}

function runPhysicsToStop(reducer: Reducer, state: GameState, log: unknown[]): GameState {
  let s = state
  let steps = 0
  while (s.phase === 'simulating' && steps < MAX_PHYSICS_STEPS) {
    s = reducer(s, { type: 'PHYSICS_STEP', board, dt: 1 })
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
// and after every goal; tipoffMode === 'coinFlip' resolves the coin flip once and never again —
// but a miss still always passes the turn to the other player in both modes (see PHYSICS_STEP's
// 'stopped' branch in useGameState.ts) — only who gets the puck (and where) after a GOAL is
// soccer-style in 'coinFlip' mode.
function driveFuzzRun(tipoffMode: TipoffMode, totalShots: number, seed: number): FuzzSummary {
  const reducer = makeReducer(SCORE_TO_WIN_NEVER, tipoffMode, FRICTION_LEVELS.medium, CONTROL_SCHEME)
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
  // to null whenever the chain is broken by a faceoff win or a goal — those are the two
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
      state = runPhysicsToStop(reducer, state, recentLog)
      previousPlainShooter = null // a faceoff win legitimately breaks the plain-shot alternation chain

      // ── The core invariant this file covers (see the top-of-file comment): the LOSER always
      // takes the very next real turn off the winner's own knock, hit or miss — the winner never
      // gets a follow-up shot of their own.
      if (state.currentPlayer !== other(winner)) {
        throw new Error(
          `TURN ALTERNATION BUG: after the faceoff winner's own knock resolved (phase=${state.phase}), currentPlayer is ` +
            `${state.currentPlayer} (expected the loser, ${other(winner)}). Action log:\n${JSON.stringify(recentLog, null, 2)}`
        )
      }

      if (state.phase === 'scored') {
        goals++
        state = reducer(state, { type: 'NEXT_ROUND', board, zoneIndex: randZoneIndex(rng), faceoffZones: randFaceoffZones(rng), faceoffReadyGuess: randReadyGuess(rng) })
      } else if (state.phase === 'idle') {
        misses++
      } else {
        throw new Error(`unexpected phase '${state.phase}' after a faceoff-launched knock resolved. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }
    } else if (state.phase === 'idle') {
      const shooter = state.currentPlayer
      resetLog()

      state = reducer(state, { type: 'AIM_START', x: state.puck.x, y: state.puck.y })
      recentLog.push({ type: 'AIM_START', shooter })
      const { dx, dy } = randomDragForPlayer(rng, shooter, state.puck.x, state.puck.y)
      state = reducer(state, { type: 'AIM_UPDATE', x: state.puck.x + dx, y: state.puck.y + dy })
      recentLog.push({ type: 'AIM_UPDATE' })
      state = reducer(state, { type: 'STRIKE', dx, dy })
      recentLog.push({ type: 'STRIKE', dx, dy, shooter })
      state = reducer(state, { type: 'APPLY_STRIKE' })
      recentLog.push({ type: 'APPLY_STRIKE' })

      if (state.phase !== 'simulating') {
        throw new Error(`APPLY_STRIKE did not enter 'simulating'. Log:\n${JSON.stringify(recentLog, null, 2)}`)
      }

      // ── The core invariant: two consecutive PLAIN shots (both reached via the idle->aiming->
      // striking->simulating path, i.e. neither preceded by a fresh faceoff win) must alternate
      // shooters, in EVERY tipoff mode — the reducer's own PHYSICS_STEP 'stopped' branch always
      // calls otherPlayer() unconditionally now. 'coinFlip' mode used to be exempted here (the
      // reducer deliberately did not flip on a miss, treating a whole rally as one soccer-style
      // possession) — that was the actual reported bug ("turn taking bug", worse in coinFlip
      // mode, since it triggered on every miss there instead of only after a rare repeat faceoff
      // win) and is fixed now, so both modes are held to the same standard here.
      if (previousPlainShooter !== null && shooter === previousPlainShooter) {
        throw new Error(`TURN ALTERNATION BUG (mode=${tipoffMode}): consecutive plain shots both taken by player ${shooter}, ` + `with no intervening faceoff win or goal. Action log:\n${JSON.stringify(recentLog, null, 2)}`)
      }
      previousPlainShooter = shooter

      shots++
      state = runPhysicsToStop(reducer, state, recentLog)

      if (state.phase === 'scored') {
        goals++
        if (state.currentPlayer !== other(shooter)) {
          throw new Error(`TURN ALTERNATION BUG: after a 'scored' PHYSICS_STEP following a plain shot by player ${shooter}, ` + `currentPlayer is ${state.currentPlayer} (expected ${other(shooter)}). Action log:\n${JSON.stringify(recentLog, null, 2)}`)
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

describe('turn alternation fuzz — reducer level (no React, no timers)', () => {
  it('faceoff mode: never lets the same player take two consecutive plain shots without a faceoff win or goal in between (300+ shots)', () => {
    const summary = driveFuzzRun('faceoff', 320, 12345)
    expect(summary.shots).toBeGreaterThanOrEqual(300)
    // eslint-disable-next-line no-console
    console.log('faceoff mode fuzz summary:', JSON.stringify(summary, null, 2))
  })

  it('coinFlip mode: also never lets the same player take two consecutive plain shots without a goal in between (100+ shots)', () => {
    const summary = driveFuzzRun('coinFlip', 120, 67890)
    expect(summary.shots).toBeGreaterThanOrEqual(100)
    // eslint-disable-next-line no-console
    console.log('coinFlip mode fuzz summary:', JSON.stringify(summary, null, 2))
  })

  it('faceoff mode: a second, differently-seeded run also holds (defense against a seed-specific fluke)', () => {
    const summary = driveFuzzRun('faceoff', 320, 999999)
    expect(summary.shots).toBeGreaterThanOrEqual(300)
  })
})
