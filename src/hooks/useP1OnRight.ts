import * as ScreenOrientation from 'expo-screen-orientation'
import { useEffect, useState } from 'react'

export interface P1OnRight {
  p1OnRight: boolean
  // False only for the brief window before the initial getOrientationAsync() below resolves —
  // p1OnRight is a guess (see DEFAULT_STATE) until then. Lets a consumer (see loadout.tsx) tell
  // "the guess just got corrected" apart from "the device actually rotated," since only the latter
  // should read as a real, animatable rotation.
  resolved: boolean
}

const DEFAULT_STATE: P1OnRight = { p1OnRight: true, resolved: false }

// Landscape mode splits the player panels left/right, but useWindowDimensions (see
// useDeviceOrientation) can only tell us the device is in *some* landscape — not which physical
// direction it was turned. That direction matters: whichever edge was nearest P1 in portrait (the
// bottom) swings to a different physical side depending on which way the device rotates, so
// keeping P1 attached to "wherever they physically ended up" (rather than a side that's fixed no
// matter which way you turn) needs the real LANDSCAPE_LEFT/RIGHT reading, not just width > height.
//
// Verified empirically against the Simulator's own Device > Rotate Left/Right commands (not
// assumed from Apple's naming, which reads backwards from what it does): rotating a portrait
// device to the left reports LANDSCAPE_RIGHT, and rotating it to the right reports LANDSCAPE_LEFT.
// Physically, rotating left swings the bottom edge (P1's zone) around to the right — so
// LANDSCAPE_RIGHT is the state where P1 belongs on the right, and LANDSCAPE_LEFT is where P1
// belongs on the left.
export function useP1OnRight(): P1OnRight {
  const [state, setState] = useState(DEFAULT_STATE)

  useEffect(() => {
    let mounted = true
    ScreenOrientation.getOrientationAsync()
      .then((orientation) => {
        if (mounted) setState({ p1OnRight: orientation !== ScreenOrientation.Orientation.LANDSCAPE_LEFT, resolved: true })
      })
      .catch(() => {
        if (mounted) setState((s) => ({ ...s, resolved: true }))
      })
    let subscription: ScreenOrientation.Subscription | undefined
    try {
      subscription = ScreenOrientation.addOrientationChangeListener(({ orientationInfo }) => {
        if (orientationInfo.orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT) setState({ p1OnRight: false, resolved: true })
        else if (orientationInfo.orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) setState({ p1OnRight: true, resolved: true })
      })
    } catch {}
    return () => {
      mounted = false
      subscription?.remove()
    }
  }, [])

  return state
}
