// Pure layout math for the goal score-pip rows (see Board.tsx) — one row of `scoreToWin` pips per
// goal, filled in with that player's color as they score. Kept separate/testable for the same
// reason camera.ts is: sizing math that's easy to get subtly wrong (pip count ranges from 3 for
// "first to 3" up to 10 for "first to 10", and all of them need to fit and stay readable) shouldn't
// only be checked by eye.

export interface ScorePipLayout {
  radius: number
  // Pip center X offsets from the row's own center (i.e. symmetric around 0) — add to the goal's
  // own center X to place each pip.
  centerXs: number[]
}

// Pips share the row's available width evenly: for `count` pips of diameter d with gaps of
// d * GAP_RATIO between them, total width = count*d + (count-1)*d*GAP_RATIO. Solving for d given a
// fixed availableWidth keeps the row filling the same visual span whether it's showing 3 pips
// (first-to-3) or 10 (first-to-10), rather than 10 tiny dots trailing off into unused space.
const GAP_RATIO = 0.7
const MIN_RADIUS_PX = 2.5
const MAX_RADIUS_PX = 7

export function computeScorePipLayout(availableWidth: number, count: number): ScorePipLayout {
  const safeCount = Math.max(1, count)
  const diameter = availableWidth / (safeCount + (safeCount - 1) * GAP_RATIO)
  const radius = Math.min(Math.max(diameter / 2, MIN_RADIUS_PX), MAX_RADIUS_PX)
  const spacing = radius * 2 * (1 + GAP_RATIO)
  const totalSpan = spacing * (safeCount - 1)
  const centerXs = Array.from({ length: safeCount }, (_, i) => -totalSpan / 2 + i * spacing)
  return { radius, centerXs }
}
