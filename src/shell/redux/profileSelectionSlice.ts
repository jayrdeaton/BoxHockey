import { createProfileSelectionSlice } from '@tastic/profile'

import type { Seat } from '@/shell/types'

// Which profile each seat last picked, for the whole pack: seat 1 is Home's who's-playing button
// and seat 1 in every loadout, seat 2 is seat 2 in every loadout. Always local, never part of the
// shared App Group roster (@tastic/profile's own profiles slice, see createPackStore.ts): who's
// selected on THIS device is a per-app, per-device thing a sibling @tastic app shouldn't see.
export type ProfileSelectionState = Record<Seat, string | null>

export const defaultProfileSelectionState: ProfileSelectionState = { 1: null, 2: null }

// 'pack' only prefixes the action types; the state is stored under profileSelection.
const { actions, reducer } = createProfileSelectionSlice<Seat>('pack', defaultProfileSelectionState)

export const profileSelectionActions = actions
export default reducer
