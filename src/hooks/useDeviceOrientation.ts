import { useWindowDimensions } from 'react-native'

import { OrientationMode } from '@/types'

// Derives which layout style currently fits the physical device shape — wider-than-tall reads as
// 'landscape', taller-than-wide as 'portrait' — rather than reading a stored preference, so
// /loadout's panel arrangement simply follows however the phone is actually being held right now.
// Pair with useOrientationLock's `enabled` flag for players who'd rather pin one orientation than
// have the layout follow every tilt.
export function useDeviceOrientation(): OrientationMode {
  const { width, height } = useWindowDimensions()
  return width > height ? 'landscape' : 'portrait'
}
