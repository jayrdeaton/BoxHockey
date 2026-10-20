import { seatToastSpots } from '@/utils/seatToastSpots'

// Where each 2 Player seat's unlock toasts go: the half of the screen that's theirs, turned the way they read it.
describe('seatToastSpots', () => {
  it('puts each player at their own end face to face, player 2 turned across the table', () => {
    expect(seatToastSpots({ orientationMode: 'faceToFace', p1OnRight: true, upsideDown: false }, false)).toEqual({ 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 180, zone: 'top' } })
  })

  it('follows the board over when the phone is held upside down', () => {
    expect(seatToastSpots({ orientationMode: 'faceToFace', p1OnRight: true, upsideDown: true }, false)).toEqual({ 1: { rotation: 180, zone: 'top' }, 2: { rotation: 0, zone: 'bottom' } })
  })

  it("keeps players side by side in a landscape hold on their own half of the board, both reading it the card's way", () => {
    expect(seatToastSpots({ orientationMode: 'sideBySide', p1OnRight: true, upsideDown: false }, false)).toEqual({ 1: { rotation: -90, zone: 'bottom' }, 2: { rotation: -90, zone: 'top' } })
    expect(seatToastSpots({ orientationMode: 'sideBySide', p1OnRight: false, upsideDown: false }, false)).toEqual({ 1: { rotation: 90, zone: 'bottom' }, 2: { rotation: 90, zone: 'top' } })
  })

  it('splits a computer screen left and right, both upright', () => {
    const sideBySide = { 1: { rotation: 0, zone: 'left' }, 2: { rotation: 0, zone: 'right' } }
    expect(seatToastSpots({ orientationMode: 'faceToFace', p1OnRight: false, upsideDown: false }, true, true)).toEqual(sideBySide)
    // A browser window wider than tall, short of the desktop width.
    expect(seatToastSpots({ orientationMode: 'sideBySide', p1OnRight: false, upsideDown: false }, false, true)).toEqual(sideBySide)
  })
})
