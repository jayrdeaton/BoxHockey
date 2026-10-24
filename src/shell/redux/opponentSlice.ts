import { createSettingsSlice } from '@rific/core'

import type { SeatTwo } from '@/shell/types'

// Who sits in seat 2, for the whole pack: picked from seat 2's own button in any game's loadout and
// kept from one game to the next and across relaunches, since it's usually the same two people.
// A fresh install starts on the CPU, so one person (App Review included) can tap a game and play.
// A game without 'nobody' among its seat-2 choices treats a saved 'nobody' as the CPU (see
// LoadoutScreen's seatTwoFor).
export interface OpponentState {
  seatTwo: SeatTwo
}

export const DEFAULT_OPPONENT: OpponentState = { seatTwo: 'cpu' }

const { actions, reducer } = createSettingsSlice<OpponentState>('opponent', {
  initialState: DEFAULT_OPPONENT
})

export const opponentActions = actions
export default reducer
