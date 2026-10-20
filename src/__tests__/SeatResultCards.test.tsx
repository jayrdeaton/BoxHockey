import { fireEvent, render, screen, within } from '@testing-library/react-native'

import { SeatResultCards } from '@/components/SeatResultCards'

const COLORS = { 1: '#E53935', 2: '#1E88E5' }
const ON_COLORS = { 1: '#FFFFFF', 2: '#FFFFFF' }
const FACE_TO_FACE = { 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: 180, zone: 'top' } } as const

// The card inside a seat's half: its rotation, flattened from its style.
const cardRotation = (seat: 1 | 2) => {
  const zone = screen.getByTestId(`seat-result-${seat}`)
  const card = zone.children[0] as unknown as { props: { style: unknown } }
  const transform = Object.assign({}, ...[card.props.style].flat(Infinity).filter(Boolean)).transform
  return transform?.[0]?.rotate ?? '0deg'
}
const zoneStyle = (seat: 1 | 2) => Object.assign({}, ...[screen.getByTestId(`seat-result-${seat}`).props.style].flat(Infinity).filter(Boolean))

// The nearest view laying its children out in a row: hud's action row, for a card's buttons.
const rowOf = (el: { parent: unknown }) => {
  let node = el.parent as { parent: unknown; props?: { style?: unknown } } | null
  while (node && Object.assign({}, ...[node.props?.style].flat(Infinity).filter(Boolean)).flexDirection !== 'row') node = node.parent as typeof node
  return node
}

const renderCards = (props: Partial<Parameters<typeof SeatResultCards>[0]> = {}) => {
  const onPlayAgain = jest.fn()
  const onQuit = jest.fn()
  return render(<SeatResultCards winner={1} scores={[7, 4]} playerColor={COLORS} playerOnColor={ON_COLORS} spots={FACE_TO_FACE} onPlayAgain={onPlayAgain} onQuit={onQuit} {...props} />).then(() => ({ onPlayAgain, onQuit }))
}

describe('SeatResultCards', () => {
  it('gives each seat its own card, in its own half, saying whether that player won, their score first', async () => {
    await renderCards()
    const seat1 = within(screen.getByTestId('seat-result-1'))
    const seat2 = within(screen.getByTestId('seat-result-2'))
    expect(seat1.getByText('YOU WIN!')).toBeTruthy()
    expect(seat1.getByText('7')).toBeTruthy()
    expect(seat2.getByText('YOU LOSE!')).toBeTruthy()
    expect(seat2.queryByText('YOU WIN!')).toBeNull()
    expect(zoneStyle(1)).toMatchObject({ top: '50%', bottom: 0 })
    expect(zoneStyle(2)).toMatchObject({ top: 0, bottom: '50%' })
  })

  it('turns each card to face its own seat', async () => {
    await renderCards()
    expect(cardRotation(1)).toBe('0deg')
    expect(cardRotation(2)).toBe('180deg')
  })

  it('follows the spots it is given (a sideways hold, both reading the same way)', async () => {
    await renderCards({ spots: { 1: { rotation: -90, zone: 'bottom' }, 2: { rotation: -90, zone: 'top' } } })
    expect(cardRotation(1)).toBe('-90deg')
    expect(cardRotation(2)).toBe('-90deg')
  })

  it("puts each card's Quit and Play Again side by side on hud's action row, Quit first", async () => {
    await renderCards()
    for (const seat of [1, 2] as const) {
      const card = within(screen.getByTestId(`seat-result-${seat}`))
      const row = rowOf(card.getByText('Quit'))
      expect(row).not.toBeNull()
      expect(rowOf(card.getByText('Play Again'))).toBe(row)
    }
  })

  it("acts on either seat's press at once", async () => {
    const { onPlayAgain, onQuit } = await renderCards()
    await fireEvent.press(within(screen.getByTestId('seat-result-2')).getByText('Play Again'))
    expect(onPlayAgain).toHaveBeenCalledTimes(1)
    await fireEvent.press(within(screen.getByTestId('seat-result-1')).getByText('Quit'))
    expect(onQuit).toHaveBeenCalledTimes(1)
  })
})
