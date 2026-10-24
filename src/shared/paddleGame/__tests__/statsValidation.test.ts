import { DEFAULT_PROFILE_STATS, DEFAULT_STATS, isValidStats } from '@/shared/paddleGame/utils/statsValidation'

describe('DEFAULT_STATS', () => {
  it('is a zeroed blob that validates', () => {
    expect(isValidStats(DEFAULT_STATS)).toBe(true)
    expect(DEFAULT_STATS.profiles).toEqual({})
    expect(DEFAULT_STATS.firstGameResult).toBeNull()
  })

  it('zeroes every difficulty bucket', () => {
    expect(Object.values(DEFAULT_STATS.vsCpu.byDifficulty).every((r) => r.played === 0)).toBe(true)
  })

  it('zeroes every ball-speed bucket', () => {
    expect(Object.values(DEFAULT_STATS.bySpeed).every((r) => r.played === 0)).toBe(true)
  })

  it('DEFAULT_PROFILE_STATS carries no nesting of its own', () => {
    expect('profiles' in DEFAULT_PROFILE_STATS).toBe(false)
  })

  it('zeroes the solo bucket and the mode-agnostic bricksDestroyed counter', () => {
    expect(DEFAULT_STATS.solo).toEqual({ played: 0, cleared: 0 })
    expect(DEFAULT_STATS.bricksDestroyed).toBe(0)
  })
})

describe('isValidStats', () => {
  it('accepts a blob with no profiles key - the additive-field case migrateStats backfills', () => {
    const { profiles: _dropped, ...withoutProfiles } = DEFAULT_STATS
    expect(isValidStats(withoutProfiles)).toBe(true)
  })

  it('accepts populated profile buckets', () => {
    expect(isValidStats({ ...DEFAULT_STATS, profiles: { alice: DEFAULT_PROFILE_STATS } })).toBe(true)
  })

  it('rejects non-objects and arrays', () => {
    expect(isValidStats(null)).toBe(false)
    expect(isValidStats(undefined)).toBe(false)
    expect(isValidStats('{}')).toBe(false)
    expect(isValidStats([])).toBe(false)
  })

  it('rejects a missing or malformed vsCpu bucket', () => {
    expect(isValidStats({ ...DEFAULT_STATS, vsCpu: undefined })).toBe(false)
    expect(isValidStats({ ...DEFAULT_STATS, vsCpu: { ...DEFAULT_STATS.vsCpu, byDifficulty: {} } })).toBe(false)
  })

  it('rejects a missing or malformed solo bucket', () => {
    expect(isValidStats({ ...DEFAULT_STATS, solo: undefined })).toBe(false)
    expect(isValidStats({ ...DEFAULT_STATS, solo: { played: 1 } })).toBe(false)
  })

  it('rejects a non-numeric bricksDestroyed', () => {
    expect(isValidStats({ ...DEFAULT_STATS, bricksDestroyed: '5' })).toBe(false)
  })

  it('rejects a malformed points object', () => {
    expect(isValidStats({ ...DEFAULT_STATS, points: { scored: 1 } })).toBe(false)
  })

  it('rejects a bySpeed map missing a tier', () => {
    expect(isValidStats({ ...DEFAULT_STATS, bySpeed: { slow: DEFAULT_STATS.bySpeed.slow } })).toBe(false)
  })

  it('rejects a non-numeric shutouts or bestWinMargin', () => {
    expect(isValidStats({ ...DEFAULT_STATS, shutouts: '3' })).toBe(false)
    expect(isValidStats({ ...DEFAULT_STATS, bestWinMargin: null })).toBe(false)
  })

  it('rejects an unrecognized firstGameResult', () => {
    expect(isValidStats({ ...DEFAULT_STATS, firstGameResult: 'forfeit' })).toBe(false)
    expect(isValidStats({ ...DEFAULT_STATS, firstGameResult: 'win' })).toBe(true)
  })

  it('rejects a profiles map whose bucket is malformed', () => {
    expect(isValidStats({ ...DEFAULT_STATS, profiles: { alice: { vsCpu: 1 } } })).toBe(false)
  })
})
