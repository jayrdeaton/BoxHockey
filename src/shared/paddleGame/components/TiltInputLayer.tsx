import { DeviceMotion } from 'expo-sensors'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import { ORIENTATION_SENSOR_DEFAULT_INTERVAL_MS, TILT_UPDATE_INTERVAL_MS } from '@/shared/paddleGame/constants/game'
import { BoardLayout, GamePhase, Player } from '@/shared/paddleGame/types'
import { calibrateTiltBaseline, computeTiltTargetY, TiltBaseline } from '@/shared/paddleGame/utils/tiltInput'

export interface TiltInputLayerProps {
  player: Player
  // tiltControlActiveFor(...) && !paused && phase !== 'gameOver' - same `enabled` convention as
  // Touch/KeyboardInputLayer's own prop of the same name.
  enabled: boolean
  // For detecting a FRESH entry into 'live' (every serve, not just the first) as a recalibration
  // trigger - see the phase effect below.
  phase: GamePhase
  // Frozen for the whole round whenever tilt is active - see game.tsx's own
  // useOrientationState(locked) call, which forces this never to change mid-round once
  // tilt control is on, so this component never has to react to it changing.
  rotation: 0 | 90 | -90
  board: BoardLayout
  // This player's CURRENT paddle Y, mirrored every render (not read once) - same pattern
  // KeyboardInputLayer's own `paddleY` prop uses, since (re)calibration needs the FRESH value at
  // the exact moment it fires, not a stale render-time snapshot.
  paddleY: number
  onPaddleTargetY: (player: Player, y: number) => void
}

// Additive on top of TouchInputLayer's own always-on drag input - never disables it, same
// "adds a method, never removes one" precedent KeyboardInputLayer already established (see that
// component's own doc comment). Native-only: expo-sensors never populates DeviceMotionMeasurement's
// own `rotation` field on web (confirmed against ExponentDeviceMotion.web.js - an explicit
// "TODO: Bacon: Can rotation be calculated?" left where it emits everything except that field), so
// there is no tilt signal to read there at all - mirrors KeyboardInputLayer's own Platform gate,
// just inverted (that component is web-only; this one is native-only).
//
// Two independent effects, mirroring KeyboardInputLayer's own split: one owns the sensor
// subscription's lifecycle, the other only watches `phase` to flag a recalibration.
export default function TiltInputLayer({ player, enabled, phase, rotation, board, paddleY, onPaddleTargetY }: TiltInputLayerProps) {
  const latestRef = useRef({ player, rotation, board, paddleY, onPaddleTargetY })
  useEffect(() => {
    latestRef.current = { player, rotation, board, paddleY, onPaddleTargetY }
  })

  const baselineRef = useRef<TiltBaseline | null>(null)
  // Starts true so the very first sample after enabling calibrates rather than steers from a
  // baseline of {0, 0} - see the listener below, which never moves the paddle on a calibrating
  // sample.
  const needsCalibrationRef = useRef(true)

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return

    needsCalibrationRef.current = true
    DeviceMotion.setUpdateInterval(TILT_UPDATE_INTERVAL_MS)

    const subscription = DeviceMotion.addListener((measurement) => {
      const { rotation: sensorRotation } = measurement
      if (!sensorRotation) return
      const { player, rotation, board, paddleY, onPaddleTargetY } = latestRef.current

      if (needsCalibrationRef.current) {
        baselineRef.current = calibrateTiltBaseline(sensorRotation.beta, sensorRotation.gamma, paddleY)
        needsCalibrationRef.current = false
        return
      }

      const baseline = baselineRef.current
      if (!baseline) return
      const y = computeTiltTargetY(sensorRotation.beta, sensorRotation.gamma, baseline, rotation, board.paddleMinY, board.paddleMaxY)
      onPaddleTargetY(player, y)
    })

    // Restores the shared DeviceMotion singleton's default sampling rate on every disable (pause,
    // game over, or unmount) - not just final teardown - since expo-sensors' setUpdateInterval is a
    // GLOBAL setting on that one singleton, not scoped to this listener (see TILT_UPDATE_INTERVAL_MS's
    // own doc in constants/game.ts). Left elevated, it would keep @tastic/core's own
    // useOrientationState sampling faster than it needs for the rest of the app session.
    return () => {
      subscription.remove()
      DeviceMotion.setUpdateInterval(ORIENTATION_SENSOR_DEFAULT_INTERVAL_MS)
    }
  }, [enabled])

  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    // Every fresh transition into 'live' - the initial serve (idle->live) AND every point's re-serve
    // (pointScored->live) - flags a recalibration, giving the player a natural moment to resettle
    // their grip between points, mirroring the game's own SERVE_PAUSE_MS pause rhythm.
    if (phase === 'live' && prevPhaseRef.current !== 'live') needsCalibrationRef.current = true
    prevPhaseRef.current = phase
  }, [phase])

  return null
}
