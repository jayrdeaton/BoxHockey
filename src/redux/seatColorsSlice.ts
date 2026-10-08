import { createSeatColorsSlice, type SeatColorsState as GenericSeatColorsState } from '@tastic/profile'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { Player } from '@/types'

// The loadout's per-seat color memory: a thin binding over @tastic/profile's createSeatColorsSlice
// (see its doc for each field: a guest seat's last color, the CPU seat's last color, and a manual
// recolor overriding a profile-selected seat's own color until that seat's selection changes). Not a
// setting: the player's settings live in settingsSlice.ts.
export type SeatColorsState = GenericSeatColorsState<Player>

export const defaultSeatColorsState: SeatColorsState = {
  lastGuestColor: { 1: DEFAULT_P1_COLOR, 2: DEFAULT_P2_COLOR },
  lastCpuColor: DEFAULT_P2_COLOR,
  profileOverride: { 1: null, 2: null }
}

const slice = createSeatColorsSlice<Player>('boxhockey', defaultSeatColorsState)

export const seatColorsActions = slice.actions
export default slice.reducer
