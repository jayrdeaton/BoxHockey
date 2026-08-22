// Pure/worklet math for GravityWellMarker's particle field — ported from Swirlio's
// constants/gravityWellMath.ts, which independently developed the same "hole with
// particles falling in or emanating out by polarity" visual. Kept as its own file
// (not physics.ts) since this is rendering/animation math, not simulation math —
// same split Swirlio itself uses between gravityWellMath.ts and its physics hook.

// π(3 - √5) radians — the golden angle (~137.5077640500378°). Placing particle
// `index` at `index * GOLDEN_ANGLE_RAD` spreads any number of them evenly around
// the well with no two ever landing on the same ray.
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5))

export function gravityParticleAngleRad(index: number): number {
  'worklet'
  const raw = index * GOLDEN_ANGLE_RAD
  return raw - Math.floor(raw / (2 * Math.PI)) * (2 * Math.PI)
}

// Where particle `index` (of `count` total) currently sits along its own fall/
// emanate cycle, as a 0..1 loop — every particle reads the same shared
// `clockProgress` clock, offset by its own `index / count` share of a lap.
export function gravityParticlePhase(clockProgress: number, index: number, count: number): number {
  'worklet'
  const raw = clockProgress + index / count
  return raw - Math.floor(raw)
}

// Maps a particle's phase onto an actual pixel distance from the well's center,
// between its own center (innerRadius, normally 0) and the hole's own edge
// (outerRadius). `pulling` (true = attractor) counts phase 0 down from
// outerRadius to innerRadius — falling in toward the pull. `false` (repeller)
// counts up from innerRadius to outerRadius — emanating out toward the push.
export function gravityParticleRadius(phase: number, innerRadius: number, outerRadius: number, pulling: boolean): number {
  'worklet'
  const span = outerRadius - innerRadius
  return pulling ? outerRadius - phase * span : innerRadius + phase * span
}

// Maps a particle's own live distance from center onto a dot size — smaller
// near the center, larger toward the hole's edge, selling depth. holeRadius <= 0
// falls back to minDotRadius rather than dividing by zero.
export function gravityParticleDotRadius(orbitRadius: number, holeRadius: number, minDotRadius: number, maxDotRadius: number): number {
  'worklet'
  if (holeRadius <= 0) return minDotRadius
  const t = Math.min(Math.max(orbitRadius / holeRadius, 0), 1)
  return minDotRadius + t * (maxDotRadius - minDotRadius)
}

// How much of a lap, at each end, a particle spends fading rather than snapping
// in/out of existence.
export const GRAVITY_PARTICLE_FADE_FRACTION = 0.15

// Fades a particle in over the first GRAVITY_PARTICLE_FADE_FRACTION of its phase
// and back out over the last, full opacity in between.
export function gravityParticleOpacity(phase: number): number {
  'worklet'
  if (phase < GRAVITY_PARTICLE_FADE_FRACTION) return phase / GRAVITY_PARTICLE_FADE_FRACTION
  if (phase > 1 - GRAVITY_PARTICLE_FADE_FRACTION) return (1 - phase) / GRAVITY_PARTICLE_FADE_FRACTION
  return 1
}
