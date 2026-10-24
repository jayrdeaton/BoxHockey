import { ACHIEVEMENT_CATALOG } from '@/games/boxhockey/constants/achievements'
import { StatsState } from '@/games/boxhockey/types'
import { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } from '@/games/boxhockey/utils/achievementEngine'
import { DEFAULT_PROFILE_STATS, DEFAULT_STATS } from '@/games/boxhockey/utils/statsValidation'

function stats(overrides: Partial<StatsState>): StatsState {
  return { ...DEFAULT_STATS, ...overrides }
}

describe('ACHIEVEMENT_CATALOG', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENT_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every entry a title, description, icon and tier', () => {
    for (const a of ACHIEVEMENT_CATALOG) {
      expect(a.title.length).toBeGreaterThan(0)
      expect(a.description.length).toBeGreaterThan(0)
      expect(a.icon.length).toBeGreaterThan(0)
      expect(['bronze', 'silver', 'gold']).toContain(a.tier)
    }
  })

  it('unlocks nothing at all on a fresh blob', () => {
    expect(evaluateUnlockedIds(DEFAULT_STATS).size).toBe(0)
  })

  it('reports progress between 0 and 1 wherever it is defined', () => {
    const rich = stats({ goals: { scored: 30, conceded: 10 }, shutouts: 2, bestWinMargin: 4 })
    for (const a of ACHIEVEMENT_CATALOG) {
      const p = a.progress?.(rich)
      if (p === undefined) continue
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })
})

describe('unlocking', () => {
  it('unlocks the first-match one-offs on a first win', () => {
    const s = stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, played: 1, wins: 1 }, firstGameResult: 'win' })
    const ids = evaluateUnlockedIds(s)
    expect(ids.has('first_game_played')).toBe(true)
    expect(ids.has('first_ever_win')).toBe(true)
    expect(ids.has('flawless_debut')).toBe(true)
  })

  it('leaves flawless_debut locked when the first match was a loss', () => {
    const s = stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, played: 5, wins: 4 }, firstGameResult: 'loss' })
    expect(evaluateUnlockedIds(s).has('flawless_debut')).toBe(false)
  })

  it('unlocks shutout tiers at their thresholds', () => {
    expect(evaluateUnlockedIds(stats({ shutouts: 1 })).has('shutouts_bronze')).toBe(true)
    expect(evaluateUnlockedIds(stats({ shutouts: 9 })).has('shutouts_silver')).toBe(false)
    expect(evaluateUnlockedIds(stats({ shutouts: 10 })).has('shutouts_silver')).toBe(true)
  })

  it('unlocks a beat-the-CPU entry only for the difficulty actually beaten', () => {
    const s = stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, byDifficulty: { ...DEFAULT_STATS.vsCpu.byDifficulty, hard: { played: 1, wins: 1, losses: 0, draws: 0 } } } })
    const ids = evaluateUnlockedIds(s)
    expect(ids.has('beat_cpu_hard')).toBe(true)
    expect(ids.has('beat_cpu_easy')).toBe(false)
  })

  it('never reports the device-scoped achievement for a profile', () => {
    const bucket = { ...DEFAULT_PROFILE_STATS, vsCpu: { ...DEFAULT_PROFILE_STATS.vsCpu, played: 1, wins: 1 } }
    const ids = evaluateUnlockedIdsForProfile(bucket)
    expect(ids.has('first_game_played')).toBe(true)
    expect(ids.has('flawless_debut')).toBe(false)
  })
})

describe('unlockedKey', () => {
  it('keys device-wide unlocks bare and profile unlocks by id', () => {
    expect(unlockedKey('first_ever_win', null)).toBe('first_ever_win')
    expect(unlockedKey('first_ever_win', 'alice')).toBe('alice:first_ever_win')
  })
})
