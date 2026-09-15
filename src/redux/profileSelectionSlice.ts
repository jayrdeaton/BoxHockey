import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { Player } from '@/types'

// Which profile each seat last picked — always local, never part of the shared App Group roster
// (@tastic/profile's own profiles slice, see store.ts): who's selected on THIS device is naturally
// a per-app, per-device thing, not something a sibling @tastic game should see or influence.
export type ProfileSelectionState = Record<Player, string | null>

export const defaultProfileSelectionState: ProfileSelectionState = { 1: null, 2: null }

const slice = createSlice({
  name: 'profileSelection',
  initialState: defaultProfileSelectionState,
  reducers: {
    select: (state, action: PayloadAction<{ profileId: string | null; seat: Player }>) => ({ ...state, [action.payload.seat]: action.payload.profileId }),
    // Clears whichever seat(s) currently point at a just-deleted profile id, so /loadout
    // immediately reflects a guest seat rather than a dangling id. Independent of the profiles
    // slice's own `remove` action (a separate dispatch, not a single combined one) — with profiles
    // now in Redux, two sequential dispatches in the same handler no longer risk the stale-closure
    // clobber the old useState-based version had to work around (see useProfiles.tsx).
    clearProfile: (state, action: PayloadAction<string>) => ({
      1: state[1] === action.payload ? null : state[1],
      2: state[2] === action.payload ? null : state[2]
    })
  }
})

export const profileSelectionActions = slice.actions
export default slice.reducer
