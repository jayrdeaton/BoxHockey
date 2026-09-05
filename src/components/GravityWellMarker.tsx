import { GravityWell } from '@tastic/sprites/gravity'
import { useEffect } from 'react'
import { SharedValue, useSharedValue } from 'react-native-reanimated'

// The field's own fill — per explicit user feedback after playtesting, wells only affect the puck
// within this exact radius, so a much bigger field (see buildGravityWells in utils/board.ts) needs
// to actually READ as a zone rather than a thin outline around mostly-invisible fill: filling it
// with the well's own accent color at a low, deliberately subtle opacity (not a solid disc) makes
// a big field legible without it visually dominating the board.
const GRAVITY_WELL_FIELD_FILL_OPACITY = 0.16

// Bridges a plain, render-scoped value into a SharedValue that stays in sync — @tastic/sprites'
// GravityWell needs SharedValues throughout (it also serves Swirlio's continuously-dragged wells),
// but this app's own wells are static per board layout: plain props that only change on a real
// resize/variant-change re-render. useSharedValue's own initial-value argument is only read once,
// at mount, so a later prop change needs this explicit sync or the shared value would go stale.
function useSyncedSharedValue<T>(value: T): SharedValue<T> {
  const shared = useSharedValue(value)
  useEffect(() => {
    shared.value = value
  }, [shared, value])
  return shared
}

type GravityWellMarkerProps = {
  x: number
  y: number
  // Drawn at exactly the well's influence radius — unlike Swirlio, strength and
  // reach are decoupled here (force falls to 0 at this radius regardless of
  // strength), so sizing the hole any other way would understate a weak-but-wide
  // well's true hazard boundary.
  holeRadius: number
  attracting: boolean
  progress: SharedValue<number>
  foreground: string
}

// No stroked outline (removed per explicit feedback) — the boundary reads from the low-opacity
// fill plus the particles themselves fading in/out as they approach it, not a hard drawn edge.
export function GravityWellMarker({ x, y, holeRadius, attracting, progress, foreground }: GravityWellMarkerProps) {
  const xShared = useSyncedSharedValue(x)
  const yShared = useSyncedSharedValue(y)
  const holeRadiusShared = useSyncedSharedValue(holeRadius)
  const attractingShared = useSyncedSharedValue(attracting)
  const foregroundShared = useSyncedSharedValue(foreground)

  return <GravityWell x={xShared} y={yShared} holeRadius={holeRadiusShared} attracting={attractingShared} progress={progress} foreground={foregroundShared} holeFillColor={foregroundShared} holeFillOpacity={GRAVITY_WELL_FIELD_FILL_OPACITY} />
}
