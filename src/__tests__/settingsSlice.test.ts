import { DEFAULT_SETTINGS, playerSettings } from '@/games/boxhockey/redux/settingsSlice'
import appSettingsReducer, { appSettingsActions, DEFAULT_APP_SETTINGS } from '@/shell/redux/appSettingsSlice'

const REHYDRATE = 'persist/REHYDRATE'

// The per-player behavior itself is shared/playerSettings.ts's, tested in playerSettings.test.tsx.
describe("Box Hockey's per-player settings", () => {
  it('are saved under boxhockeySettings and boxhockeyControls', () => {
    expect(Object.keys(playerSettings.reducers)).toEqual(['boxhockeySettings', 'boxhockeyControls'])
  })

  // A player's saved setup only holds what they changed, so a field added since starts at its default.
  it('fill what a player never changed from the defaults', () => {
    expect(playerSettings.compose({ sam: { boardVariant: 'gauntlet' } }, {}, { 1: 'sam', 2: null }, false)).toEqual({ ...DEFAULT_SETTINGS, boardVariant: 'gauntlet' })
  })

  it('let both seats play the same shot style', () => {
    expect(playerSettings.compose({}, { sam: 'stick', riley: 'stick' }, { 1: 'sam', 2: 'riley' }, true).controlScheme).toEqual({ 1: 'stick', 2: 'stick' })
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
