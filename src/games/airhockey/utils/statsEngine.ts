import { applyDayPlayed, applyResult, applyResultToBucket, applyWinStreak, resultFor, RoundResult } from '@tastic/achievements'
import { Profile } from '@tastic/profile'

import { AiDifficulty, GameMode, Player, ProfileStats, StatsState } from '@/games/airhockey/types'
import { DEFAULT_PROFILE_STATS } from '@/games/airhockey/utils/statsValidation'
import { type ProfileRanking, rankProfiles } from '@/shared/PlayerRankings'

// One finished match, as the stats layer sees it - built by game.tsx the instant phase flips to
// 'gameOver', entirely from state that's already on screen.
export interface MatchOutcome {
  winner: Player
  // Final score, seat-indexed: [seat 1, seat 2].
  scores: [number, number]
  // One-way goal-door hits this match (see GameState's goalDoorHitCount).
  goalDoorHits: number
}

export interface MatchContext {
  gameMode: GameMode
  aiDifficulty: AiDifficulty
  // Seat -> profile id, present only for seats with a saved profile selected. vsCpu's CPU seat
  // never has one, so the loop below only ever bumps the human's.
  profileIds?: Partial<Record<Player, string>>
}

// AirHockey has no draws - a match ends the instant one side reaches scoreToWin - so this only ever
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
    goals: { scored: prev.goals.scored + scored, conceded: prev.goals.conceded + conceded },
    shutouts: prev.shutouts + (won && conceded === 0 ? 1 : 0),
    bestWinMargin: won ? Math.max(prev.bestWinMargin, scored - conceded) : prev.bestWinMargin,
    goalDoorHits: prev.goalDoorHits + outcome.goalDoorHits,
    ...applyDayPlayed(prev, now)
  }
}

// `now` defaults to the real clock - overridable so tests can drive day boundaries directly.
export function applyMatchOutcome(prev: StatsState, outcome: MatchOutcome, context: MatchContext, now: Date = new Date()): StatsState {
  const isFirstGameEver = prev.vsCpu.played + prev.twoPlayer.played === 0
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

export function getOverallTotals(stats: ProfileStats): { played: number; wins: number; losses: number } {
  const twoPlayerWins = stats.twoPlayer.p1Wins + stats.twoPlayer.p2Wins
  return {
    played: stats.vsCpu.played + stats.twoPlayer.played,
    wins: stats.vsCpu.wins + twoPlayerWins,
    losses: stats.vsCpu.losses + (stats.twoPlayer.played - twoPlayerWins)
  }
}

// Synthesizes a full StatsState-shaped view from one profile's bucket, so the same predicates
// evaluate it unchanged. firstGameResult is never read through this view - the one achievement
// that touches it is scope:'device'.
export function getProfileStatsView(profileStats: ProfileStats): StatsState {
  return { ...profileStats, profiles: {}, firstGameResult: null }
}

// Sorted by wins then win rate, both descending - a profile with nothing recorded still appears at
// played: 0, so a freshly created one shows up immediately.
export function getProfileRankings(profiles: Profile[], profileStats: Record<string, ProfileStats>): ProfileRanking[] {
  return rankProfiles(profiles, (profileId) => getOverallTotals(profileStats[profileId] ?? DEFAULT_PROFILE_STATS))
}
