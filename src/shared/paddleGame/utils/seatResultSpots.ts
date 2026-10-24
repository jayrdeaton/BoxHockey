import type { Player } from '@/shared/paddleGame/types'

/** One 2 Player seat's Game Over card: the half of the screen that's theirs (the screen as the app lays it out, portrait-locked, so 'top'
 * is the device's own top half however it's held) and the angle it's turned to face them. */
export interface SeatSpot {
  rotation: 0 | 90 | 180 | -90
  zone: 'bottom' | 'left' | 'right' | 'top'
}

/** Where each 2 Player seat's Game Over card goes, from the court's rotation (game.tsx's `rotation`): each player's half is their touch zone
 * (TouchInputLayer's zoneA for player 1), and the card faces that half's outer edge, where they sit. A turned court (every 2 Player match on
 * a phone, face to face) puts player 1 at the bottom (the top when held upside down) and player 2 across from them; an unturned one (a
 * browser window wider than tall) is side by side, player 1 on the left, both upright. A computer screen keeps both upright, since its
 * players sit side by side whatever its shape. */
export function seatResultSpots(courtRotation: 0 | 90 | -90, desktopWeb: boolean): Record<Player, SeatSpot> {
  if (courtRotation === 0) return { 1: { rotation: 0, zone: 'left' }, 2: { rotation: 0, zone: 'right' } }
  const p1AtBottom = courtRotation === -90
  if (desktopWeb) return p1AtBottom ? { 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 0, zone: 'top' } } : { 1: { rotation: 0, zone: 'top' }, 2: { rotation: 0, zone: 'bottom' } }
  return p1AtBottom ? { 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 180, zone: 'top' } } : { 1: { rotation: 180, zone: 'top' }, 2: { rotation: 0, zone: 'bottom' } }
}
