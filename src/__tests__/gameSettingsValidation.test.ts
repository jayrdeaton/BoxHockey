import { DEFAULT_SETTINGS, isValidSettings } from '@/utils/gameSettingsValidation'

describe('isValidSettings', () => {
  it('accepts the defaults', () => {
    expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
  })

  describe('lockedRotation', () => {
    it('is absent from the defaults', () => {
      expect('lockedRotation' in DEFAULT_SETTINGS).toBe(false)
    })

    // Settings saved while unlocked, or before this field existed, have no lockedRotation. Rejecting
    // them would make the settings provider discard every other saved setting too.
    it('accepts settings without it, locked or not', () => {
      expect(isValidSettings({ ...DEFAULT_SETTINGS, lockOrientation: true })).toBe(true)
      expect(isValidSettings({ ...DEFAULT_SETTINGS, lockedRotation: undefined })).toBe(true)
    })

    it.each([0, 90, 180, -90])('accepts %p', (lockedRotation) => {
      expect(isValidSettings({ ...DEFAULT_SETTINGS, lockOrientation: true, lockedRotation })).toBe(true)
    })

    it.each([45, -180, 270, '90', null])('rejects %p', (lockedRotation) => {
      expect(isValidSettings({ ...DEFAULT_SETTINGS, lockOrientation: true, lockedRotation })).toBe(false)
    })
  })
})
