import { createAchievementBindings } from '@tastic/achievements'

import { ACHIEVEMENT_CATALOG } from '@/games/boxhockey/constants/achievements'
import { getProfileStatsView } from '@/games/boxhockey/utils/statsEngine'

// Thin BoxHockey-side bindings over @tastic/achievements' generic createAchievementBindings
// factory - the catalog and getProfileStatsView are module-level constants here, so pre-binding
// them keeps call sites reading as `evaluateUnlockedIds(stats)`/
// `evaluateUnlockedIdsForProfile(profileStats)` rather than threading them through by hand. Same
// three export names this file has always had, so no other call site needs to change its import.
export const { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } = createAchievementBindings(ACHIEVEMENT_CATALOG, getProfileStatsView)
