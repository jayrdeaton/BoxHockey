import { seatResultSpots } from '@/games/airhockey/utils/seatResultSpots'

// Where each 2 Player seat's Game Over card goes: their own end of the rink, facing them.
describe('seatResultSpots', () => {
  it('puts player 1 at the bottom and player 2 across the table, turned to face them', () => {
    expect(seatResultSpots(0, false)).toEqual({ 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 180, zone: 'top' } })
  })

  it('splits a turned rink by the end each player defends, both upright', () => {
    expect(seatResultSpots(90, false)).toEqual({ 1: { rotation: 0, zone: 'left' }, 2: { rotation: 0, zone: 'right' } })
    expect(seatResultSpots(-90, true)).toEqual({ 1: { rotation: 0, zone: 'right' }, 2: { rotation: 0, zone: 'left' } })
  })

  it('keeps both cards upright on a computer screen', () => {
    expect(seatResultSpots(0, true)).toEqual({ 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 0, zone: 'top' } })
  })
})
