import { Platform } from 'react-native'
import { EdgeInsets } from 'react-native-safe-area-context'

import { BALL_RADIUS_RATIO, BRICK_GAP_RATIO, DESKTOP_WEB_MIN_WIDTH, PADDLE_HEIGHT_RATIOS, PADDLE_INSET_RATIO, PADDLE_WIDTH_RATIO, SHARED_BRICK_COLS, SHARED_BRICK_FIELD_WIDTH_RATIO, SHARED_BRICK_FIELD_Y_MARGIN_RATIO, SHARED_BRICK_ROWS, SOLO_BRICK_COLS, SOLO_BRICK_FIELD_X_END_RATIO, SOLO_BRICK_FIELD_X_START_RATIO, SOLO_BRICK_FIELD_Y_MARGIN_RATIO, SOLO_BRICK_ROWS, TABLE_WIDTH_TO_HEIGHT_RATIO, WALL_THICKNESS } from '@/shared/paddleGame/constants/game'
import { BoardLayout, Brick, PaddleSizeLevel, Player } from '@/shared/paddleGame/types'

// Mirrors AirHockey's own isDesktopLayout - desktop web is the only context that fixes the board
// to a fixed aspect ratio (TABLE_WIDTH_TO_HEIGHT_RATIO) rather than filling the viewport exactly.
// Native and mobile web fill their container exactly, so the device's own physical edge already
// reads as the boundary with zero gap.
function isDesktopLayout(screenWidth: number): boolean {
  return Platform.OS === 'web' && screenWidth >= DESKTOP_WEB_MIN_WIDTH
}

export function computeViewportSize(screenWidth: number, screenHeight: number, insets: EdgeInsets): { width: number; height: number } {
  return { width: screenWidth - insets.left - insets.right, height: screenHeight - insets.top - insets.bottom }
}

// No goalAxis/rotation parameter at all - unlike AirHockey's computeBoardLayout, board/physics/AI
// stay in canonical local space always (paddles at local-left/local-right, ball travels along
// local X). The rendering layer (game.tsx) is what rotates this local space onto the real screen
// via @tastic/split-screen's getFixedZoneRotation - see the design spec's note below - this
// function never needs to know about real device orientation; game.tsx alone decides which real
// width/height to feed it based on the live orientationMode.
export function computeBoardLayout(screenWidth: number, screenHeight: number, insets: EdgeInsets, paddleSize: PaddleSizeLevel = 'medium'): BoardLayout {
  const { width: availableWidth, height: availableHeight } = computeViewportSize(screenWidth, screenHeight, insets)

  let width = availableWidth
  let height = availableHeight
  if (isDesktopLayout(screenWidth)) {
    height = width / TABLE_WIDTH_TO_HEIGHT_RATIO
    if (height > availableHeight) {
      height = availableHeight
      width = height * TABLE_WIDTH_TO_HEIGHT_RATIO
    }
  }

  const x = insets.left + (availableWidth - width) / 2
  const y = insets.top + (availableHeight - height) / 2

  const ballRadius = height * BALL_RADIUS_RATIO
  const paddleHeight = height * PADDLE_HEIGHT_RATIOS[paddleSize]
  const paddleWidth = height * PADDLE_WIDTH_RATIO
  const paddleInset = width * PADDLE_INSET_RATIO

  return {
    x,
    y,
    width,
    height,
    wallThickness: WALL_THICKNESS,
    ballRadius,
    paddleWidth,
    paddleHeight,
    paddleX: { 1: x + paddleInset, 2: x + width - paddleInset },
    paddleMinY: y + paddleHeight / 2,
    paddleMaxY: y + height - paddleHeight / 2,
    centerX: x + width / 2,
    centerY: y + height / 2
  }
}

export function centerBall(board: BoardLayout): { x: number; y: number } {
  return { x: board.centerX, y: board.centerY }
}

export function centerPaddle(board: BoardLayout, player: Player): { x: number; y: number } {
  return { x: board.paddleX[player], y: board.centerY }
}

// The full equivalent of AirHockey's clampToOwnHalf, just narrower: a Pong paddle only ever moves
// on Y (its X is permanently fixed by board.paddleX), and it covers the full court height rather
// than half of it - there's no "own half" concept left once nothing behind the paddle needs
// defending. Shared by TouchInputLayer's setPaddleTarget (a human's live drag) and aiOpponent's
// target selection, same as AirHockey.
export function clampPaddleY(y: number, board: BoardLayout): number {
  return Math.min(board.paddleMaxY, Math.max(board.paddleMinY, y))
}

