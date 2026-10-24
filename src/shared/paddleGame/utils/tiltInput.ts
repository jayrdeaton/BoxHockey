import { TILT_DEAD_ZONE_DEG, TILT_MAX_DEG } from '@/shared/paddleGame/constants/game'

// expo-sensors' DeviceMotionMeasurement.rotation carries no unit annotation in its own type (unlike
// rotationRate, which is explicitly documented as degrees/s) - confirmed directly against the
// native source that beta/gamma are RADIANS on both platforms: iOS's DeviceMotionModule.swift
// passes CMAttitude.pitch/.roll straight through with no conversion (its own rotationRate sibling
// explicitly calls radiansToDegrees, rotation does not), and Android's DeviceMotionModule.kt feeds
// SensorManager.getOrientation()'s raw radian output through unconverted the same way. Converted to
// degrees here (not at the sensor-read call site) so TILT_DEAD_ZONE_DEG/TILT_MAX_DEG and this
// module's own tests can stay in the more intuitive unit.
const RAD_TO_DEG = 180 / Math.PI

// Captured once per calibration point (every fresh 'live' entry, i.e. every serve, plus resuming
// from a paused settings dialog - see TiltInputLayer's own doc for why). beta/gamma are stored RAW
// (radians, as read from the sensor) - only ever used as a subtraction baseline, so there's no
// reason to convert them until a delta is actually computed. paddleY is the paddle's CURRENT
// position at the moment of calibration, not board center - a calibrate-then-steer-by-delta scheme
// has to start exactly where the paddle already is, or calibrating would visibly snap it to center
// on every single serve.
export interface TiltBaseline {
  beta: number
  gamma: number
  paddleY: number
}

export function calibrateTiltBaseline(beta: number, gamma: number, paddleY: number): TiltBaseline {
  return { beta, gamma, paddleY }
}

// AXIS MAPPING - reasoned by direct structural symmetry with TouchInputLayer's own screenToLocalY,
// NOT independently derived or device-verified. For rotation === 0 (sideBySide), local Y already
// maps onto real screen Y for touch (screenToLocalY's own `dy` branch) - the tilt equivalent of
// "forward/back" motion is `beta` (pitch), so beta drives Y directly. For rotation === ±90
// (faceToFace), local Y maps onto real screen X for touch (screenToLocalY's own `dx` branch,
// negated for 90 and not for -90) - the tilt equivalent of "sideways" motion is `gamma` (roll, the
// "steering wheel" tilt), with the identical negation pattern. Isolated into this one small
// function specifically so a wrong guess (this DOES need spot-checking on a real device or
// simulator - see game.tsx's own board-rotation-polarity comment for the exact same class of
// caveat) is a one-line fix, not scattered logic.
function tiltDeltaForRotation(deltaBetaDeg: number, deltaGammaDeg: number, rotation: 0 | 90 | -90): number {
  if (rotation === 90) return -deltaGammaDeg
  if (rotation === -90) return deltaGammaDeg
  return deltaBetaDeg
}

// beta/gamma: the CURRENT DeviceMotionMeasurement.rotation reading (radians - see RAD_TO_DEG's own
// doc above). paddleMinY/paddleMaxY: this player's travel range (BoardLayout's own fields).
// Internally clamped to that range - defense in depth mirroring utils/board.ts's own clampPaddleY,
// even though setPaddleTarget clamps again downstream.
export function computeTiltTargetY(beta: number, gamma: number, baseline: TiltBaseline, rotation: 0 | 90 | -90, paddleMinY: number, paddleMaxY: number): number {
  const deltaBetaDeg = (beta - baseline.beta) * RAD_TO_DEG
  const deltaGammaDeg = (gamma - baseline.gamma) * RAD_TO_DEG
  const raw = tiltDeltaForRotation(deltaBetaDeg, deltaGammaDeg, rotation)

  const magnitude = Math.abs(raw)
  const deadZoned = magnitude <= TILT_DEAD_ZONE_DEG ? 0 : Math.sign(raw) * (magnitude - TILT_DEAD_ZONE_DEG)

  const usableDeg = TILT_MAX_DEG - TILT_DEAD_ZONE_DEG
  const fraction = Math.max(-1, Math.min(1, deadZoned / usableDeg))

  const travelRadius = (paddleMaxY - paddleMinY) / 2
  const y = baseline.paddleY + fraction * travelRadius

  return Math.min(paddleMaxY, Math.max(paddleMinY, y))
}
