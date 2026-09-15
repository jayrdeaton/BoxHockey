import { FACEOFF_KNOCK_MAX_POWER, FACEOFF_KNOCK_MIN_POWER, FACEOFF_MARGIN_MAX_MS, FACEOFF_REACTION_MAX_MS, FRICTION_LEVELS, MAX_SPEED } from '@/constants/game'
import { makeReducer } from '@/hooks/useGameState'
import { BoardLayout, ControlScheme, FaceoffState, GameState, Player } from '@/types'
import { computeFaceoffKnock } from '@/utils/faceoff'

// Same synthetic board physics.test.ts uses.
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

const PLAYERS: Player[] = [1, 2]

// Coverage for the faceoff winner's knock: real user feedback, explicit, that this must stay a
// genuine physical shot with real velocity (never a static placement) while the winner still
// never gets a follow-up shot off of it — see FACEOFF_LAUNCH's own comment in useGameState.ts,
// which guarantees the loser always takes the next real turn regardless of how this knock
// resolves. These tests lock in the knock's own physics: real velocity, toward the winner's
// attacking goal, scaling with reaction time and margin.
describe('computeFaceoffKnock', () => {
  it.each(PLAYERS)('player %i knocks toward their own attacking goal (never their own net), across the whole margin/jitter range', (player) => {
    for (let i = 0; i < 200; i++) {
      const knock = computeFaceoffKnock(board, player, Math.random() * FACEOFF_MARGIN_MAX_MS * 2, Math.random() * FACEOFF_REACTION_MAX_MS * 2)
      // Player 1 attacks the TOP goal (vy negative); player 2 attacks the BOTTOM goal (vy
      // positive) — see stepPhysics'/board.ts's "player 1 always sits at the bottom" convention.
      // Jitter is hard-capped well under 90° (see FACEOFF_JITTER_MAX_DEG), so this must never flip.
      if (player === 1) {
        expect(knock.vy).toBeLessThan(0)
      } else {
        expect(knock.vy).toBeGreaterThan(0)
      }
    }
  })

  it('a near-instant reaction (fast win) knocks harder than a slow one', () => {
    const fast = computeFaceoffKnock(board, 2, FACEOFF_MARGIN_MAX_MS, 0)
    const slow = computeFaceoffKnock(board, 2, FACEOFF_MARGIN_MAX_MS, FACEOFF_REACTION_MAX_MS)
    const fastSpeed = Math.hypot(fast.vx, fast.vy)
    const slowSpeed = Math.hypot(slow.vx, slow.vy)
    expect(fastSpeed).toBeGreaterThan(slowSpeed)
  })

  it('knock speed always stays within [FACEOFF_KNOCK_MIN_POWER, FACEOFF_KNOCK_MAX_POWER] * MAX_SPEED', () => {
    for (let i = 0; i < 200; i++) {
      const knock = computeFaceoffKnock(board, 1, Math.random() * FACEOFF_MARGIN_MAX_MS * 2, Math.random() * FACEOFF_REACTION_MAX_MS * 2)
      const speed = Math.hypot(knock.vx, knock.vy)
      expect(speed).toBeGreaterThanOrEqual(FACEOFF_KNOCK_MIN_POWER * MAX_SPEED - 1e-9)
      expect(speed).toBeLessThanOrEqual(FACEOFF_KNOCK_MAX_POWER * MAX_SPEED + 1e-9)
    }
  })

  it('a forfeit-shaped reactionMs (FACEOFF_REACTION_MAX_MS, no genuine race) still yields the minimum knock power, not the max', () => {
    const knock = computeFaceoffKnock(board, 1, FACEOFF_MARGIN_MAX_MS, FACEOFF_REACTION_MAX_MS)
    const speed = Math.hypot(knock.vx, knock.vy)
    expect(speed).toBeCloseTo(FACEOFF_KNOCK_MIN_POWER * MAX_SPEED, 5)
  })
})

