import { createPaddleSettings, DEFAULT_SETTINGS } from '@/shared/paddleGame/settings'

const REHYDRATE = 'persist/REHYDRATE'

// Each paddle game mounts its own settings under its own key; Breaker's stands in for both.
const { actions, reducer } = createPaddleSettings('breakerSettings')

describe("a paddle game's settings", () => {
  it('starts from the defaults', () => {
    expect(reducer(undefined, { type: '@@INIT' })).toEqual(DEFAULT_SETTINGS)
  })

  it('merges a partial patch over the current settings', () => {
    const next = reducer(DEFAULT_SETTINGS, actions.initialize({ ballSpeed: 'fast', scoreToWin: 7 }))
    expect(next).toEqual({ ...DEFAULT_SETTINGS, ballSpeed: 'fast', scoreToWin: 7 })
  })

  // Settings saved by an older build have no value for a field added since; rehydrating must fill it
  // from the defaults rather than leave it undefined.
  it('fills fields missing from saved settings with the defaults on rehydrate', () => {
    const key = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).find((k) => k !== 'ballSpeed')!
    const saved: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS, ballSpeed: 'slow' }
    delete saved[key]
    const next = reducer(undefined, { type: REHYDRATE, payload: { breakerSettings: saved } } as { type: string })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, ballSpeed: 'slow' })
  })

  it("reads only its own key, not another paddle game's", () => {
    const next = reducer(undefined, { type: REHYDRATE, payload: { paddlesSettings: { ...DEFAULT_SETTINGS, ballSpeed: 'fast' } } } as { type: string })
    expect(next).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps the defaults when nothing was saved', () => {
    expect(reducer(undefined, { type: REHYDRATE, payload: {} } as { type: string })).toEqual(DEFAULT_SETTINGS)
  })
})
