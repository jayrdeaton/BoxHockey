import { applyDayPlayed, applyResult, applyResultToBucket, applyWinStreak, countBucketsWithAWin, resultFor, RoundResult } from '@tastic/achievements'
import { Profile } from '@tastic/profile'

import { AiDifficulty, BallSpeedLevel, GameMode, Player, ProfileStats, SoloStats, StatsState } from '@/shared/paddleGame/types'
import { DEFAULT_PROFILE_STATS } from '@/shared/paddleGame/utils/statsValidation'
import { type ProfileRanking, rankProfiles } from '@/shared/PlayerRankings'

// One finished match, as the stats layer sees it - built by game.tsx the instant phase flips to
// 'gameOver', entirely from state that's already on screen.
export interface MatchOutcome {
  winner: Player
  // Final score, seat-indexed: [seat 1, seat 2].
  scores: [number, number]
}

export interface MatchContext {
  gameMode: GameMode
  aiDifficulty: AiDifficulty
  ballSpeed: BallSpeedLevel
  // Seat -> profile id, present only for seats with a saved profile selected. vsCpu's CPU seat
  // never has one, so the loop below only ever bumps the human's.
  profileIds?: Partial<Record<Player, string>>
  // Only meaningful for the vsCpu/twoPlayer Bricks toggle - folded into the same mode-agnostic
  // ProfileStats.bricksDestroyed counter solo also feeds (see applySoloOutcome), purely additive
  // and otherwise doesn't touch this outcome's win-condition/scores handling at all.
  bricksDestroyed?: number
}

// Pong has no draws - a match ends the instant one side reaches scoreToWin - so this only ever
// returns 'win' or 'loss'. Routed through resultFor so the rule lives in one place.
function seatResult(outcome: MatchOutcome, seat: Player): RoundResult {
  return resultFor(outcome.winner, seat)
}

// `deviceWide` is not cosmetic: twoPlayer.p1Wins/p2Wins mean two different things. Device-wide
// they're a SEAT tally ("how often has seat 1 won"), the only well-defined framing on a shared
// device. In a profile's bucket they're that PERSON's own wins split by the seat they earned them
// from, so p1Wins + p2Wins is always their own win count regardless of where they sat.
function bumpForSeat(prev: ProfileStats, outcome: MatchOutcome, context: MatchContext, seat: Player, now: Date, deviceWide: boolean): ProfileStats {
  const result = seatResult(outcome, seat)
  const won = result === 'win'
  const scored = outcome.scores[seat - 1]
  const conceded = outcome.scores[seat === 1 ? 1 : 0]

  const vsCpu =
    context.gameMode === 'vsCpu'
      ? {
          ...applyResult(prev.vsCpu, result),
          byDifficulty: applyResultToBucket(prev.vsCpu.byDifficulty, context.aiDifficulty, result) as Record<AiDifficulty, ReturnType<typeof applyResult>>,
          ...applyWinStreak(prev.vsCpu, result)
        }
      : prev.vsCpu

  const twoPlayer =
    context.gameMode === 'vsCpu'
      ? prev.twoPlayer
      : {
          played: prev.twoPlayer.played + 1,
          p1Wins: prev.twoPlayer.p1Wins + (deviceWide ? (outcome.winner === 1 ? 1 : 0) : seat === 1 && won ? 1 : 0),
          p2Wins: prev.twoPlayer.p2Wins + (deviceWide ? (outcome.winner === 2 ? 1 : 0) : seat === 2 && won ? 1 : 0)
        }

  return {
    vsCpu,
    twoPlayer,
    // Untouched by a two-paddle match outcome - only applySoloOutcome's own bumpSoloForSeat below
    // ever changes this bucket.
    solo: prev.solo,
    points: { scored: prev.points.scored + scored, conceded: prev.points.conceded + conceded },
    shutouts: prev.shutouts + (won && conceded === 0 ? 1 : 0),
    bestWinMargin: won ? Math.max(prev.bestWinMargin, scored - conceded) : prev.bestWinMargin,
    bySpeed: applyResultToBucket(prev.bySpeed, context.ballSpeed, result) as Record<BallSpeedLevel, ReturnType<typeof applyResult>>,
    bricksDestroyed: prev.bricksDestroyed + (context.bricksDestroyed ?? 0),
    ...applyDayPlayed(prev, now)
  }
}

