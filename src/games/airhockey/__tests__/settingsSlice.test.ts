import reducer, { DEFAULT_SETTINGS, settingsActions } from '@/games/airhockey/redux/settingsSlice'

const REHYDRATE = 'persist/REHYDRATE'

describe("Air Hockey's settingsSlice", () => {
  it('starts from the defaults', () => {
    expect(reducer(undefined, { type: '@@INIT' })).toEqual(DEFAULT_SETTINGS)
  })

  it('merges a partial patch over the current settings', () => {
    const next = reducer(DEFAULT_SETTINGS, settingsActions.initialize({ paddleSize: 'large', rink: false }))
    expect(next).toEqual({ ...DEFAULT_SETTINGS, paddleSize: 'large', rink: false })
  })

  // Saved under Air Hockey's own key, so Box Hockey's `settings` (BoxHockey 1.0's) can't land here.
  it('rehydrates from airhockeySettings, filling missing fields from the defaults', () => {
    const next = reducer(undefined, { type: REHYDRATE, payload: { settings: { scoreToWin: 10 }, airhockeySettings: { scoreToWin: 7 } } } as { type: string })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, scoreToWin: 7 })
  })
})
