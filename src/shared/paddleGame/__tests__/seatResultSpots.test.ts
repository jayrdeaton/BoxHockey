import { seatResultSpots } from '@/shared/paddleGame/utils/seatResultSpots'

// Where each 2 Player seat's Game Over card goes: their own half (their touch zone), facing them.
describe('seatResultSpots', () => {
  it('puts player 1 at the bottom of a turned court and player 2 across the table, turned to face them', () => {
    expect(seatResultSpots(-90, false)).toEqual({ 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 180, zone: 'top' } })
  })

  it('follows the court over when the phone is held upside down', () => {
    expect(seatResultSpots(90, false)).toEqual({ 1: { rotation: 180, zone: 'top' }, 2: { rotation: 0, zone: 'bottom' } })
  })

  it('splits an unturned court left and right, both upright', () => {
    expect(seatResultSpots(0, false)).toEqual({ 1: { rotation: 0, zone: 'left' }, 2: { rotation: 0, zone: 'right' } })
    expect(seatResultSpots(0, true)).toEqual({ 1: { rotation: 0, zone: 'left' }, 2: { rotation: 0, zone: 'right' } })
  })

  it('keeps both cards upright on a computer screen', () => {
    expect(seatResultSpots(-90, true)).toEqual({ 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 0, zone: 'top' } })
  })
})
