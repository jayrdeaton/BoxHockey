import { Platform } from 'react-native'
import { EdgeInsets } from 'react-native-safe-area-context'

import { DESKTOP_WEB_MIN_WIDTH, FACEOFF_ZONE_RADIUS_RATIO, GOAL_LINE_STROKE_WIDTH, GOAL_OPEN_FRACTION, PADDLE_SIZE_RATIOS, PUCK_SIZE_RATIOS, TABLE_LONG_TO_SHORT_RATIO, WALL_THICKNESS } from '@/games/airhockey/constants/game'
import { BoardLayout, GoalAxis, GoalPost, GoalSide, PaddleSizeLevel, Player, PuckSizeLevel } from '@/games/airhockey/types'

// Mirrors game.tsx's own isDesktopWeb - desktop web is the only context that fixes the board to
// its real-world aspect ratio (TABLE_LONG_TO_SHORT_RATIO) rather than filling the viewport
// exactly, and draws literal perimeter walls into the margin that leaves. Native and mobile web
// fill their container exactly, so the device's own physical edge already reads as the boundary
// with zero gap.
function isDesktopLayout(screenWidth: number): boolean {
  return Platform.OS === 'web' && screenWidth >= DESKTOP_WEB_MIN_WIDTH
}

function boardMargin(screenWidth: number): number {
  return isDesktopLayout(screenWidth) ? WALL_THICKNESS : 0
}

export function computeViewportSize(screenWidth: number, screenHeight: number, insets: EdgeInsets): { width: number; height: number } {
  const margin = boardMargin(screenWidth)
  return {
    width: screenWidth - insets.left - insets.right - margin * 2,
    height: screenHeight - insets.top - insets.bottom - margin * 2
  }
}

// The safe-area insets at each end of the local short (goal-line) and long (goal-to-goal) axes,
// following the same "which real dimension is short vs. long" split computeViewportSize's callers
// make from goalAxis below.
function axisInsets(insets: EdgeInsets, goalAxis: GoalAxis): { shortStart: number; longStart: number; longEnd: number } {
  return goalAxis === 'vertical' ? { shortStart: insets.left, longStart: insets.top, longEnd: insets.bottom } : { shortStart: insets.top, longStart: insets.left, longEnd: insets.right }
}

// The LOCAL board container - the whole screen, safe-area insets included, expressed in local
// terms: S-wide (short axis, where the goal sits) by L-tall (long axis, goal-to-goal), whichever
// real screen dimension is currently short vs. long given goalAxis. game.tsx uses this directly to
// size the View it rotates (see GoalAxis's own doc comment in types/index.ts): the container is
// always laid out S-wide by L-tall in local terms, then rotated ±90° onto the real screen when
// goalAxis is 'horizontal'. It covers the insets (rather than sitting inside them) so that, with
// Settings.rink on, the pocket behind each goal can reach into the otherwise-empty status-bar/home-
// indicator space, same as BoxHockey's own rink; computeBoardLayout keeps the playing field itself
// clear of them.
export function computeLocalContainerSize(screenWidth: number, screenHeight: number, goalAxis: GoalAxis): { width: number; height: number } {
  return goalAxis === 'vertical' ? { width: screenWidth, height: screenHeight } : { width: screenHeight, height: screenWidth }
}

// The board's own short/long extents (S, L) inside the safe area. Desktop web fixes them to the
// real-world aspect ratio (TABLE_LONG_TO_SHORT_RATIO) and letterboxes; native and mobile web fill
// the safe area exactly.
function computeFieldExtents(screenWidth: number, screenHeight: number, insets: EdgeInsets, goalAxis: GoalAxis): { S: number; L: number; availableShort: number; availableLong: number } {
  const { width: availableWidth, height: availableHeight } = computeViewportSize(screenWidth, screenHeight, insets)
  const availableShort = goalAxis === 'vertical' ? availableWidth : availableHeight
  const availableLong = goalAxis === 'vertical' ? availableHeight : availableWidth

  let S = availableShort
  let L = availableLong
  if (isDesktopLayout(screenWidth)) {
    L = S * TABLE_LONG_TO_SHORT_RATIO
    if (L > availableLong) {
      L = availableLong
      S = L / TABLE_LONG_TO_SHORT_RATIO
    }
  }
  return { S, L, availableShort, availableLong }
}

