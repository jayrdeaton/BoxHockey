import reducer, { DEFAULT_SETTINGS, settingsActions } from '@/games/boxhockey/redux/settingsSlice'
import appSettingsReducer, { appSettingsActions, DEFAULT_APP_SETTINGS } from '@/shell/redux/appSettingsSlice'

const REHYDRATE = 'persist/REHYDRATE'

describe("Box Hockey's settingsSlice", () => {
  it('starts from the defaults', () => {
    expect(reducer(undefined, { type: '@@INIT' })).toEqual(DEFAULT_SETTINGS)
  })

  it('merges a partial patch over the current settings', () => {
    const next = reducer(DEFAULT_SETTINGS, settingsActions.initialize({ boardVariant: 'gravity', scoreToWin: 7 }))
    expect(next).toEqual({ ...DEFAULT_SETTINGS, boardVariant: 'gravity', scoreToWin: 7 })
  })

  // Settings saved by an older build have no value for a field added since; rehydrating must fill it
  // from the defaults rather than leave it undefined.
  it('fills fields missing from saved settings with the defaults on rehydrate', () => {
    const key = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).find((k) => k !== 'boardVariant')!
    const saved: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS, boardVariant: 'gauntlet' }
    delete saved[key]
    const next = reducer(undefined, { type: REHYDRATE, payload: { settings: saved } } as { type: string })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, boardVariant: 'gauntlet' })
  })

  it('keeps the defaults when nothing was saved', () => {
    expect(reducer(undefined, { type: REHYDRATE, payload: {} } as { type: string })).toEqual(DEFAULT_SETTINGS)
  })
})

describe("the shell's appSettingsSlice", () => {
  it('starts from the defaults', () => {
    expect(appSettingsReducer(undefined, { type: '@@INIT' })).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('records the locked angle on lock', () => {
    const next = appSettingsReducer(DEFAULT_APP_SETTINGS, appSettingsActions.initialize({ lockOrientation: true, lockedRotation: -90 }))
    expect(next).toEqual({ ...DEFAULT_APP_SETTINGS, lockOrientation: true, lockedRotation: -90 })
  })

  it('clears lockedRotation when unlocking', () => {
    const locked = appSettingsReducer(DEFAULT_APP_SETTINGS, appSettingsActions.initialize({ lockOrientation: true, lockedRotation: 180 }))
    expect(appSettingsReducer(locked, appSettingsActions.initialize({ lockOrientation: false, lockedRotation: undefined })).lockedRotation).toBeUndefined()
  })

  it('fills fields missing from saved app settings with the defaults on rehydrate', () => {
    const next = appSettingsReducer(undefined, { type: REHYDRATE, payload: { appSettings: { lockOrientation: true } } } as { type: string })
    expect(next).toEqual({ ...DEFAULT_APP_SETTINGS, lockOrientation: true })
  })
})
