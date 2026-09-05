import { evaluateUnlockedIds as evaluate } from '@tastic/achievements'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { ProfileStats, StatsState } from '@/types'
import { getProfileStatsView } from '@/utils/statsEngine'

// Thin BoxHockey-side bindings over @tastic/achievements' generic engine — the catalog is a
// module-level constant here, so pre-binding it keeps call sites reading as
// `evaluateUnlockedIds(stats)` rather than threading it through by hand.

export function evaluateUnlockedIds(stats: StatsState): Set<string> {
  return evaluate(ACHIEVEMENT_CATALOG, stats)
}

// `scope: 'profile'` filters out scope:'device' achievements, so this can never produce a bogus
// `profileId:flawless_debut` key.
export function evaluateUnlockedIdsForProfile(profileStats: ProfileStats): Set<string> {
  return evaluate(ACHIEVEMENT_CATALOG, getProfileStatsView(profileStats), { scope: 'profile' })
}

export { unlockedKey } from '@tastic/achievements'
