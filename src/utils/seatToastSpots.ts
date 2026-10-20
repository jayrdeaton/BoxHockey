import { getViewRotation, type OrientationState } from '@tastic/core'
import { Platform } from 'react-native'

import type { SeatToastSpot } from '@/components/SeatToasters'
import type { Player } from '@/types'

/** Where each 2 Player seat's unlock toasts go (SeatToasters), from the live hold: the half of the screen that's theirs, turned the way they
 * read it. Side by side, each player's stack stays on their own half, so three toasts for one and one for the other are two stacks, one on
 * each side (Jay, 2026-10-20). */
export function seatToastSpots({ orientationMode, p1OnRight, upsideDown }: Pick<OrientationState, 'orientationMode' | 'p1OnRight' | 'upsideDown'>, desktopWeb: boolean, web = Platform.OS === 'web'): Record<Player, SeatToastSpot> {
  // At one monitor, or a browser window wider than tall: side by side, upright, player 1 on the left (A/D) and player 2 on the right (the
  // arrows).
  if (desktopWeb || (web && orientationMode === 'sideBySide')) return { 1: { rotation: 0, zone: 'left' }, 2: { rotation: 0, zone: 'right' } }
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  // A landscape hold: side by side along the long edge, both reading it the Game Over card's way, each over their own half of the board (the
  // board never turns a quarter, so player 1's is still the device's bottom half).
  if (orientationMode === 'sideBySide') return { 1: { rotation, zone: 'bottom' }, 2: { rotation, zone: 'top' } }
  // Face to face, each at their own end: player 1 where the card faces (an upside-down hold turns the board, player 1's half included, over
  // to the device's top), player 2 across from them.
  return upsideDown ? { 1: { rotation: 180, zone: 'top' }, 2: { rotation: 0, zone: 'bottom' } } : { 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 180, zone: 'top' } }
}
