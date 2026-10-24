import { removeProfileUnlocks, type UnlockedAchievementsState } from '@tastic/achievements'
import { profilesActions } from '@tastic/profile'
import type { Reducer, UnknownAction } from 'redux'

// Wraps one of a game's reducers so it forgets a profile the moment the Profiles screen deletes it
// (the shell's deleteProfile dispatches @tastic/profile's profilesActions.remove), with no need for
// the shell to know which games keep what per profile. A profile a sibling app deleted (a roster
// sync) is deliberately not cleaned up this way: a failed shared-store read reports an empty roster,
// which would erase real players' data for good.
export function onProfileRemoved<S>(reducer: Reducer<S>, forget: (state: S, profileId: string) => S): Reducer<S> {
  return (state: S | undefined, action: UnknownAction) => {
    const next = reducer(state, action)
    return profilesActions.remove.match(action) ? forget(next, action.payload) : next
  }
}

// For a createAchievementsSlice state: drops the profile's unlocks, and its stats through the game's
// own `dropStats` (where a game keeps a per-profile bucket).
export function forgetProfileAchievements<T, S extends { stats: T; unlocked: UnlockedAchievementsState }>(dropStats: (stats: T, profileId: string) => T) {
  return (state: S, profileId: string): S => {
    const stats = dropStats(state.stats, profileId)
    const unlocked = removeProfileUnlocks(state.unlocked, profileId)
    return stats === state.stats && unlocked === state.unlocked ? state : { ...state, stats, unlocked }
  }
}
