import { createAchievementBindings } from '@tastic/achievements'

import { ACHIEVEMENT_CATALOG } from '@/games/airhockey/constants/achievements'
import { getProfileStatsView } from '@/games/airhockey/utils/statsEngine'

// Thin AirHockey-side bindings over @tastic/achievements' generic engine - the catalog is a
// module-level constant here, so pre-binding it keeps call sites reading as
// `evaluateUnlockedIds(stats)` rather than threading it through by hand. Re-exported under these
// exact names so no other call site in this app has to change its own import.
export const { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } = createAchievementBindings(ACHIEVEMENT_CATALOG, getProfileStatsView)
