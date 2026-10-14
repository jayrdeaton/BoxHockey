import { FACEOFF_JITTER_MAX_DEG, FACEOFF_JITTER_MIN_DEG, FACEOFF_KNOCK_MAX_POWER, FACEOFF_KNOCK_MIN_POWER, FACEOFF_MARGIN_MAX_MS, FACEOFF_REACTION_MAX_MS, MAX_SPEED } from '@/constants/game'
import { BoardLayout, Player } from '@/types'

// The tip-off winner's knock, launched from center toward the goal THEY attack (same convention
// as aiOpponent.ts's planAIShot: targetY = the goal that scores for the attacking player) - i.e.
// into the loser's defensive half. Two independent inputs drive two independent outputs: marginMs
// (how much "defense" the opponent posed - a close race means they were still contesting the
// puck) scales angle jitter, closer = wider/scrappier, blowout/forfeit = tighter/more decisive.
// reactionMs (the WINNER's own raw press speed, unaffected by how the opponent did) scales power,
// fast = a hard hit, slow = a weak nudge - even on a forfeit win, since the opponent's mistake
// doesn't make the winner's own reflexes any faster. Jitter is hard-capped well under 90°
// regardless of margin - the puck starts dead-center, equidistant from both goals, so an uncapped
// wide jitter on a close draw could otherwise point the knock back across the halfway line into
// the WINNER's own net.
//
// Real user feedback, explicit: the puck must come off the draw with genuine velocity, not be
// teleported/placed somewhere with none - this IS a real physical knock. And the winner must
// NEVER get a follow-up shot off of it, hit or miss - see FACEOFF_LAUNCH's own comment in
// useGameState.ts: PHYSICS_STEP's 'scored'/'stopped' branches are both unconditional, so the very
// next real turn always goes to the loser regardless of how this knock resolves. The knock into
// the loser's own territory IS the winner's entire reward for the draw - nothing more.
export function computeFaceoffKnock(board: BoardLayout, winner: Player, marginMs: number, reactionMs: number): { vx: number; vy: number } {
  const targetY = winner === 1 ? board.y : board.y + board.height
  const goalCenterX = board.x + (board.goalLeft + board.goalRight) / 2
  const baseAngle = Math.atan2(targetY - board.centerY, goalCenterX - board.centerX)

  const defenseT = Math.min(1, marginMs / FACEOFF_MARGIN_MAX_MS)
  const jitterDeg = FACEOFF_JITTER_MAX_DEG - (FACEOFF_JITTER_MAX_DEG - FACEOFF_JITTER_MIN_DEG) * defenseT

  const reactionT = 1 - Math.min(1, reactionMs / FACEOFF_REACTION_MAX_MS)
  const power = FACEOFF_KNOCK_MIN_POWER + (FACEOFF_KNOCK_MAX_POWER - FACEOFF_KNOCK_MIN_POWER) * reactionT

  const noiseRad = ((Math.random() * 2 - 1) * jitterDeg * Math.PI) / 180
  const angle = baseAngle + noiseRad
  const speed = power * MAX_SPEED

  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }
}
