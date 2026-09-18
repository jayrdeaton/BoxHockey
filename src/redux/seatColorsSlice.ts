import { createSeatColorsSlice, type SeatColorsState as GenericSeatColorsState } from '@tastic/profile'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { Player } from '@/types'

// Thin binding over @tastic/profile's createSeatColorsSlice — this app's own seatColorsSlice.ts was
// the reference implementation the factory was extracted from (see that package's own doc comment
// on createSeatColorsSlice), so this is now just the app-specific glue: the Player seat type, this
// app's own default colors, and the 'boxhockey' namespace that prefixes every action type (e.g.
// 'seatColors/boxhockey/setLastGuestColor') so this slice's actions never collide with another
// independent seat-colors concern in the same app.
export type SeatColorsState = GenericSeatColorsState<Player>

export const defaultSeatColorsState: SeatColorsState = {
  lastGuestColor: { 1: DEFAULT_P1_COLOR, 2: DEFAULT_P2_COLOR },
  lastCpuColor: DEFAULT_P2_COLOR,
  profileOverride: { 1: null, 2: null }
}

const slice = createSeatColorsSlice<Player>('boxhockey', defaultSeatColorsState)

export const seatColorsActions = slice.actions
export default slice.reducer
