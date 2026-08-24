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
// The field's own fill — per explicit user feedback after playtesting, wells only affect the puck
// within this exact radius, so a much bigger field (see buildGravityWells in utils/board.ts) needs
// to actually READ as a zone rather than a thin outline around mostly-invisible fill: the
// background circle below used to be drawn in `background` (== the board's own true black/white,
// i.e. functionally invisible against it). Filling it with the well's own accent color instead —
// at a low, deliberately subtle opacity, not a solid disc — makes a big field legible without it
// visually dominating the board.
const GRAVITY_WELL_FIELD_FILL_OPACITY = 0.16

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
  // well's true hazard boundary. See GRAVITY_WELL_FIELD_FILL_OPACITY's own comment
  // for why the field's own reach (not just its edge) needs to be visible now.
  holeRadius: number
  attracting: boolean
  progress: SharedValue<number>
  foreground: string
}

// No stroked outline (removed per explicit feedback) — the boundary reads from the low-opacity
// fill plus the particles themselves fading in/out as they approach it (see
// gravityParticleOpacity in utils/gravityWellVisuals.ts), not a hard drawn edge.
export function GravityWellMarker({ x, y, holeRadius, attracting, progress, foreground }: GravityWellMarkerProps) {
  return (
    <Group>
      <Circle cx={x} cy={y} r={holeRadius} color={foreground} opacity={GRAVITY_WELL_FIELD_FILL_OPACITY} />
      {GRAVITY_WELL_PARTICLE_INDICES.map((index) => (
        <GravityWellParticle key={index} index={index} x={x} y={y} attracting={attracting} progress={progress} holeRadius={holeRadius} foreground={foreground} />
      ))}
    </Group>
  )
}
