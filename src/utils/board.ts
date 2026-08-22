import { EdgeInsets } from 'react-native-safe-area-context'

import { BOARD_ASPECT_RATIO, BOARD_MARGIN, GOAL_WIDTH_RATIO, GRAVITY_WELL_ATTRACT_STRENGTH, GRAVITY_WELL_REPEL_STRENGTH, PUCK_RADIUS_RATIO, WALL_THICKNESS } from '@/constants/game'
import { BoardLayout, BoardVariant, GravityWell, Obstacle } from '@/types'

export const BOARD_VARIANT_LABELS: Record<BoardVariant, string> = {
  classic: 'Classic',
  open: 'Open',
  gauntlet: 'Gauntlet',
  gravity: 'Gravity'
}

function buildObstacles(variant: BoardVariant, x: number, y: number, width: number, height: number, wt: number, puckRadius: number): Obstacle[] {
  switch (variant) {
    case 'open':
      return []

    case 'classic': {
      // A real box hockey table's center divider: a full-width wall down the middle with two
      // holes, each offset to its own side of center, rather than one shared gap — so the direct
      // line between the two goals (both centered on the board) is blocked by solid wall, and
      // scoring means banking the puck through one of the two off-center holes instead. The outer
      // two segments run flush to x/x+width (the play field's own edge, where the perimeter walls
      // in Board.tsx start) rather than stopping wt short of it — that inset was harmless back when
      // the boundary was drawn as a thin line, but against a same-thickness solid perimeter wall it
      // would leave a visible gap between the two.
      const holeW = puckRadius * 3.2
      const holeOffset = width * 0.2
      const wallY = y + height / 2 - wt / 2
      const centerX = x + width / 2
      const hole1CX = centerX - holeOffset
      const hole2CX = centerX + holeOffset
      const hole1Start = hole1CX - holeW / 2
      const hole1End = hole1CX + holeW / 2
      const hole2Start = hole2CX - holeW / 2
      const hole2End = hole2CX + holeW / 2
      return [
        { x: x, y: wallY, width: hole1Start - x, height: wt },
        { x: hole1End, y: wallY, width: hole2Start - hole1End, height: wt },
        { x: hole2End, y: wallY, width: x + width - hole2End, height: wt }
      ]
    }

    case 'gauntlet': {
      // Full-width center bar with a narrow center gap — requires precise aiming to thread the
      // puck through the single opening. Flush to x/x+width for the same reason as classic above.
      const gapW = puckRadius * 3.2
      const centerX = x + width / 2
      const barY = y + height * 0.5 - wt / 2
      const leftW = centerX - gapW / 2 - x
      const rightStart = centerX + gapW / 2
      const rightW = x + width - rightStart
      return [
        { x: x, y: barY, width: leftW, height: wt },
        { x: rightStart, y: barY, width: rightW, height: wt }
      ]
    }

    case 'gravity':
      return []
  }
}

function buildGravityWells(variant: BoardVariant, x: number, y: number, width: number, height: number): GravityWell[] {
  switch (variant) {
    case 'open':
    case 'classic':
    case 'gauntlet':
      return []

    case 'gravity': {
      // One attractor, one repeller, symmetric off-center. Offset + radius
      // stay clear of the side walls (0.24w + 0.11w = 0.35w < w/2 - wallThickness
      // for any realistic board width) so wall restitution and well pull never
      // fight each other near the boundary.
      const wellR = width * 0.11
      const offsetX = width * 0.24
      const cy = y + height / 2
      return [
        { x: x + width / 2 - offsetX, y: cy, radius: wellR, strength: GRAVITY_WELL_ATTRACT_STRENGTH },
        { x: x + width / 2 + offsetX, y: cy, radius: wellR, strength: GRAVITY_WELL_REPEL_STRENGTH }
      ]
    }
  }
}

// Size of the board's own container (the flex-child View in game.tsx, which starts right at
// insets.top — there's no score bar above it) — shared by computeBoardLayout below and game.tsx's
// camera setup (the pan/zoom viewport is exactly this same container), so there's one source of
// truth for it. insets.bottom is still reserved (not laid out into, just subtracted here) so the
// board's own bottom edge stays clear of the home indicator.
export function computeViewportSize(screenWidth: number, screenHeight: number, insets: EdgeInsets): { width: number; height: number } {
  return {
    width: screenWidth - BOARD_MARGIN * 2,
    height: screenHeight - insets.top - insets.bottom - BOARD_MARGIN * 2
  }
}

export function computeBoardLayout(screenWidth: number, screenHeight: number, insets: EdgeInsets, variant: BoardVariant = 'classic'): BoardLayout {
  // x/y are LOCAL to the board's own container (the flex-child View in game.tsx), which already
  // sits below insets.top via that View's own marginTop — adding that offset again here would
  // double-count it, pushing the board off the bottom of the screen.
  const { width: availableWidth, height: availableHeight } = computeViewportSize(screenWidth, screenHeight, insets)

  // Fixed real-world aspect ratio (see BOARD_ASPECT_RATIO) rather than stretching to fill
  // whatever shape screen it's on — fit whichever dimension is the tighter constraint exactly,
  // and center the board in the other, leaving it letterboxed there instead of distorted.
  let width = availableWidth
  let height = width / BOARD_ASPECT_RATIO
  if (height > availableHeight) {
    height = availableHeight
    width = height * BOARD_ASPECT_RATIO
  }

  const x = BOARD_MARGIN + (availableWidth - width) / 2
  const y = BOARD_MARGIN + (availableHeight - height) / 2

  const puckRadius = width * PUCK_RADIUS_RATIO
  const goalWidth = width * GOAL_WIDTH_RATIO
  const goalLeft = (width - goalWidth) / 2
  const goalRight = goalLeft + goalWidth

  return {
    x,
    y,
    width,
    height,
    wallThickness: WALL_THICKNESS,
    goalWidth,
    goalLeft,
    goalRight,
    puckRadius,
    centerX: x + width / 2,
    centerY: y + height / 2,
    obstacles: buildObstacles(variant, x, y, width, height, WALL_THICKNESS, puckRadius),
    gravityWells: buildGravityWells(variant, x, y, width, height)
  }
}

export function centerPuck(board: BoardLayout): { x: number; y: number } {
  return { x: board.centerX, y: board.centerY }
}
