import { AchievementTier, tieredFamily } from '@tastic/achievements'

import { AchievementDefinition, AiDifficulty, StatsState } from '@/games/airhockey/types'
import { getOverallTotals } from '@/games/airhockey/utils/statsEngine'

export { ACHIEVEMENT_TIER_COLORS } from '@tastic/achievements'

const AI_DIFFICULTY_TIER: Record<AiDifficulty, AchievementTier> = { easy: 'bronze', medium: 'silver', hard: 'gold' }
const AI_DIFFICULTY_LABEL: Record<AiDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

// Three different predicates, not one value against three thresholds - hand-written, and with no
// `progress`, since "40% of the way to beating Hard once" isn't a meaningful fraction.
function beatCpuFamily(): AchievementDefinition[] {
  const titles: Record<AiDifficulty, string> = { easy: 'Warmed Up', medium: 'Contender', hard: 'Table Legend' }
  return (['easy', 'medium', 'hard'] as AiDifficulty[]).map((difficulty) => ({
    id: `beat_cpu_${difficulty}`,
    title: titles[difficulty],
    description: `Beat the CPU on ${AI_DIFFICULTY_LABEL[difficulty]} difficulty.`,
    tier: AI_DIFFICULTY_TIER[difficulty],
    icon: 'robot',
    isUnlocked: (stats: StatsState) => stats.vsCpu.byDifficulty[difficulty].wins >= 1
  }))
}

export const ACHIEVEMENT_CATALOG: AchievementDefinition[] = [
  { id: 'first_game_played', title: 'Drop the Puck', description: 'Play your first match.', tier: 'bronze', icon: 'flag-checkered', isUnlocked: (stats) => getOverallTotals(stats).played >= 1 },
  { id: 'first_ever_win', title: 'First Blood', description: 'Win any match, any time.', tier: 'bronze', icon: 'star', isUnlocked: (stats) => getOverallTotals(stats).wins >= 1 },
  {
    id: 'flawless_debut',
    title: 'Natural',
    description: 'Win the very first match you ever play.',
    tier: 'gold',
    icon: 'star-circle',
    // firstGameResult is a one-time device-wide flag with no per-profile analog, so it always
    // evaluates against the real device stats regardless of which profile tab is selected.
    scope: 'device',
    isUnlocked: (stats) => stats.firstGameResult === 'win'
  },
  ...tieredFamily<StatsState>({ id: 'games_played', titles: { bronze: 'Rookie', silver: 'Regular', gold: 'Veteran' }, description: (n) => `Play ${n} total matches.`, icon: 'hockey-sticks', thresholds: { bronze: 10, silver: 50, gold: 200 }, value: (stats) => getOverallTotals(stats).played }),
  ...tieredFamily<StatsState>({ id: 'total_wins', titles: { bronze: 'Winner', silver: 'Big Winner', gold: 'Champion' }, description: (n) => `Win ${n} total matches.`, icon: 'trophy', thresholds: { bronze: 10, silver: 50, gold: 200 }, value: (stats) => getOverallTotals(stats).wins }),
  ...tieredFamily<StatsState>({ id: 'goals_scored', titles: { bronze: 'Sniper', silver: 'Sharpshooter', gold: 'Goal Machine' }, description: (n) => `Score ${n} total goals.`, icon: 'hockey-puck', thresholds: { bronze: 50, silver: 250, gold: 1000 }, value: (stats) => stats.goals.scored }),
  ...tieredFamily<StatsState>({ id: 'shutouts', titles: { bronze: 'Clean Sheet', silver: 'Brick Wall', gold: 'Untouchable' }, description: (n) => `Win ${n} matches without conceding a single goal.`, icon: 'shield-check', thresholds: { bronze: 1, silver: 10, gold: 40 }, value: (stats) => stats.shutouts }),
  ...tieredFamily<StatsState>({ id: 'win_margin', titles: { bronze: 'Comfortable', silver: 'Dominant', gold: 'Humiliating' }, description: (n) => `Win a match by ${n} goals or more.`, icon: 'chart-line', thresholds: { bronze: 3, silver: 5, gold: 7 }, value: (stats) => stats.bestWinMargin }),
  ...tieredFamily<StatsState>({ id: 'goal_door', titles: { bronze: 'Off the Post', silver: 'Rattled', gold: 'Woodwork Specialist' }, description: (n) => `Ring the goal door ${n} times.`, icon: 'door', thresholds: { bronze: 25, silver: 150, gold: 600 }, value: (stats) => stats.goalDoorHits }),
  ...tieredFamily<StatsState>({ id: 'cpu_streak', titles: { bronze: 'On a Roll', silver: 'Hot Streak', gold: 'Unstoppable' }, description: (n) => `Win ${n} matches in a row against the CPU.`, icon: 'fire', thresholds: { bronze: 3, silver: 5, gold: 10 }, value: (stats) => stats.vsCpu.bestWinStreak }),
  ...beatCpuFamily(),
  ...tieredFamily<StatsState>({ id: 'local_matches', titles: { bronze: 'Pass the Phone', silver: 'Couch Champion', gold: 'Living Room Legend' }, description: (n) => `Play ${n} local two-player matches.`, icon: 'account-multiple', thresholds: { bronze: 10, silver: 50, gold: 150 }, value: (stats) => stats.twoPlayer.played }),
  ...tieredFamily<StatsState>({ id: 'days_played', titles: { bronze: 'Regular Visitor', silver: 'Dedicated', gold: 'Devoted' }, description: (n) => `Play ${n} days in a row.`, icon: 'calendar-check', thresholds: { bronze: 3, silver: 14, gold: 30 }, value: (stats) => stats.bestDayStreak })
]
