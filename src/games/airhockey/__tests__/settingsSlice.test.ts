import { DEFAULT_SETTINGS, playerSettings } from '@/games/airhockey/redux/settingsSlice'

// The per-player behavior itself is shared/playerSettings.ts's, tested in playerSettings.test.tsx.
describe("Air Hockey's per-player settings", () => {
  it('are saved under airhockeySettings and airhockeyControls', () => {
    expect(Object.keys(playerSettings.reducers)).toEqual(['airhockeySettings', 'airhockeyControls'])
  })

  it('fill what a player never changed from the defaults', () => {
    expect(playerSettings.compose({ sam: { paddleSize: 'large' } }, {}, { 1: 'sam', 2: null }, false)).toEqual({ ...DEFAULT_SETTINGS, paddleSize: 'large' })
  })

  // The mouse and each key cluster can only steer one paddle.
  it('move seat 2 to the next free control when both players saved the same one', () => {
    expect(playerSettings.compose({}, { sam: 'mouse', riley: 'mouse' }, { 1: 'sam', 2: 'riley' }, true).controlScheme).toEqual({ 1: 'mouse', 2: 'wasd' })
    expect(playerSettings.compose({}, { sam: 'arrows', riley: 'arrows' }, { 1: 'sam', 2: 'riley' }, true).controlScheme).toEqual({ 1: 'arrows', 2: 'mouse' })
  })
})
