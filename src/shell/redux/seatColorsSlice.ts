import { createSeatColorsSlice, type SeatColorsState as GenericSeatColorsState } from '@tastic/profile'

import { DEFAULT_SEAT_COLORS } from '@/shell/seatColors'
import type { Seat } from '@/shell/types'

// The loadout's per-seat color memory: a thin binding over @tastic/profile's createSeatColorsSlice
// (see its doc for each field: a guest seat's last color, the CPU seat's last color, and each
// profile's own color pick in this pack, kept by profile id). One memory for every game in the
// pack, so a player's color follows them from one game to the next.
export type SeatColorsState = GenericSeatColorsState<Seat>

export const defaultSeatColorsState: SeatColorsState = {
  lastGuestColor: { 1: DEFAULT_SEAT_COLORS[1], 2: DEFAULT_SEAT_COLORS[2] },
  lastCpuColor: DEFAULT_SEAT_COLORS[2],
  profileColors: {}
}

// 'pack' only prefixes the action types; the state is stored under seatColors.
const slice = createSeatColorsSlice<Seat>('pack', defaultSeatColorsState)

export const seatColorsActions = slice.actions
export default slice.reducer
