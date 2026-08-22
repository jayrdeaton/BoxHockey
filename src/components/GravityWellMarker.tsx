import { Circle, Group } from '@shopify/react-native-skia'
import { SharedValue, useDerivedValue } from 'react-native-reanimated'

import { gravityParticleAngleRad, gravityParticleDotRadius, gravityParticleOpacity, gravityParticlePhase, gravityParticleRadius } from '@/utils/gravityWellVisuals'

// Adapted from Swirlio's GravityWell.tsx — same filled-hole-plus-orbiting-particles
// visual, but wells here are static per board layout (not a dragged point), so only
// the shared particle clock needs to be a SharedValue; position/size/polarity/color
// are plain props that only change on a real layout event (board resize/variant
// change), which already re-renders this component.
const GRAVITY_WELL_PARTICLE_COUNT = 14
const GRAVITY_WELL_PARTICLE_INDICES = Array.from({ length: GRAVITY_WELL_PARTICLE_COUNT }, (_, index) => index)
const GRAVITY_WELL_PARTICLE_MIN_DOT_RADIUS_PX = 0.75
const GRAVITY_WELL_PARTICLE_MAX_DOT_RADIUS_PX = 3
const GRAVITY_WELL_OUTLINE_WIDTH_PX = 1.5

type GravityWellParticleProps = {
  index: number
  x: number
  y: number
  attracting: boolean
  progress: SharedValue<number>
  holeRadius: number
  foreground: string
}

function GravityWellParticle({ index, x, y, attracting, progress, holeRadius, foreground }: GravityWellParticleProps) {
  const angleRad = gravityParticleAngleRad(index)
  const phase = useDerivedValue(() => gravityParticlePhase(progress.value, index, GRAVITY_WELL_PARTICLE_COUNT))
  const orbitRadius = useDerivedValue(() => gravityParticleRadius(phase.value, 0, holeRadius, attracting))
  const cx = useDerivedValue(() => x + Math.cos(angleRad) * orbitRadius.value)
  const cy = useDerivedValue(() => y + Math.sin(angleRad) * orbitRadius.value)
  const opacity = useDerivedValue(() => gravityParticleOpacity(phase.value))
  const dotRadius = useDerivedValue(() => gravityParticleDotRadius(orbitRadius.value, holeRadius, GRAVITY_WELL_PARTICLE_MIN_DOT_RADIUS_PX, GRAVITY_WELL_PARTICLE_MAX_DOT_RADIUS_PX))
  return <Circle cx={cx} cy={cy} r={dotRadius} color={foreground} opacity={opacity} />
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
  background: string
}

export function GravityWellMarker({ x, y, holeRadius, attracting, progress, foreground, background }: GravityWellMarkerProps) {
  return (
    <Group>
      <Circle cx={x} cy={y} r={holeRadius} color={background} />
      {GRAVITY_WELL_PARTICLE_INDICES.map((index) => (
        <GravityWellParticle key={index} index={index} x={x} y={y} attracting={attracting} progress={progress} holeRadius={holeRadius} foreground={foreground} />
      ))}
      <Circle cx={x} cy={y} r={holeRadius} style='stroke' strokeWidth={GRAVITY_WELL_OUTLINE_WIDTH_PX} color={foreground} />
    </Group>
  )
}
