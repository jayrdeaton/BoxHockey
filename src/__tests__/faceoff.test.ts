import { FACEOFF_KNOCK_MAX_POWER, FACEOFF_KNOCK_MIN_POWER, FACEOFF_MARGIN_MAX_MS, FACEOFF_REACTION_MAX_MS, MAX_SPEED } from '@/constants/game'
import { BoardLayout, Player } from '@/types'
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
