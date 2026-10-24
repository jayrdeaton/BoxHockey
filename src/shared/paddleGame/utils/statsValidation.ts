import { DEFAULT_DAY_STREAK, DEFAULT_OUTCOME_RECORD, DEFAULT_WIN_STREAK } from '@tastic/achievements'

import { AiDifficulty, BallSpeedLevel, MatchRecord, PointTotals, ProfileStats, SoloStats, StatsState, TwoPlayerStats, VsCpuStats } from '@/shared/paddleGame/types'

// Kept out of hooks/useGameStats.tsx so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment.

// Each bucket is built by its own factory function, not a plain module constant - DEFAULT_PROFILE_STATS
// and DEFAULT_STATS below each need their own independent objects, not two references to the same
// one (every consumer only ever spreads/reads these today, but a shared reference is a standing
// invitation for a future in-place mutation to corrupt both at once - see DEFAULT_STATS' own doc).
function createDefaultVsCpu(): VsCpuStats {
  return {
    ...DEFAULT_OUTCOME_RECORD,
    byDifficulty: {
      easy: { ...DEFAULT_OUTCOME_RECORD },
      medium: { ...DEFAULT_OUTCOME_RECORD },
      hard: { ...DEFAULT_OUTCOME_RECORD }
    },
    ...DEFAULT_WIN_STREAK
  }
}

function createDefaultTwoPlayer(): TwoPlayerStats {
  return { played: 0, p1Wins: 0, p2Wins: 0 }
}

function createDefaultSolo(): SoloStats {
  return { played: 0, cleared: 0 }
}

function createDefaultPoints(): PointTotals {
  return { scored: 0, conceded: 0 }
}

function createDefaultBySpeed(): Record<BallSpeedLevel, MatchRecord> {
  return {
    slow: { ...DEFAULT_OUTCOME_RECORD },
    medium: { ...DEFAULT_OUTCOME_RECORD },
    fast: { ...DEFAULT_OUTCOME_RECORD }
  }
}

// A fresh profile's starting bucket - same zeroed vsCpu/twoPlayer/points/bySpeed shape as
// DEFAULT_STATS' own top-level fields, since ProfileStats mirrors StatsState's decomposable parts
// (see types/index.ts).
export const DEFAULT_PROFILE_STATS: ProfileStats = {
  vsCpu: createDefaultVsCpu(),
  twoPlayer: createDefaultTwoPlayer(),
  solo: createDefaultSolo(),
  points: createDefaultPoints(),
  shutouts: 0,
  bestWinMargin: 0,
  bySpeed: createDefaultBySpeed(),
  bricksDestroyed: 0,
  ...DEFAULT_DAY_STREAK
}

// vsCpu/twoPlayer/solo/points/bySpeed are re-created here rather than spread straight from
// DEFAULT_PROFILE_STATS, specifically so the two don't end up aliasing the same nested objects -
// see createDefaultVsCpu's own doc above. shutouts/bestWinMargin/bricksDestroyed/the
// DEFAULT_DAY_STREAK fields are plain numbers/strings, so aliasing them via the spread below is
// harmless.
export const DEFAULT_STATS: StatsState = {
  ...DEFAULT_PROFILE_STATS,
  vsCpu: createDefaultVsCpu(),
  twoPlayer: createDefaultTwoPlayer(),
  solo: createDefaultSolo(),
  points: createDefaultPoints(),
  bySpeed: createDefaultBySpeed(),
  profiles: {},
  firstGameResult: null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isValidMatchRecord(value: unknown): value is MatchRecord {
  if (!isRecord(value)) return false
  return typeof value.played === 'number' && typeof value.wins === 'number' && typeof value.losses === 'number' && typeof value.draws === 'number'
}

function isValidVsCpu(value: unknown): value is VsCpuStats {
  if (!isValidMatchRecord(value)) return false
  const v = value as unknown as Partial<VsCpuStats>
  const byDifficulty = v.byDifficulty as Partial<Record<AiDifficulty, MatchRecord>> | undefined
  return typeof v.currentWinStreak === 'number' && typeof v.bestWinStreak === 'number' && isRecord(byDifficulty) && isValidMatchRecord(byDifficulty.easy) && isValidMatchRecord(byDifficulty.medium) && isValidMatchRecord(byDifficulty.hard)
}

function isValidTwoPlayer(value: unknown): value is TwoPlayerStats {
  if (!isRecord(value)) return false
  return typeof value.played === 'number' && typeof value.p1Wins === 'number' && typeof value.p2Wins === 'number'
}

function isValidSolo(value: unknown): value is SoloStats {
  if (!isRecord(value)) return false
  return typeof value.played === 'number' && typeof value.cleared === 'number'
}

function isValidPoints(value: unknown): value is PointTotals {
  if (!isRecord(value)) return false
  return typeof value.scored === 'number' && typeof value.conceded === 'number'
}

function isValidBySpeed(value: unknown): boolean {
  if (!isRecord(value)) return false
  return isValidMatchRecord(value.slow) && isValidMatchRecord(value.medium) && isValidMatchRecord(value.fast)
}

function isValidProfileStats(value: unknown): value is ProfileStats {
  if (!isRecord(value)) return false
  const v = value as Partial<ProfileStats>
  return isValidVsCpu(v.vsCpu) && isValidTwoPlayer(v.twoPlayer) && isValidSolo(v.solo) && isValidPoints(v.points) && typeof v.shutouts === 'number' && typeof v.bestWinMargin === 'number' && isValidBySpeed(v.bySpeed) && typeof v.bricksDestroyed === 'number' && typeof v.distinctDaysPlayed === 'number' && typeof v.currentDayStreak === 'number' && typeof v.bestDayStreak === 'number' && (v.lastPlayedDate === null || typeof v.lastPlayedDate === 'string')
}

export function isValidStats(value: unknown): value is StatsState {
  if (!isValidProfileStats(value)) return false
  const v = value as Partial<StatsState>
  const profilesOk = v.profiles === undefined || (isRecord(v.profiles) && Object.values(v.profiles).every(isValidProfileStats))
  return profilesOk && (v.firstGameResult === null || v.firstGameResult === 'win' || v.firstGameResult === 'loss' || v.firstGameResult === 'draw')
}
