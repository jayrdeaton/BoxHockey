export interface GoalWedge {
  startAngle: number
  sweepAngle: number
}

// Divides a goal crease's half-circle (a 180° arc, see Board.tsx's score wedges) into `count`
// equal pie wedges — one per point needed to win — starting from the same angle the crease's own
// arc starts from (0 for the top goal, 180 for the bottom) and sweeping in the same clockwise
// direction, so consecutive wedges tile the crease edge-to-edge with no gaps or overlaps.
export function computeGoalWedges(count: number, baseAngle: number): GoalWedge[] {
  const sweepAngle = 180 / count
  return Array.from({ length: count }, (_, i) => ({ startAngle: baseAngle + i * sweepAngle, sweepAngle }))
}