// Which local side (always 'bottom' for player 1, 'top' for player 2 - see GoalSide's own doc
// comment) a given player defends. A plain function of the player number, not board state: this
// convention never varies board-to-board, so there's nothing to store on BoardLayout itself.
export function playerGoalSide(player: Player): GoalSide {
  return player === 1 ? 'bottom' : 'top'
}

function buildGoalPosts(x: number, y: number, height: number, goalStart: number, goalEnd: number, radius: number): GoalPost[] {
  return [
    // Player 2 defends the local top line (y).
    { x: x + goalStart, y, radius, player: 2 },
    { x: x + goalEnd, y, radius, player: 2 },
    // Player 1 defends the local bottom line (y + height).
    { x: x + goalStart, y: y + height, radius, player: 1 },
    { x: x + goalEnd, y: y + height, radius, player: 1 }
  ]
}

// Single source of truth for board geometry, always expressed in the canonical LOCAL space (see
// GoalSide's own doc comment in types/index.ts) - goals on the local top/bottom regardless of the
// real device orientation, in the coordinates of computeLocalContainerSize's full-screen
// container. goalAxis is accepted only to decide which real screen dimension is currently "short"
// vs. "long" (so puck/paddle/goal sizing always derives from the true short edge, whichever real
// axis that happens to be right now) - it never branches the geometry itself beyond that, unlike
// BoxHockey's board.ts, which never needed to make that distinction at all since its board is
// permanently portrait.
export function computeBoardLayout(screenWidth: number, screenHeight: number, insets: EdgeInsets, goalAxis: GoalAxis, puckSize: PuckSizeLevel = 'medium', paddleSize: PaddleSizeLevel = 'medium', rink: boolean = false): BoardLayout {
  const { S, L, availableShort, availableLong } = computeFieldExtents(screenWidth, screenHeight, insets, goalAxis)
  const { shortStart, longStart, longEnd } = axisInsets(insets, goalAxis)

  const margin = boardMargin(screenWidth)
  const puckRadius = S * PUCK_SIZE_RATIOS[puckSize]
  const paddleRadius = S * PADDLE_SIZE_RATIOS[paddleSize]
  // See GOAL_OPEN_FRACTION's own comment: derived from the actual paddle+puck blocking span (not
  // an independent flat fraction of S) so the goal stays fair for every size combination.
  const blockingSpan = (paddleRadius + puckRadius) * 2
  const goalWidth = blockingSpan / (1 - GOAL_OPEN_FRACTION)
  const goalStart = (S - goalWidth) / 2
  const goalEnd = goalStart + goalWidth

  // Settings.rink only, with BoxHockey's exact formulas: rounded outer corners and a real pocket
  // behind each goal the puck can skate into (see physics.ts's boardCornerQuadrant/skipGoalGap and
  // the one-way door). Both 0 when it's off: square corners and a permeable goal line at the
  // safe-area edge, where a puck whose center clears the posts and the line scores immediately.
  //
  // The depth must be >= 2*puckRadius + WALL_THICKNESS so a gradual (not single-frame) score can
  // fully clear the line before meeting the pocket's back wall; 2.5x leaves real margin. It's also
  // floored at both long-axis insets so the pocket reaches all the way to the physical screen edge
  // on both ends (see the borrows below).
  const behindGoalDepth = rink ? Math.max(puckRadius * 2.5 + WALL_THICKNESS, longStart, longEnd) : 0
  const cornerRadius = rink ? S * 0.12 : 0

  // Rather than shrink the field by the full behindGoalDepth at both ends (which pushes each goal
  // line forward, away from the screen edge), borrow from the safe-area insets first: that space
  // is otherwise just empty background. Capped at each inset (can't borrow more than exists there);
  // whatever's left over still shrinks the field, so this degrades gracefully on devices with
  // small or no insets. With unequal insets (a notch vs. a home indicator) the smaller end can't
  // borrow its full share of the shared depth, so that goal line sits slightly in from its edge.
  const startBorrow = Math.min(behindGoalDepth, longStart)
  const endBorrow = Math.min(behindGoalDepth, longEnd)

  const x = shortStart + margin + (availableShort - S) / 2
  const outerTop = longStart + margin + (availableLong - L) / 2 - startBorrow
  const y = outerTop + behindGoalDepth
  const width = S
  const height = L - behindGoalDepth * 2 + startBorrow + endBorrow

  const postRadius = puckRadius * 0.18

  return {
    x,
    y,
    width,
    height,
    goalAxis,
    wallThickness: GOAL_LINE_STROKE_WIDTH,
    goalWidth,
    goalStart,
    goalEnd,
    puckRadius,
    paddleRadius,
    centerX: x + width / 2,
    centerY: y + height / 2,
    obstacles: [],
    goalPosts: buildGoalPosts(x, y, height, goalStart, goalEnd, postRadius),
    cornerRadius,
    behindGoalDepth
  }
}

