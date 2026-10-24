import { Profile } from '@tastic/profile'

import { StatsState } from '@/games/airhockey/types'
import { applyMatchOutcome, getOverallTotals, getProfileRankings, getProfileStatsView, MatchContext, MatchOutcome } from '@/games/airhockey/utils/statsEngine'
import { DEFAULT_PROFILE_STATS, DEFAULT_STATS } from '@/games/airhockey/utils/statsValidation'

const VS_CPU: MatchContext = { gameMode: 'vsCpu', aiDifficulty: 'medium' }
const TWO_PLAYER: MatchContext = { gameMode: 'twoPlayer', aiDifficulty: 'medium' }

function win(scores: [number, number], goalDoorHits = 0): MatchOutcome {
  return { winner: scores[0] > scores[1] ? 1 : 2, scores, goalDoorHits }
}

function play(prev: StatsState, outcome: MatchOutcome, context: MatchContext = VS_CPU, now = new Date(2026, 8, 2)): StatsState {
  return applyMatchOutcome(prev, outcome, context, now)
}

describe('applyMatchOutcome - vsCpu', () => {
  it('records a human win without touching twoPlayer', () => {
    const s = play(DEFAULT_STATS, win([7, 3]))
    expect(s.vsCpu).toMatchObject({ played: 1, wins: 1, losses: 0 })
    expect(s.twoPlayer).toEqual({ played: 0, p1Wins: 0, p2Wins: 0 })
  })

  it('records a human loss', () => {
    const s = play(DEFAULT_STATS, win([2, 7]))
    expect(s.vsCpu).toMatchObject({ played: 1, wins: 0, losses: 1 })
  })

  it('buckets byDifficulty separately', () => {
    let s = play(DEFAULT_STATS, win([7, 1]), { ...VS_CPU, aiDifficulty: 'easy' })
    s = play(s, win([7, 2]), { ...VS_CPU, aiDifficulty: 'hard' })
    expect(s.vsCpu.byDifficulty.easy.wins).toBe(1)
    expect(s.vsCpu.byDifficulty.hard.wins).toBe(1)
    expect(s.vsCpu.byDifficulty.medium.played).toBe(0)
  })

  it('tracks a win streak and resets it on a loss', () => {
    let s = play(DEFAULT_STATS, win([7, 0]))
    s = play(s, win([7, 1]))
    expect(s.vsCpu).toMatchObject({ currentWinStreak: 2, bestWinStreak: 2 })
    s = play(s, win([3, 7]))
    expect(s.vsCpu).toMatchObject({ currentWinStreak: 0, bestWinStreak: 2 })
  })
})

describe('applyMatchOutcome - goals, shutouts and margins', () => {
  it('accumulates goals for and against from seat 1s perspective', () => {
    let s = play(DEFAULT_STATS, win([7, 3]))
    s = play(s, win([2, 7]))
    expect(s.goals).toEqual({ scored: 9, conceded: 10 })
  })

  it('counts a shutout only on a win where nothing was conceded', () => {
    let s = play(DEFAULT_STATS, win([7, 0]))
    expect(s.shutouts).toBe(1)
    // Losing 0-7 is not a shutout for seat 1.
    s = play(s, win([0, 7]))
    expect(s.shutouts).toBe(1)
  })

  it('tracks the best win margin, ignoring losses', () => {
    let s = play(DEFAULT_STATS, win([7, 4]))
    expect(s.bestWinMargin).toBe(3)
    s = play(s, win([0, 7]))
    expect(s.bestWinMargin).toBe(3)
    s = play(s, win([7, 0]))
    expect(s.bestWinMargin).toBe(7)
  })
})

describe('applyMatchOutcome - goal door', () => {
  it('accumulates goal-door hits across matches', () => {
    let s = play(DEFAULT_STATS, win([7, 3], 4))
    s = play(s, win([7, 1], 6))
    expect(s.goalDoorHits).toBe(10)
  })

  it('credits both profiles the same match total, since the door is shared', () => {
    const s = play(DEFAULT_STATS, win([7, 1], 5), { ...TWO_PLAYER, profileIds: { 1: 'alice', 2: 'bob' } })
    expect(s.profiles.alice.goalDoorHits).toBe(5)
    expect(s.profiles.bob.goalDoorHits).toBe(5)
  })
})

describe('applyMatchOutcome - twoPlayer seats', () => {
  it('records seat wins without touching vsCpu', () => {
    const s = play(DEFAULT_STATS, win([7, 5]), TWO_PLAYER)
    expect(s.twoPlayer).toEqual({ played: 1, p1Wins: 1, p2Wins: 0 })
    expect(s.vsCpu.played).toBe(0)
  })

  it('credits seat 2 when seat 2 wins', () => {
    const s = play(DEFAULT_STATS, win([4, 7]), TWO_PLAYER)
    expect(s.twoPlayer).toEqual({ played: 1, p1Wins: 0, p2Wins: 1 })
  })
})

