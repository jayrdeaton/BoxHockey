import { createAchievementBindings } from '@tastic/achievements'

import { paddleGameCatalog } from '@/shared/paddleGame/constants/achievements'
import { StatsState } from '@/shared/paddleGame/types'
import { getProfileStatsView } from '@/shared/paddleGame/utils/statsEngine'
import { DEFAULT_PROFILE_STATS, DEFAULT_STATS } from '@/shared/paddleGame/utils/statsValidation'

// Breaker's catalog (Paddles' plus the brick achievements); most cases hold for both.
const ACHIEVEMENT_CATALOG = paddleGameCatalog({ hasBricks: true })
const PADDLES_CATALOG = paddleGameCatalog({ hasBricks: false })
const { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } = createAchievementBindings(ACHIEVEMENT_CATALOG, getProfileStatsView)

function stats(overrides: Partial<StatsState>): StatsState {
  return { ...DEFAULT_STATS, ...overrides }
}

describe("the paddle games' catalogs", () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENT_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives Paddles every achievement but the brick ones', () => {
    const paddlesIds = new Set(PADDLES_CATALOG.map((a) => a.id))
    const brickIds = ACHIEVEMENT_CATALOG.map((a) => a.id).filter((id) => !paddlesIds.has(id))
    expect(brickIds.sort()).toEqual(['bricks_cleared_alone_bronze', 'bricks_cleared_alone_gold', 'bricks_cleared_alone_silver', 'bricks_destroyed_bronze', 'bricks_destroyed_gold', 'bricks_destroyed_silver'])
    expect(PADDLES_CATALOG.every((a) => !/brick/i.test(a.description))).toBe(true)
  })

  // Titles may be idioms (Wrecking Ball); a description names the game's piece, the puck.
  it('never says ball or Pong in a description', () => {
    for (const a of ACHIEVEMENT_CATALOG) expect(a.description).not.toMatch(/\bball|\bpong\b/i)
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
    const rich = stats({ points: { scored: 30, conceded: 10 }, shutouts: 2, bestWinMargin: 4 })
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

  it('unlocks bricks_cleared_alone only once a brick field has actually been cleared alone', () => {
    expect(evaluateUnlockedIds(stats({ solo: { played: 3, cleared: 0 } })).has('bricks_cleared_alone_bronze')).toBe(false)
    expect(evaluateUnlockedIds(stats({ solo: { played: 3, cleared: 1 } })).has('bricks_cleared_alone_bronze')).toBe(true)
  })

  it('unlocks bricks_cleared_alone tiers at their thresholds', () => {
    expect(evaluateUnlockedIds(stats({ solo: { played: 10, cleared: 9 } })).has('bricks_cleared_alone_silver')).toBe(false)
    expect(evaluateUnlockedIds(stats({ solo: { played: 10, cleared: 10 } })).has('bricks_cleared_alone_silver')).toBe(true)
  })

  it('unlocks bricks_destroyed tiers at their thresholds', () => {
    expect(evaluateUnlockedIds(stats({ bricksDestroyed: 99 })).has('bricks_destroyed_bronze')).toBe(false)
    expect(evaluateUnlockedIds(stats({ bricksDestroyed: 100 })).has('bricks_destroyed_bronze')).toBe(true)
  })
})

describe('unlockedKey', () => {
  it('keys device-wide unlocks bare and profile unlocks by id', () => {
    expect(unlockedKey('first_ever_win', null)).toBe('first_ever_win')
    expect(unlockedKey('first_ever_win', 'alice')).toBe('alice:first_ever_win')
  })
})
