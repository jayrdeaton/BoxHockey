import { computeScorePipLayout } from '@/utils/scorePips'

describe('computeScorePipLayout', () => {
  it('returns exactly `count` pips', () => {
    expect(computeScorePipLayout(200, 5).centerXs).toHaveLength(5)
    expect(computeScorePipLayout(200, 3).centerXs).toHaveLength(3)
    expect(computeScorePipLayout(200, 10).centerXs).toHaveLength(10)
  })

  it('centers the row on 0 — symmetric offsets summing to ~0', () => {
    const { centerXs } = computeScorePipLayout(200, 5)
    const sum = centerXs.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(0)
  })

  it('lays pips out in increasing order, evenly spaced', () => {
    const { centerXs } = computeScorePipLayout(200, 4)
    for (let i = 1; i < centerXs.length; i++) {
      expect(centerXs[i]).toBeGreaterThan(centerXs[i - 1])
    }
    const gap0 = centerXs[1] - centerXs[0]
    const gap1 = centerXs[2] - centerXs[1]
    expect(gap0).toBeCloseTo(gap1)
  })

  it('clamps radius to a sane minimum for a high pip count on a narrow row', () => {
    const { radius } = computeScorePipLayout(40, 10)
    expect(radius).toBeGreaterThanOrEqual(2.5)
  })

  it('clamps radius to a sane maximum for a low pip count on a wide row', () => {
    const { radius } = computeScorePipLayout(1000, 1)
    expect(radius).toBeLessThanOrEqual(7)
  })

  it('a single pip sits centered at 0', () => {
    expect(computeScorePipLayout(200, 1).centerXs).toEqual([0])
  })
})