// Regression coverage for a real reported bug: a "double failure" draw — BOTH players press the
// wrong zone, or both fail to land a real press at all before FACEOFF_TAP_TIMEOUT_MS — used to
// still set result.marginMs to FACEOFF_MARGIN_MAX_MS, the same value a genuine one-sided blowout
// gets (real winner press vs. a whiffing opponent). Since a LARGER margin means LESS jitter in
// computeFaceoffKnock (a "no real defense, could've hit anything" blowout deserves an accurate
// shot), that accidentally handed the reducer's arbitrary coin-flip "winner" — who never landed a
// single correct press either — the tightest, most accurate knock the game can produce, which
// could and did score off a draw nobody actually won. Fixed in useGameState.ts's FACEOFF_TAP
// (both-disqualified branch) and FACEOFF_TIMEOUT case: marginMs is 0 (max jitter) whenever the
// declared winner never landed a genuine correct-zone press themselves.
describe('double-failure faceoff draws never get the accurate-shot margin', () => {
  const CONTROL_SCHEME: Record<Player, ControlScheme> = { 1: 'pull', 2: 'pull' }

  function makeLiveFaceoffState(zones: [0 | 1, 0 | 1], goAt: number): GameState {
    const faceoff: FaceoffState = {
      stage: 'live',
      ready: [true, true],
      count: null,
      zones,
      readyGuess: [zones[0] === 0 ? 1 : 0, zones[1] === 0 ? 1 : 0], // neither guesses correctly, keeps this test's timing math exact
      goAt,
      tapAt: [null, null],
      disqualified: [false, false],
      pressFlash: [null, null],
      result: null
    }
    return {
      phase: 'faceoff',
      currentPlayer: 1,
      scores: [0, 0],
      puck: { x: board.centerX, y: board.centerY, vx: 0, vy: 0 },
      aim: null,
      interceptAim: null,
      pendingShot: null,
      bounceCount: 0,
      lastScoredGoal: null,
      wellEnterCount: 0,
      lastWellPolarity: null,
      goalDoorHitCount: 0,
      lastGoalDoorSide: null,
      faceoff,
      faceoffRound: 0,
      tripleTap: null,
      tripleTapRound: 0
    }
  }

  const reducer = makeReducer(5, 'faceoff', FRICTION_LEVELS.medium, CONTROL_SCHEME, 0)

  it('both players press the wrong zone: winner (whoever went second) gets marginMs 0, not FACEOFF_MARGIN_MAX_MS', () => {
    const goAt = 1000
    let s = makeLiveFaceoffState([0, 1], goAt)
    s = reducer(s, { type: 'FACEOFF_TAP', player: 1, atMs: goAt + 30, zoneIndex: 1 }) // wrong (correct is 0)
    s = reducer(s, { type: 'FACEOFF_TAP', player: 2, atMs: goAt + 80, zoneIndex: 0 }) // wrong (correct is 1)
    expect(s.faceoff?.stage).toBe('resolved')
    expect(s.faceoff?.disqualified).toEqual([true, true])
    expect(s.faceoff?.result?.winner).toBe(2) // whoever's wrong press landed second
    expect(s.faceoff?.result?.marginMs).toBe(0)
  })

  it('timeout with total silence from both players: marginMs is 0, not FACEOFF_MARGIN_MAX_MS', () => {
    const goAt = 1000
    const s0 = makeLiveFaceoffState([0, 1], goAt)
    const s = reducer(s0, { type: 'FACEOFF_TIMEOUT', player: 1 }) // useFaceoff.ts always checks tapAt[0] first
    expect(s.faceoff?.stage).toBe('resolved')
    expect(s.faceoff?.result?.winner).toBe(2)
    expect(s.faceoff?.result?.marginMs).toBe(0)
  })

  it('timeout with one wrong-zone press and one total silence: marginMs is 0, not FACEOFF_MARGIN_MAX_MS', () => {
    const goAt = 1000
    let s = makeLiveFaceoffState([0, 1], goAt)
    s = reducer(s, { type: 'FACEOFF_TAP', player: 2, atMs: goAt + 30, zoneIndex: 0 }) // wrong (correct is 1)
    expect(s.faceoff?.disqualified).toEqual([false, true])
    s = reducer(s, { type: 'FACEOFF_TIMEOUT', player: 1 }) // player 1 never pressed at all
    expect(s.faceoff?.stage).toBe('resolved')
    expect(s.faceoff?.result?.winner).toBe(1) // the silent player still beats the disqualified one
    expect(s.faceoff?.result?.marginMs).toBe(0)
  })

  it('sanity check: a GENUINE one-sided blowout (real correct press vs. a wrong-zone opponent) still keeps the accurate FACEOFF_MARGIN_MAX_MS margin', () => {
    const goAt = 1000
    let s = makeLiveFaceoffState([0, 1], goAt)
    s = reducer(s, { type: 'FACEOFF_TAP', player: 1, atMs: goAt + 30, zoneIndex: 0 }) // correct
    s = reducer(s, { type: 'FACEOFF_TAP', player: 2, atMs: goAt + 80, zoneIndex: 0 }) // wrong (correct is 1)
    expect(s.faceoff?.result?.winner).toBe(1)
    expect(s.faceoff?.result?.marginMs).toBe(FACEOFF_MARGIN_MAX_MS)
  })

  it('sanity check: a timeout where the winner DID land a real press keeps the accurate FACEOFF_MARGIN_MAX_MS margin', () => {
    const goAt = 1000
    let s = makeLiveFaceoffState([0, 1], goAt)
    s = reducer(s, { type: 'FACEOFF_TAP', player: 2, atMs: goAt + 30, zoneIndex: 1 }) // correct, then player 1 never presses
    s = reducer(s, { type: 'FACEOFF_TIMEOUT', player: 1 })
    expect(s.faceoff?.result?.winner).toBe(2)
    expect(s.faceoff?.result?.marginMs).toBe(FACEOFF_MARGIN_MAX_MS)
  })
})