export function centerPuck(board: BoardLayout): { x: number; y: number } {
  return { x: board.centerX, y: board.centerY }
}

// A player's defensive rest position - their own goal line, offset in - used to reset both
// paddles after a goal (see GOAL_SERVE in useGameState.ts) and as the AI's own "retreat and cover
// the net" target when the puck isn't a threat (see aiOpponent.ts).
const PADDLE_HOME_OFFSET_RATIO = 1.5

export function centerPaddle(board: BoardLayout, player: Player): { x: number; y: number } {
  const offset = board.paddleRadius * PADDLE_HOME_OFFSET_RATIO
  const y = playerGoalSide(player) === 'bottom' ? board.y + board.height - offset : board.y + offset
  return { x: board.centerX, y }
}

// Rink faceoff circle positions, ported from BoxHockey's own faceoffZoneCenters unchanged (same
// 0.27/0.42 offsets - BoxHockey's non-gauntlet faceoffOffsetYRatio) - two per player, flanking
// their own goal. Board.tsx renders both purely as static rink chrome (see FACEOFF_ZONE_RADIUS_
// RATIO's own comment); useGameState's GOAL_SERVE is the only thing that actually PICKS one (see
// faceoffZoneCenter below) - the scored-on player's own zone, giving them the restart, same as a
// real rink awards the ensuing faceoff to whoever just conceded. There's no board-variant knob to
// key faceoffOffsetYRatio off, so it's inlined rather than carried as a BoardLayout field the way
// BoxHockey needs it to be.
const FACEOFF_OFFSET_Y_RATIO = 0.42

export function faceoffZoneCenters(board: BoardLayout, player: Player): { x: number; y: number }[] {
  const goalCX = board.x + (board.goalStart + board.goalEnd) / 2
  const offsetX = board.width * 0.27
  const offsetY = (board.height / 2) * FACEOFF_OFFSET_Y_RATIO
  const cy = playerGoalSide(player) === 'bottom' ? board.y + board.height - offsetY : board.y + offsetY
  return [
    { x: goalCX - offsetX, y: cy },
    { x: goalCX + offsetX, y: cy }
  ]
}

export function faceoffZoneCenter(board: BoardLayout, player: Player, zoneIndex: 0 | 1): { x: number; y: number } {
  return faceoffZoneCenters(board, player)[zoneIndex]
}

export function faceoffZoneRadius(board: BoardLayout): number {
  return board.width * FACEOFF_ZONE_RADIUS_RATIO
}

// Clamps a target position to a player's own playable half - both the board's own outer bounds
// (minus radius) AND their own side of the local centerline (minus radius, so the paddle disc's
// own edge stops exactly at the centerline rather than overlapping it). Shared by
// TouchInputLayer's setPaddleTarget (a human's live drag) and aiOpponent's target selection - the
// same clamp rule applies to both input sources, so it lives here once.
export function clampToOwnHalf(x: number, y: number, board: BoardLayout, player: Player, radius: number): { x: number; y: number } {
  const minX = board.x + radius
  const maxX = board.x + board.width - radius
  const minY = board.y + radius
  const maxY = board.y + board.height - radius
  const cx = Math.min(maxX, Math.max(minX, x))
  let cy = Math.min(maxY, Math.max(minY, y))
  cy = playerGoalSide(player) === 'bottom' ? Math.max(cy, board.centerY + radius) : Math.min(cy, board.centerY - radius)
  return { x: cx, y: cy }
}
