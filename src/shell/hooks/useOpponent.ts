import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { opponentActions } from '@/shell/redux/opponentSlice'
import type { ShellState } from '@/shell/redux/shellState'
import type { SeatTwo } from '@/shell/types'

// Who sits in seat 2 across the pack (see opponentSlice.ts).
export function useOpponent(): { seatTwo: SeatTwo; setSeatTwo: (seatTwo: SeatTwo) => void } {
  const seatTwo = useSelector((state: ShellState) => state.opponent.seatTwo)
  const dispatch = useDispatch()
  const setSeatTwo = useCallback((next: SeatTwo) => dispatch(opponentActions.setSeatTwo(next)), [dispatch])
  return { seatTwo, setSeatTwo }
}
