import { EdgeInsets } from 'react-native-safe-area-context'

import { BOARD_MARGIN, GOAL_WIDTH_RATIO, PUCK_RADIUS_RATIO, SCORE_BAR_HEIGHT, WALL_THICKNESS } from '@/constants/game'
import { BoardLayout, BoardVariant, Obstacle } from '@/types'

export const BOARD_VARIANT_LABELS: Record<BoardVariant, string> = {
  classic: 'Classic',
  open: 'Open',
  gauntlet: 'Gauntlet'
}

function buildObstacles(variant: BoardVariant, x: number, y: number, width: number, height: number, wt: number, puckRadius: number): Obstacle[] {
  switch (variant) {
    case 'open':
      return []

    case 'classic': {
      // Two staggered half-walls: upper left-aligned, lower right-aligned.
      // Puck must navigate a zigzag path to reach the goal.
      const obsW = width * 0.52 - wt
      const obsH = wt
      return [
        { x: x + wt, y: y + height * 0.38 - obsH / 2, width: obsW, height: obsH },
        { x: x + width - wt - obsW, y: y + height * 0.62 - obsH / 2, width: obsW, height: obsH }
      ]
    }

    case 'gauntlet': {
      // Full-width center bar with a narrow center gap — requires precise
      // aiming to thread the puck through the single opening.
      const gapW = puckRadius * 3.2
      const centerX = x + width / 2
      const barY = y + height * 0.5 - wt / 2
      const leftW = centerX - gapW / 2 - (x + wt)
      const rightStart = centerX + gapW / 2
      const rightW = x + width - wt - rightStart
      return [
        { x: x + wt, y: barY, width: leftW, height: wt },
        { x: rightStart, y: barY, width: rightW, height: wt }
      ]
    }
  }
}

export function computeBoardLayout(screenWidth: number, screenHeight: number, insets: EdgeInsets, variant: BoardVariant = 'classic'): BoardLayout {
  const x = BOARD_MARGIN
  const y = insets.top + SCORE_BAR_HEIGHT + BOARD_MARGIN
  const width = screenWidth - BOARD_MARGIN * 2
  const height = screenHeight - y - insets.bottom - BOARD_MARGIN

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
    obstacles: buildObstacles(variant, x, y, width, height, WALL_THICKNESS, puckRadius)
  }
}

export function centerPuck(board: BoardLayout): { x: number; y: number } {
  return { x: board.centerX, y: board.centerY }
}