describe('applyMatchOutcome - profiles', () => {
  const withProfiles: MatchContext = { ...TWO_PLAYER, profileIds: { 1: 'alice', 2: 'bob' } }

  it('leaves profiles untouched when no ids are supplied', () => {
    expect(play(DEFAULT_STATS, win([7, 1]), TWO_PLAYER).profiles).toEqual({})
  })

  it("attributes the result to each seat's own profile", () => {
    const s = play(DEFAULT_STATS, win([7, 1]), withProfiles)
    expect(s.profiles.alice.twoPlayer).toEqual({ played: 1, p1Wins: 1, p2Wins: 0 })
    expect(s.profiles.bob.twoPlayer).toEqual({ played: 1, p1Wins: 0, p2Wins: 0 })
  })

  it("records each profile's goals from its own side of the board", () => {
    const s = play(DEFAULT_STATS, win([7, 1]), withProfiles)
    expect(s.profiles.alice.goals).toEqual({ scored: 7, conceded: 1 })
    expect(s.profiles.bob.goals).toEqual({ scored: 1, conceded: 7 })
  })

  it('credits a shutout to the winner only', () => {
    const s = play(DEFAULT_STATS, win([7, 0]), withProfiles)
    expect(s.profiles.alice.shutouts).toBe(1)
    expect(s.profiles.bob.shutouts).toBe(0)
  })

  it("counts a profile's own wins regardless of which seat they sat in", () => {
    let s = play(DEFAULT_STATS, win([7, 1]), { ...TWO_PLAYER, profileIds: { 1: 'alice' } })
    // Alice moves to seat 2 and wins again.
    s = play(s, win([1, 7]), { ...TWO_PLAYER, profileIds: { 2: 'alice' } })
    const alice = s.profiles.alice
    expect(alice.twoPlayer.p1Wins + alice.twoPlayer.p2Wins).toBe(2)
    expect(alice.twoPlayer.played).toBe(2)
  })

  it('never creates a phantom CPU-seat profile entry in vsCpu', () => {
    const s = play(DEFAULT_STATS, win([7, 1]), { ...VS_CPU, profileIds: { 1: 'alice' } })
    expect(Object.keys(s.profiles)).toEqual(['alice'])
  })
})

describe('firstGameResult', () => {
  it('is set from the very first match, from seat 1s perspective', () => {
    expect(play(DEFAULT_STATS, win([7, 2])).firstGameResult).toBe('win')
    expect(play(DEFAULT_STATS, win([2, 7])).firstGameResult).toBe('loss')
  })

  it('is never overwritten by a later match', () => {
    let s = play(DEFAULT_STATS, win([2, 7]))
    s = play(s, win([7, 0]))
    expect(s.firstGameResult).toBe('loss')
  })
})

describe('day streak', () => {
  it('starts at 1 on the first day played', () => {
    const s = play(DEFAULT_STATS, win([7, 0]), VS_CPU, new Date(2026, 8, 2))
    expect(s).toMatchObject({ distinctDaysPlayed: 1, currentDayStreak: 1, bestDayStreak: 1 })
  })

  it('does not double-count two matches on the same day', () => {
    let s = play(DEFAULT_STATS, win([7, 0]), VS_CPU, new Date(2026, 8, 2, 9))
    s = play(s, win([7, 1]), VS_CPU, new Date(2026, 8, 2, 21))
    expect(s.distinctDaysPlayed).toBe(1)
    // The match itself still counted, even though the day didn't.
    expect(s.vsCpu.played).toBe(2)
  })

  it('extends on a consecutive day and restarts after a gap', () => {
    let s = play(DEFAULT_STATS, win([7, 0]), VS_CPU, new Date(2026, 8, 1))
    s = play(s, win([7, 0]), VS_CPU, new Date(2026, 8, 2))
    expect(s.currentDayStreak).toBe(2)
    s = play(s, win([7, 0]), VS_CPU, new Date(2026, 8, 9))
    expect(s).toMatchObject({ currentDayStreak: 1, bestDayStreak: 2 })
  })
})

describe('selectors', () => {
  it('getOverallTotals sums both modes', () => {
    let s = play(DEFAULT_STATS, win([7, 1]))
    s = play(s, win([1, 7]))
    s = play(s, win([7, 3]), TWO_PLAYER)
    expect(getOverallTotals(s)).toEqual({ played: 3, wins: 2, losses: 1 })
  })

  it('getProfileStatsView synthesizes a view with no nesting and a null firstGameResult', () => {
    const s = play(DEFAULT_STATS, win([7, 1]), { ...TWO_PLAYER, profileIds: { 1: 'alice' } })
    const view = getProfileStatsView(s.profiles.alice)
    expect(view.profiles).toEqual({})
    expect(view.firstGameResult).toBeNull()
    expect(view.goals).toEqual({ scored: 7, conceded: 1 })
  })

  it('getProfileRankings sorts by wins then win rate, and includes profiles with no games', () => {
    const mk = (id: string, name: string): Profile => ({ id, name, color: '#fff', tag: '', createdAt: 0, updatedAt: 0 })
    const profiles = [mk('a', 'A'), mk('b', 'B'), mk('c', 'C')]
    const statsMap = {
      a: { ...DEFAULT_PROFILE_STATS, twoPlayer: { played: 4, p1Wins: 1, p2Wins: 0 } },
      b: { ...DEFAULT_PROFILE_STATS, twoPlayer: { played: 2, p1Wins: 2, p2Wins: 0 } }
    }
    const ranked = getProfileRankings(profiles, statsMap)
    expect(ranked.map((r) => r.profile.id)).toEqual(['b', 'a', 'c'])
    expect(ranked[2]).toMatchObject({ played: 0, wins: 0, winRate: 0 })
  })
})