// Evenly divides [x0,x1]×[y0,y1] into a cols×rows grid, each cell inset by `gap` (split evenly on
// both sides) so neighboring bricks never touch. x/y are top-left corners, matching @tastic/
// physics's circleVsRect and ObstacleRect's own rect convention (not center-based, unlike a paddle
// rect - see applyPaddleCollision's own center-to-corner conversion in utils/physics.ts).
function packBrickGrid(x0: number, y0: number, x1: number, y1: number, cols: number, rows: number, gap: number): Omit<Brick, 'destroyed'>[] {
  const cellWidth = (x1 - x0) / cols
  const cellHeight = (y1 - y0) / rows
  const width = cellWidth - gap
  const height = cellHeight - gap
  const bricks: Omit<Brick, 'destroyed'>[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      bricks.push({ x: x0 + col * cellWidth + gap / 2, y: y0 + row * cellHeight + gap / 2, width, height })
    }
  }
  return bricks
}

// Full-court field for solo/Brickbreaker - leaves runway near paddle 1 and a margin before the far
// wall, rather than spanning edge to edge.
export function buildSoloBrickField(board: BoardLayout): Brick[] {
  const gap = board.height * BRICK_GAP_RATIO
  const x0 = board.x + board.width * SOLO_BRICK_FIELD_X_START_RATIO
  const x1 = board.x + board.width * SOLO_BRICK_FIELD_X_END_RATIO
  const y0 = board.y + board.height * SOLO_BRICK_FIELD_Y_MARGIN_RATIO
  const y1 = board.y + board.height * (1 - SOLO_BRICK_FIELD_Y_MARGIN_RATIO)
  return packBrickGrid(x0, y0, x1, y1, SOLO_BRICK_COLS, SOLO_BRICK_ROWS, gap).map((b) => ({ ...b, destroyed: false }))
}

// Smaller mid-court field for the vsCpu/twoPlayer Bricks toggle, centered on the court. A paddle
// only ever moves in Y at a fixed X (board.paddleX), so a block centered on centerX can never
// overlap either paddle's reachable area regardless of its height.
export function buildSharedBrickField(board: BoardLayout): Brick[] {
  const gap = board.height * BRICK_GAP_RATIO
  const halfWidth = (board.width * SHARED_BRICK_FIELD_WIDTH_RATIO) / 2
  const x0 = board.centerX - halfWidth
  const x1 = board.centerX + halfWidth
  const y0 = board.y + board.height * SHARED_BRICK_FIELD_Y_MARGIN_RATIO
  const y1 = board.y + board.height * (1 - SHARED_BRICK_FIELD_Y_MARGIN_RATIO)
  return packBrickGrid(x0, y0, x1, y1, SHARED_BRICK_COLS, SHARED_BRICK_ROWS, gap).map((b) => ({ ...b, destroyed: false }))
}

// Board-change remap for bricks - same fractional-remap technique as useGameState.ts's own
// rescaleBall (kept here rather than there since it's pure board-geometry math, no game-state
// concerns). destroyed carries straight through unchanged; only geometry is remapped.
export function rescaleBricks(bricks: Brick[], prevBoard: BoardLayout, board: BoardLayout): Brick[] {
  const degenerate = prevBoard.width <= 0 || prevBoard.height <= 0
  const scaleX = degenerate ? 1 : board.width / prevBoard.width
  const scaleY = degenerate ? 1 : board.height / prevBoard.height
  return bricks.map((b) => {
    const fx = degenerate ? 0.5 : (b.x - prevBoard.x) / prevBoard.width
    const fy = degenerate ? 0.5 : (b.y - prevBoard.y) / prevBoard.height
    return { ...b, x: board.x + fx * board.width, y: board.y + fy * board.height, width: b.width * scaleX, height: b.height * scaleY }
  })
}

// NOTE on the orientation layer built on top of this (see the plan file + BoxHockey source for
// exact @tastic/split-screen usage): when the live orientationMode is 'sideBySide', local space
// maps directly onto the screen (width=local width, height=local height, screenWidth/screenHeight
// passed straight through). When 'faceToFace', the container hosting the board+TouchInputLayer
// tree is rotated 90°/-90° via getFixedZoneRotation, and computeBoardLayout must be called with
// the SWAPPED dimensions (screenHeight passed as screenWidth and vice versa) so the local rect
// still comes out sized correctly for its own rotated container - mirrors AirHockey's original
// computeLocalContainerSize's short/long swap, just resolved one level up in game.tsx rather than
// inside board.ts itself (board.ts stays orientation-agnostic; game.tsx decides which real
// width/height to feed it based on live orientationMode).
