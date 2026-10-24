import { TILT_DEAD_ZONE_DEG, TILT_MAX_DEG } from '@/shared/paddleGame/constants/game'
import { calibrateTiltBaseline, computeTiltTargetY } from '@/shared/paddleGame/utils/tiltInput'

const DEG_TO_RAD = Math.PI / 180
const deg = (degrees: number) => degrees * DEG_TO_RAD

const paddleMinY = 0
const paddleMaxY = 200
const boardCenterY = (paddleMinY + paddleMaxY) / 2
const travelRadius = (paddleMaxY - paddleMinY) / 2

describe('calibrateTiltBaseline', () => {
  it('stores beta/gamma/paddleY verbatim', () => {
    expect(calibrateTiltBaseline(0.4, -0.2, 75)).toEqual({ beta: 0.4, gamma: -0.2, paddleY: 75 })
  })
})

describe('computeTiltTargetY', () => {
  it('returns the baseline paddleY unchanged when beta/gamma exactly match the baseline, even off-center', () => {
    const baseline = calibrateTiltBaseline(deg(10), deg(-5), 60)
    expect(computeTiltTargetY(deg(10), deg(-5), baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(60, 5)
  })

  it('stays exactly at the baseline within the dead zone', () => {
    const baseline = calibrateTiltBaseline(0, 0, boardCenterY)
    expect(computeTiltTargetY(deg(TILT_DEAD_ZONE_DEG), 0, baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(boardCenterY, 5)
    expect(computeTiltTargetY(deg(TILT_DEAD_ZONE_DEG - 0.5), 0, baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(boardCenterY, 5)
  })

  it('moves proportionally just beyond the dead zone, not in a single jump', () => {
    const baseline = calibrateTiltBaseline(0, 0, boardCenterY)
    const y = computeTiltTargetY(deg(TILT_DEAD_ZONE_DEG + 1), 0, baseline, 0, paddleMinY, paddleMaxY)
    expect(y).toBeGreaterThan(boardCenterY)
    expect(y).toBeLessThan(paddleMaxY)
  })

  it('pins at paddleMaxY/paddleMinY at TILT_MAX_DEG (baseline centered) and never overshoots beyond it', () => {
    const baseline = calibrateTiltBaseline(0, 0, boardCenterY)
    expect(computeTiltTargetY(deg(TILT_MAX_DEG), 0, baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(paddleMaxY, 5)
    expect(computeTiltTargetY(deg(TILT_MAX_DEG + 15), 0, baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(paddleMaxY, 5)
    expect(computeTiltTargetY(deg(-TILT_MAX_DEG), 0, baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(paddleMinY, 5)
    expect(computeTiltTargetY(deg(-(TILT_MAX_DEG + 15)), 0, baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(paddleMinY, 5)
  })

  it('clamps to the board edge even when the baseline itself starts near it', () => {
    // baseline.paddleY (180) + a full travelRadius (100) would overshoot to 280 without the clamp.
    const baseline = calibrateTiltBaseline(0, 0, 180)
    expect(computeTiltTargetY(deg(TILT_MAX_DEG), 0, baseline, 0, paddleMinY, paddleMaxY)).toBe(paddleMaxY)
  })

  it('rotation 0 drives Y from beta only - gamma alone produces no movement', () => {
    const baseline = calibrateTiltBaseline(0, 0, boardCenterY)
    expect(computeTiltTargetY(0, deg(TILT_MAX_DEG), baseline, 0, paddleMinY, paddleMaxY)).toBeCloseTo(boardCenterY, 5)
  })

  it('rotation ±90 drives Y from gamma only - beta alone produces no movement', () => {
    const baseline = calibrateTiltBaseline(0, 0, boardCenterY)
    expect(computeTiltTargetY(deg(TILT_MAX_DEG), 0, baseline, 90, paddleMinY, paddleMaxY)).toBeCloseTo(boardCenterY, 5)
    expect(computeTiltTargetY(deg(TILT_MAX_DEG), 0, baseline, -90, paddleMinY, paddleMaxY)).toBeCloseTo(boardCenterY, 5)
  })

  it('rotation 90 and -90 invert sign for the same gamma delta', () => {
    const baseline = calibrateTiltBaseline(0, 0, boardCenterY)
    const at90 = computeTiltTargetY(0, deg(10), baseline, 90, paddleMinY, paddleMaxY)
    const atMinus90 = computeTiltTargetY(0, deg(10), baseline, -90, paddleMinY, paddleMaxY)
    expect(at90 - boardCenterY).toBeCloseTo(-(atMinus90 - boardCenterY), 5)
    expect(Math.abs(at90 - boardCenterY)).toBeGreaterThan(0)
  })

  it('scales linearly with the travel range', () => {
    const baseline = calibrateTiltBaseline(0, 0, boardCenterY)
    const halfway = computeTiltTargetY(deg(TILT_DEAD_ZONE_DEG + (TILT_MAX_DEG - TILT_DEAD_ZONE_DEG) / 2), 0, baseline, 0, paddleMinY, paddleMaxY)
    expect(halfway - boardCenterY).toBeCloseTo(travelRadius / 2, 5)
  })
})
