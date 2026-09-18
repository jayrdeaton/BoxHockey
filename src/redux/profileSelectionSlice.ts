import { createProfileSelectionSlice } from '@tastic/profile'

import { Player } from '@/types'

// Which profile each seat last picked — always local, never part of the shared App Group roster
// (@tastic/profile's own profiles slice, see store.ts): who's selected on THIS device is naturally
// a per-app, per-device thing, not something a sibling @tastic game should see or influence. This
// was a hand-rolled Record<Player, string|null> reducer identical to 4 sibling apps' own copies
// before @tastic/profile's createProfileSelectionSlice factory existed to generalize it away.
export type ProfileSelectionState = Record<Player, string | null>

export const defaultProfileSelectionState: ProfileSelectionState = { 1: null, 2: null }

const { actions, reducer } = createProfileSelectionSlice<Player>('boxhockey', defaultProfileSelectionState)

export const profileSelectionActions = actions
export default reducer
