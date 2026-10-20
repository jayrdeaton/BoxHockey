import { render, screen, within } from '@testing-library/react-native'
import { Dimensions, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SeatToasters } from '@/components/SeatToasters'

// Each Toaster is drawn as its stack's name in the frame it hands renderFrame, followed by the safe-area insets the frame provides: which
// toasts a stack shows, and how it lays them out against those insets, are @rific/toaster's to test.
const mockToasterProps: Record<string, unknown>[] = []
jest.mock('@rific/toaster', () => {
  const { createElement } = jest.requireActual('react')
  return {
    Toaster: (props: { renderFrame: (stack: unknown) => unknown; stack: string }) => {
      mockToasterProps.push(props)
      return props.renderFrame(createElement(MockStackProbe, { stack: props.stack }))
    }
  }
})
const MockStackProbe = ({ stack }: { stack: string }) => <Text testID={`${stack}-insets`}>{JSON.stringify(useSafeAreaInsets())}</Text>

// The real context, so a frame's own insets reach what's inside it; a notch at the top and a home indicator at the bottom.
const INSETS = { bottom: 34, left: 0, right: 0, top: 47 }
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: jest.fn() }))
const { SafeAreaInsetsContext } = jest.requireActual('react-native-safe-area-context')
beforeEach(() => {
  mockToasterProps.length = 0
  // Outside a frame, the device's insets; inside one, whatever the frame provides.
  jest.mocked(useSafeAreaInsets).mockImplementation(() => jest.requireActual('react').useContext(SafeAreaInsetsContext) ?? INSETS)
})

const { height: H, width: W } = Dimensions.get('window')
const frame = (stack: string) => {
  const { height, left, top, transform, width } = Object.assign({}, ...[screen.getByTestId(`${stack}-frame`).props.style].flat())
  return { height, left, rotate: transform[0].rotate, top, width }
}
const insetsIn = (stack: string) => JSON.parse(within(screen.getByTestId(`${stack}-frame`)).getByTestId(`${stack}-insets`).props.children)

describe('SeatToasters', () => {
  it('puts each seat at its own end face to face, seat 2 turned across the table', async () => {
    await render(
      <SeatToasters
        spots={{
          1: { rotation: 0, zone: 'bottom' },
          2: { rotation: 180, zone: 'top' }
        }}
      />
    )
    expect(frame('seat-1')).toEqual({ height: H / 2, left: 0, rotate: '0deg', top: H / 2, width: W })
    expect(frame('seat-2')).toEqual({ height: H / 2, left: 0, rotate: '180deg', top: 0, width: W })
    // Each stack sits at its own edge of the screen, clear of what's there, with nothing kept back at the halves' shared edge.
    expect(insetsIn('seat-1')).toEqual({ bottom: 34, left: 0, right: 0, top: 0 })
    expect(insetsIn('seat-2')).toEqual({ bottom: 47, left: 0, right: 0, top: 0 })
  })

  it('gives players side by side a stack each on their own half', async () => {
    await render(
      <SeatToasters
        spots={{
          1: { rotation: 0, zone: 'left' },
          2: { rotation: 0, zone: 'right' }
        }}
      />
    )
    expect(frame('seat-1')).toEqual({ height: H, left: 0, rotate: '0deg', top: 0, width: W / 2 })
    expect(frame('seat-2')).toEqual({ height: H, left: W / 2, rotate: '0deg', top: 0, width: W / 2 })
    expect(insetsIn('seat-1')).toEqual({ bottom: 34, left: 0, right: 0, top: 47 })
    expect(insetsIn('seat-2')).toEqual({ bottom: 34, left: 0, right: 0, top: 47 })
  })

  it("turns a half a quarter in a landscape hold, sized to the half's turned footprint", async () => {
    await render(
      <SeatToasters
        spots={{
          1: { rotation: 90, zone: 'bottom' },
          2: { rotation: 90, zone: 'top' }
        }}
      />
    )
    // The half is W wide and H/2 tall; turned, the frame is H/2 wide and W tall, centered on the half.
    expect(frame('seat-1')).toEqual({ height: W, left: (W - H / 2) / 2, rotate: '90deg', top: H / 2 + (H / 2 - W) / 2, width: H / 2 })
    expect(frame('seat-2')).toEqual({ height: W, left: (W - H / 2) / 2, rotate: '90deg', top: (H / 2 - W) / 2, width: H / 2 })
    // Turned a quarter clockwise, a frame's bottom is the screen's left edge.
    expect(insetsIn('seat-1').bottom).toBe(INSETS.left)
  })

  it('lets touches through the frame', async () => {
    await render(
      <SeatToasters
        spots={{
          1: { rotation: 0, zone: 'bottom' },
          2: { rotation: 180, zone: 'top' }
        }}
      />
    )
    for (const stack of ['seat-1', 'seat-2']) expect(screen.getByTestId(`${stack}-frame`).props.pointerEvents).toBe('box-none')
  })

  it("keeps the main Toaster's controls off and the keyboard lift off", async () => {
    await render(
      <SeatToasters
        spots={{
          1: { rotation: 0, zone: 'bottom' },
          2: { rotation: 180, zone: 'top' }
        }}
      />
    )
    expect(mockToasterProps.map(({ clearButton, historyButton, keyboardAware, limit, stack }) => ({ clearButton, historyButton, keyboardAware, limit, stack }))).toEqual([
      { clearButton: null, historyButton: null, keyboardAware: false, limit: 3, stack: 'seat-1' },
      { clearButton: null, historyButton: null, keyboardAware: false, limit: 3, stack: 'seat-2' }
    ])
  })
})
