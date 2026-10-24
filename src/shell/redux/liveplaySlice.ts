import { createSettingsSlice } from '@rific/core'

import type { RoundMode } from '@/shell/types'

// The round a loadout committed: which game, how seat 2 was set up, and a snapshot of that game's
// settings, so changing a setting mid-match only affects the next match. The game's play screen
// reads its own settings back out (see useActiveRound).
export interface ActiveRound {
  game: string
  mode: RoundMode
  settings: object
}

// Transient per-round state, blacklisted from redux-persist in createPackStore.ts: none of it may
// survive a relaunch. A crash or force-quit mid-round leaving `activelyPlaying` stuck true in
// storage would re-enable Edge Guard (see Providers.tsx's EdgeGuardBridge) the moment the app
// cold-launches back to Home, before any play screen could correct it. Built on @rific/core's
// createSettingsSlice: one generated setter per field.
export type LiveplaySliceState = {
  // Whether a play screen has a live, unpaused round in progress right now (not merely "a play
  // screen is mounted"). Written by the play screen as its phase changes, and reset to false on its
  // unmount so leaving mid-round by any path can't leave it stuck true.
  activelyPlaying: boolean
  // null until a round has been committed (a direct link to a play screen falls back to the game's
  // defaults and a CPU opponent).
  activeRound: ActiveRound | null
}

const { actions, reducer } = createSettingsSlice<LiveplaySliceState>('liveplay', {
  initialState: { activelyPlaying: false, activeRound: null }
})

export const liveplayActions = actions
export default reducer
