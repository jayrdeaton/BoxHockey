import { createSettingsSlice } from '@rific/core'

import type { Settings } from '@/types'

// Transient per-round state, blacklisted from redux-persist in store.ts: none of it may survive a
// relaunch. A crash or force-quit mid-round leaving `activelyPlaying` stuck true in storage would
// re-enable Edge Guard (see Providers.tsx's EdgeGuardBridge) the moment the app cold-launches back
// to the title screen, before any game screen could correct it. Built on @rific/core's
// createSettingsSlice like the persisted `settings` slice: one generated setter per field.
export type LiveplaySliceState = {
  // Whether /game has a live, unpaused round in progress right now (not merely "the /game screen is
  // mounted"). Written by game.tsx as its phase changes, and reset to false on that screen's unmount
  // so leaving mid-round by any path can't leave it stuck true.
  activelyPlaying: boolean
  // The settings this round was started with: a snapshot of `settings`, committed by /loadout when
  // every human player readies up, so changing a setting mid-match only affects the next match.
  // null until a round has been committed (a direct link to /game falls back to the defaults).
  activeRoundSettings: Settings | null
}

const { actions, reducer } = createSettingsSlice<LiveplaySliceState>('liveplay', {
  initialState: { activelyPlaying: false, activeRoundSettings: null }
})

export const liveplayActions = actions
export default reducer
