import { applyDayPlayed, applyResult, applyResultToBucket, applyWinStreak, countBucketsWithAWin, getMostPlayedKey, resultFor, RoundResult } from '@tastic/achievements'

import { AiDifficulty, BoardVariant, GameMode, Player, Profile, ProfileStats, StatsState } from '@/types'
import { DEFAULT_PROFILE_STATS } from '@/utils/statsValidation'

// One finished match, as the stats layer sees it. Built by game.tsx the instant phase flips to
// 'gameOver' - everything here is already on screen at that moment, so nothing extra is tracked
// during play just to feed this.
export interface MatchOutcome {
  winner: Player
  // Final score, seat-indexed: [seat 1, seat 2].
  scores: [number, number]
}

export interface MatchContext {
  gameMode: GameMode
  aiDifficulty: AiDifficulty
  boardVariant: BoardVariant
  // Seat -> profile id, present only for seats with a saved profile selected (see useProfiles'
  // lastSelected). vsCpu's CPU seat never has one, so the loop below only ever bumps the human's.
  profileIds?: Partial<Record<Player, string>>
}

// BoxHockey has no draws - a match ends the instant one side reaches scoreToWin - so this only ever
// returns 'win' or 'loss'. Routed through resultFor anyway so the rule lives in one place.
function seatResult(outcome: MatchOutcome, seat: Player): RoundResult {
  return resultFor(outcome.winner, seat)
}

function goalsFor(outcome: MatchOutcome, seat: Player): { scored: number; conceded: number } {
  const own = outcome.scores[seat - 1]
  const other = outcome.scores[seat === 1 ? 1 : 0]
  return { scored: own, conceded: other }
}

// The per-seat half of a match update, shared by the device-wide pass and each profile's bucket.
//
// `deviceWide` is not cosmetic: twoPlayer.p1Wins/p2Wins mean two different things in the two
// cases. Device-wide they're a SEAT tally - "how often has the player in seat 1 won" - which is
// the only well-defined framing on a shared device where seat 2 is a different person each match.
// In a profile's bucket they're that PROFILE's own wins, split by which seat they earned them
// from, so p1Wins + p2Wins is always that person's own win count regardless of where they sat.
function bumpForSeat(prev: ProfileStats, outcome: MatchOutcome, context: MatchContext, seat: Player, now: Date, deviceWide: boolean): ProfileStats {
  const result = seatResult(outcome, seat)
  const { scored, conceded } = goalsFor(outcome, seat)
  const won = result === 'win'

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
          // See the deviceWide note above for why these two branches differ.
          p1Wins: prev.twoPlayer.p1Wins + (deviceWide ? (outcome.winner === 1 ? 1 : 0) : seat === 1 && won ? 1 : 0),
          p2Wins: prev.twoPlayer.p2Wins + (deviceWide ? (outcome.winner === 2 ? 1 : 0) : seat === 2 && won ? 1 : 0)
        }

  return {
    vsCpu,
    twoPlayer,
    variants: applyResultToBucket(prev.variants, context.boardVariant, result) as Record<BoardVariant, ReturnType<typeof applyResult>>,
    goals: { scored: prev.goals.scored + scored, conceded: prev.goals.conceded + conceded },
    // A shutout is a win where the loser never scored at all.
    shutouts: prev.shutouts + (won && conceded === 0 ? 1 : 0),
    bestWinMargin: won ? Math.max(prev.bestWinMargin, scored - conceded) : prev.bestWinMargin,
    ...applyDayPlayed(prev, now)
  }
}

// `now` defaults to the real clock - overridable so tests can exercise day-boundary/streak logic
// without mocking the global Date.
export function applyMatchOutcome(prev: StatsState, outcome: MatchOutcome, context: MatchContext, now: Date = new Date()): StatsState {
  const isFirstGameEver = prev.vsCpu.played + prev.twoPlayer.played === 0
  const firstGameResult = isFirstGameEver ? seatResult(outcome, 1) : prev.firstGameResult

  // Device-wide totals are kept from seat 1's perspective - the same framing LightCycles uses, and
  // the only well-defined one on a shared device where seat 2 is a different person each match.
  const base = bumpForSeat(prev, outcome, context, 1, now, true)

  let profiles = prev.profiles
  if (context.profileIds) {
    for (const seat of [1, 2] as Player[]) {
      const profileId = context.profileIds[seat]
      if (!profileId) continue
      const bucket = profiles[profileId] ?? DEFAULT_PROFILE_STATS
      profiles = { ...profiles, [profileId]: bumpForSeat(bucket, outcome, context, seat, now, false) }
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

// Synthesizes a full StatsState-shaped view from one profile's bucket, so the exact same
// achievement predicates evaluate a profile's own record unchanged. `firstGameResult: null` is
// never read through this view - the one achievement that touches it is scope:'device'.
export function getProfileStatsView(profileStats: ProfileStats): StatsState {
  return { ...profileStats, profiles: {}, firstGameResult: null }
}

// How many of the three board variants have at least one win - the "win on every board" family.
export function getVariantsWon(stats: ProfileStats): number {
  return countBucketsWithAWin(stats.variants)
}

export function getFavoriteVariant(stats: ProfileStats): BoardVariant | null {
  return getMostPlayedKey(stats.variants) as BoardVariant | null
}

export interface ProfileRanking {
  profile: Profile
  played: number
  wins: number
  losses: number
  winRate: number
}

// Sorted by wins, then win rate, both descending - a profile with nothing recorded yet still
// appears at played: 0, so a freshly created profile shows up immediately.
export function getProfileRankings(profiles: Profile[], profileStats: Record<string, ProfileStats>): ProfileRanking[] {
  return profiles
    .map((profile) => {
      const totals = getOverallTotals(profileStats[profile.id] ?? DEFAULT_PROFILE_STATS)
      return { profile, ...totals, winRate: totals.played > 0 ? totals.wins / totals.played : 0 }
    })
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
}
