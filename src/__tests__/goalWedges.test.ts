import { computeGoalWedges } from '@/utils/goalWedges'

describe('computeGoalWedges', () => {
  it('returns exactly `count` wedges', () => {
    expect(computeGoalWedges(5, 0)).toHaveLength(5)
    expect(computeGoalWedges(3, 0)).toHaveLength(3)
    expect(computeGoalWedges(10, 0)).toHaveLength(10)
  })

  it('sweep angles sum to a half-circle', () => {
    for (const count of [3, 5, 7, 10]) {
      const total = computeGoalWedges(count, 0).reduce((sum, w) => sum + w.sweepAngle, 0)
      expect(total).toBeCloseTo(180)
    }
  })

  it('tiles contiguously with no gaps or overlaps', () => {
    const wedges = computeGoalWedges(4, 0)
    for (let i = 1; i < wedges.length; i++) {
      expect(wedges[i].startAngle).toBeCloseTo(wedges[i - 1].startAngle + wedges[i - 1].sweepAngle)
    }
  })

  it('starts the first wedge at baseAngle', () => {
    expect(computeGoalWedges(5, 0)[0].startAngle).toBe(0)
    expect(computeGoalWedges(5, 180)[0].startAngle).toBe(180)
  })
})
