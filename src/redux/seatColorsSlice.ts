import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { Player } from '@/types'

// /loadout's own dedicated "remember this color for next time" memory — independent of the live
// theme snapshot (store.ts's own `theme` slice, which always reflects whatever's actually SHOWING
// right now, a selected profile's color included). A seat's live color instead comes from one of
// three independently-remembered places — a selected profile's own saved color, a CPU opponent's
// own remembered color, or (human, no profile) a guest's own remembered color — and only the
// guest/CPU cases ever write back here; a profile-selected seat's color is never persisted to this
// slice (see loadout.tsx's own persistSeatColor). Mirrors Snake's gameSlice.lastGuestColor/
// lastCpuColor exactly (same Record<seat, string> + single string shape) — the fleet's shared
// convention for this exact kind of memory — kept in its own dedicated slice here since, unlike
// Snake, this app has no single all-purpose "game settings" Redux slice to fold it into instead.
export interface SeatColorsState {
  // Per human seat, remembered only for whichever round that seat was a guest (no profile
  // selected) — a profile-selected seat's color always comes live from the profile itself instead
  // (see loadout.tsx's own profile-color effect), never from here.
  lastGuestColor: Record<Player, string>
  // Same idea as lastGuestColor, but for seat 2's CPU slot — kept separate so a CPU opponent's last
  // color and a human guest's last color don't fight over one remembered value. CPU only ever
  // occupies player 2 (see utils/gameMode.ts's humanPlayersFor), so this is a single color, not a
  // per-seat record.
  lastCpuColor: string
}

export const defaultSeatColorsState: SeatColorsState = {
  lastGuestColor: { 1: DEFAULT_P1_COLOR, 2: DEFAULT_P2_COLOR },
  lastCpuColor: DEFAULT_P2_COLOR
}

const slice = createSlice({
  name: 'seatColors',
  initialState: defaultSeatColorsState,
  reducers: {
    setLastGuestColor: (state, action: PayloadAction<{ seat: Player; color: string }>) => ({
      ...state,
      lastGuestColor: { ...state.lastGuestColor, [action.payload.seat]: action.payload.color }
    }),
    setLastCpuColor: (state, action: PayloadAction<string>) => ({ ...state, lastCpuColor: action.payload })
  }
})

export const seatColorsActions = slice.actions
export default slice.reducer