// Solo's own bump, parallel to bumpForSeat above rather than routed through it - solo has no
// opponent/score-tuple shape (MatchOutcome/MatchContext) to fit into, just a cleared/bricksDestroyed
// result.
function bumpSoloForSeat(prev: ProfileStats, result: { cleared: boolean; bricksDestroyed: number }, now: Date): ProfileStats {
  const solo: SoloStats = { played: prev.solo.played + 1, cleared: prev.solo.cleared + (result.cleared ? 1 : 0) }
  return { ...prev, solo, bricksDestroyed: prev.bricksDestroyed + result.bricksDestroyed, ...applyDayPlayed(prev, now) }
}

// `now` defaults to the real clock - overridable so tests can drive day boundaries directly.
export function applyMatchOutcome(prev: StatsState, outcome: MatchOutcome, context: MatchContext, now: Date = new Date()): StatsState {
  // + prev.solo.played: a device's very first game ever being a SOLO round must still count as
  // "first ever" here, or a later non-solo game would wrongly re-treat itself as the debut (see
  // applySoloOutcome's own identical extension, the other direction).
  const isFirstGameEver = prev.vsCpu.played + prev.twoPlayer.played + prev.solo.played === 0
  const firstGameResult = isFirstGameEver ? seatResult(outcome, 1) : prev.firstGameResult
  const base = bumpForSeat(prev, outcome, context, 1, now, true)

  let profiles = prev.profiles
  if (context.profileIds) {
    for (const seat of [1, 2] as Player[]) {
      const profileId = context.profileIds[seat]
      if (!profileId) continue
      profiles = { ...profiles, [profileId]: bumpForSeat(profiles[profileId] ?? DEFAULT_PROFILE_STATS, outcome, context, seat, now, false) }
    }
  }

  return { ...base, profiles, firstGameResult }
}

// Solo's own outcome recorder, parallel to applyMatchOutcome above rather than routed through it -
// see bumpSoloForSeat's own doc for why. profileId is singular (not a per-seat map) since solo only
// ever has the one human seat.
export function applySoloOutcome(prev: StatsState, result: { cleared: boolean; bricksDestroyed: number }, profileId: string | undefined, now: Date = new Date()): StatsState {
  const isFirstGameEver = prev.vsCpu.played + prev.twoPlayer.played + prev.solo.played === 0
  const firstGameResult = isFirstGameEver ? (result.cleared ? 'win' : 'loss') : prev.firstGameResult
  const base = bumpSoloForSeat(prev, result, now)

  let profiles = prev.profiles
  if (profileId) profiles = { ...profiles, [profileId]: bumpSoloForSeat(profiles[profileId] ?? DEFAULT_PROFILE_STATS, result, now) }

  return { ...base, profiles, firstGameResult }
}

export function getOverallTotals(stats: ProfileStats): { played: number; wins: number; losses: number } {
  const twoPlayerWins = stats.twoPlayer.p1Wins + stats.twoPlayer.p2Wins
  return {
    played: stats.vsCpu.played + stats.twoPlayer.played + stats.solo.played,
    wins: stats.vsCpu.wins + twoPlayerWins + stats.solo.cleared,
    losses: stats.vsCpu.losses + (stats.twoPlayer.played - twoPlayerWins) + (stats.solo.played - stats.solo.cleared)
  }
}

// Synthesizes a full StatsState-shaped view from one profile's bucket, so the same predicates
// evaluate it unchanged. firstGameResult is never read through this view - the one achievement
// that touches it is scope:'device'.
export function getProfileStatsView(profileStats: ProfileStats): StatsState {
  return { ...profileStats, profiles: {}, firstGameResult: null }
}

// How many of the three puck-speed tiers have at least one win - the "win at every speed" family.
export function getSpeedsWon(stats: ProfileStats): number {
  return countBucketsWithAWin(stats.bySpeed)
}

// Every saved profile's record in this game, most wins first (see the shared rankProfiles).
export function getProfileRankings(profiles: Profile[], profileStats: Record<string, ProfileStats>): ProfileRanking[] {
  return rankProfiles(profiles, (profileId) => getOverallTotals(profileStats[profileId] ?? DEFAULT_PROFILE_STATS))
}
