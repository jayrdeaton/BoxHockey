import { DEFAULT_DAY_STREAK, DEFAULT_OUTCOME_RECORD, DEFAULT_WIN_STREAK } from '@tastic/achievements'

import { AiDifficulty, BoardVariant, GoalTotals, MatchRecord, ProfileStats, StatsState, TwoPlayerStats, VsCpuStats } from '@/types'

// Kept out of hooks/useGameStats.tsx so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment.

// A zeroed vsCpu/twoPlayer/variants/goals bucket, each built fresh on every call rather than kept as
// a module-level constant — DEFAULT_PROFILE_STATS and DEFAULT_STATS below each need their own
// independent set of nested objects, not two references to the same ones (every consumer only ever
// spreads/reads these today, but a shared reference is a standing invitation for a future in-place
// mutation to corrupt both at once — see DEFAULT_PROFILE_STATS/DEFAULT_STATS's own comment).
function createDefaultVsCpu(): VsCpuStats {
  return {
    ...DEFAULT_OUTCOME_RECORD,
    byDifficulty: { easy: { ...DEFAULT_OUTCOME_RECORD }, medium: { ...DEFAULT_OUTCOME_RECORD }, hard: { ...DEFAULT_OUTCOME_RECORD } },
    ...DEFAULT_WIN_STREAK
  }
}

function createDefaultTwoPlayer(): TwoPlayerStats {
  return { played: 0, p1Wins: 0, p2Wins: 0 }
}

function createDefaultVariants(): Record<BoardVariant, MatchRecord> {
  return {
    classic: { ...DEFAULT_OUTCOME_RECORD },
    gauntlet: { ...DEFAULT_OUTCOME_RECORD },
    gravity: { ...DEFAULT_OUTCOME_RECORD }
  }
}

function createDefaultGoals(): GoalTotals {
  return { scored: 0, conceded: 0 }
}

// A fresh profile's starting bucket.
export const DEFAULT_PROFILE_STATS: ProfileStats = {
  vsCpu: createDefaultVsCpu(),
  twoPlayer: createDefaultTwoPlayer(),
  variants: createDefaultVariants(),
  goals: createDefaultGoals(),
  shutouts: 0,
  bestWinMargin: 0,
  ...DEFAULT_DAY_STREAK
}

// vsCpu/twoPlayer/variants/goals are re-created here rather than spread straight from
// DEFAULT_PROFILE_STATS, specifically so the two don't end up aliasing the same nested objects —
// see createDefaultVsCpu's own doc.
export const DEFAULT_STATS: StatsState = {
  ...DEFAULT_PROFILE_STATS,
  vsCpu: createDefaultVsCpu(),
  twoPlayer: createDefaultTwoPlayer(),
  variants: createDefaultVariants(),
  goals: createDefaultGoals(),
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

// Doesn't reject unrecognized keys — a stray/corrupted bucket key is an inert extra map entry, not
// a reason to discard the whole blob (same philosophy the colors map uses in LightCycles).
function isValidRecordMap(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Object.values(value).every(isValidMatchRecord)
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

function isValidGoals(value: unknown): value is GoalTotals {
  if (!isRecord(value)) return false
  return typeof value.scored === 'number' && typeof value.conceded === 'number'
}

function isValidProfileStats(value: unknown): value is ProfileStats {
  if (!isRecord(value)) return false
  const v = value as Partial<ProfileStats>
  return isValidVsCpu(v.vsCpu) && isValidTwoPlayer(v.twoPlayer) && isValidRecordMap(v.variants) && isValidGoals(v.goals) && typeof v.shutouts === 'number' && typeof v.bestWinMargin === 'number' && typeof v.distinctDaysPlayed === 'number' && typeof v.currentDayStreak === 'number' && typeof v.bestDayStreak === 'number' && (v.lastPlayedDate === null || typeof v.lastPlayedDate === 'string')
}

export function isValidStats(value: unknown): value is StatsState {
  if (!isValidProfileStats(value)) return false
  const v = value as Partial<StatsState>
  // v.profiles === undefined is valid — see useGameStats.tsx's migrateStats, the only "migration"
  // a purely-additive field like this needs.
  const profilesOk = v.profiles === undefined || (isRecord(v.profiles) && Object.values(v.profiles).every(isValidProfileStats))
  return profilesOk && (v.firstGameResult === null || v.firstGameResult === 'win' || v.firstGameResult === 'loss' || v.firstGameResult === 'draw')
}
