import { createPaddleSettings, DEFAULT_SETTINGS } from '@/shared/paddleGame/settings'
import type { ShellState } from '@/shell/redux/shellState'

// Each paddle game keeps its own players' settings under its own keys; Breaker's stands in for both.
// The per-player behavior itself is shared/playerSettings.ts's, tested in playerSettings.test.tsx.
const breaker = createPaddleSettings('breaker')

const state = (extra: Record<string, unknown>) => ({ profileSelection: { 1: 'sam', 2: null }, opponent: { seatTwo: 'cpu' }, ...extra }) as unknown as ShellState

describe("a paddle game's per-player settings", () => {
  it("are saved under the game's own keys", () => {
    expect(Object.keys(breaker.reducers)).toEqual(['breakerSettings', 'breakerControls'])
  })

  it('fill what a player never changed from the defaults', () => {
    expect(breaker.select(state({ breakerSettings: { sam: { ballSpeed: 'slow' } } }))).toEqual({ ...DEFAULT_SETTINGS, ballSpeed: 'slow' })
  })

  it("read only the game's own keys, not another paddle game's", () => {
    expect(breaker.select(state({ paddlesSettings: { sam: { ballSpeed: 'fast' } }, paddlesControls: { sam: 'arrows' } }))).toEqual(DEFAULT_SETTINGS)
  })

  it('move seat 2 to the next free control when both players saved the same one', () => {
    expect(breaker.compose({}, { sam: 'wasd', riley: 'wasd' }, { 1: 'sam', 2: 'riley' }, true).controlScheme).toEqual({ 1: 'wasd', 2: 'mouse' })
  })
})
