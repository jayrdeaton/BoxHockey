import { Platform } from 'react-native'
import { EdgeInsets } from 'react-native-safe-area-context'

import { BOARD_ASPECT_RATIO, DESKTOP_WEB_MIN_WIDTH, DIVIDER_HOLE_TO_PUCK_RADIUS, FACEOFF_ZONE_RADIUS_RATIO, GRAVITY_WELL_ATTRACT_STRENGTH, GRAVITY_WELL_REPEL_STRENGTH, PUCK_SIZE_RATIOS, WALL_THICKNESS } from '@/constants/game'
import { BoardLayout, BoardVariant, GravityWell, Obstacle, Player, PuckSizeLevel } from '@/types'

export const BOARD_VARIANT_LABELS: Record<BoardVariant, string> = {
  classic: 'Classic',
  gauntlet: 'Gauntlet',
  gravity: 'Gravity'
}

function buildObstacles(variant: BoardVariant, x: number, y: number, width: number, height: number, wt: number, puckRadius: number, puckSize: PuckSizeLevel): Obstacle[] {
  switch (variant) {
    case 'classic': {
      // A real box hockey table's center divider: a full-width wall down the middle with two
      // holes, each offset to its own side of center, rather than one shared gap — so the direct
      // line between the two goals (both centered on the board) is blocked by solid wall, and
      // scoring means banking the puck through one of the two off-center holes instead. The outer
      // two segments run flush to x/x+width (the play field's own edge, where the perimeter walls
      // in Board.tsx start) rather than stopping wt short of it — that inset was harmless back when
      // the boundary was drawn as a thin line, but against a same-thickness solid perimeter wall it
      // would leave a visible gap between the two.
      // Tuned (2026-08-22, user feedback) after the original 3.2x/0.2w numbers made classic feel
      // too easy: a hole's own INNER edge landed closer to center than the goal mouth's own
      // half-width, and the faceoff dots (offsetX 0.27w in faceoffZoneCenters below) sat almost
      // exactly inside the same-side hole's span — so a near-straight shot from the dot threaded
      // the hole with barely any angle and was already aimed at the goal. holeOffset is pushed out
      // (0.2w -> 0.3w) so the hole's inner edge clears the goal's half-width with real margin — a
      // puck that goes straight through without redirecting lands well outside the goal mouth, so
      // scoring means entering the hole already angled back toward center; that alone (independent
      // of holeW) is what keeps this from being a direct sail-to-net. holeW itself went through
      // several overcorrections the same day (2.4x puck radius was too narrow, matching the fixed
      // GOAL_WIDTH_RATIO board-width fraction was massively too big) before landing on the current
      // rule, per explicit user instruction: it's DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize] × the
      // current puckRadius — the exact same formula computeBoardLayout uses for goalWidth itself,
      // so the divider gap and the goal opening are always identically sized and both scale
      // together when puck size changes, rather than either being tuned as its own independent
      // constant. The multiplier itself is now keyed by puckSize (not one flat number) so a bigger
      // puck setting is a genuinely more forgiving difficulty tier, not just a bigger-but-equally-
      // precise version of the same shot — see DIVIDER_HOLE_TO_PUCK_RADIUS's own comment.
      const holeW = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
      const holeOffset = width * 0.3
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

// Mirrors game.tsx's own isDesktopWeb — needs the live screen width, so unlike most of this
// file's inputs it can't be a plain constant. Desktop web is the only context that (a) fixes the
// board to its real-world aspect ratio rather than filling the viewport exactly (see
// computeBoardLayout) and (b) draws perimeter walls into the margin that leaves (see boardMargin
// and Board.tsx's showWalls) — everywhere else there's no room for either to matter: native and
// mobile web fill their container exactly, so the device's own physical edge already reads as
// the boundary with zero gap. That zero gap isn't just cosmetic — a bank shot only reads
// correctly if the wall the puck bounces off is exactly where the screen visually ends, not
// behind an arbitrary letterboxed margin the player has to mentally account for.
function isDesktopLayout(screenWidth: number): boolean {
  return Platform.OS === 'web' && screenWidth >= DESKTOP_WEB_MIN_WIDTH
}

function boardMargin(screenWidth: number): number {
  return isDesktopLayout(screenWidth) ? WALL_THICKNESS : 0
}

// Size of the board's own container (the flex-child View in game.tsx, which starts right at
// insets.top — there's no score bar above it) — shared by computeBoardLayout below. insets.bottom
// is still reserved (not laid out into, just subtracted here) so the board's own bottom edge
// stays clear of the home indicator.
export function computeViewportSize(screenWidth: number, screenHeight: number, insets: EdgeInsets): { width: number; height: number } {
  const margin = boardMargin(screenWidth)
  return {
    width: screenWidth - margin * 2,
    height: screenHeight - insets.top - insets.bottom - margin * 2
  }
}

export function computeBoardLayout(screenWidth: number, screenHeight: number, insets: EdgeInsets, variant: BoardVariant = 'classic', puckSize: PuckSizeLevel = 'medium'): BoardLayout {
  // x/y are LOCAL to the board's own container (the flex-child View in game.tsx), which already
  // sits below insets.top via that View's own marginTop — adding that offset again here would
  // double-count it, pushing the board off the bottom of the screen.
  const { width: availableWidth, height: availableHeight } = computeViewportSize(screenWidth, screenHeight, insets)

  // Desktop web fixes the board to its real-world aspect ratio (see BOARD_ASPECT_RATIO) rather
  // than stretching to fill whatever shape window it's in — fit whichever dimension is the
  // tighter constraint exactly, and center the board in the other, leaving it letterboxed there
  // instead of distorted. Native and mobile web skip this entirely and just fill the container
  // exactly (whatever shape that device's screen happens to be) — see isDesktopLayout above for
  // why: any letterboxing there would put a gap between the visual wall and the physical edge a
  // bank shot actually bounces off.
  let width = availableWidth
  let height = availableHeight
  if (isDesktopLayout(screenWidth)) {
    height = width / BOARD_ASPECT_RATIO
    if (height > availableHeight) {
      height = availableHeight
      width = height * BOARD_ASPECT_RATIO
    }
  }

  const margin = boardMargin(screenWidth)
  const x = margin + (availableWidth - width) / 2
  const y = margin + (availableHeight - height) / 2

  const puckRadius = width * PUCK_SIZE_RATIOS[puckSize]
  // Same formula buildObstacles' 'classic' case uses for its divider holes (holeW) — see
  // DIVIDER_HOLE_TO_PUCK_RADIUS's own comment for why these two openings are deliberately kept
  // identical rather than tuned independently.
  const goalWidth = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
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
    obstacles: buildObstacles(variant, x, y, width, height, WALL_THICKNESS, puckRadius, puckSize),
    gravityWells: buildGravityWells(variant, x, y, width, height)
  }
}

export function centerPuck(board: BoardLayout): { x: number; y: number } {
  return { x: board.centerX, y: board.centerY }
}

// The rink faceoff dots — originally purely decorative (Board.tsx), now doing double duty as
// 'coinFlip' puck-placement spots AND 'faceoff' mode's press targets (see game.tsx's
// stableFaceoffTap hit-test and Board.tsx's rendering, both of which call this rather than
// recomputing the geometry themselves) — this is the single shared source of truth for where they
// actually are, so the drawn circle, the puck placement, and the tap hit-test can never drift
// apart from each other.
export function faceoffZoneCenters(board: BoardLayout, player: Player): { x: number; y: number }[] {
  const goalCX = board.x + (board.goalLeft + board.goalRight) / 2
  const offsetX = board.width * 0.27
  const offsetY = (board.height / 2) * 0.42
  // Player 1 always sits at the bottom (matching /loadout's own "P1 is the device's owner, near
  // the bottom" seating convention) — every other top/bottom-keyed spot in the app (goal scoring
  // in physics.ts, AI targeting in aiOpponent.ts, the faceoff knock in faceoff.ts, the crease/
  // wedge/zone-line geometry in Board.tsx, and the tap-zone wiring in game.tsx) follows this one.
  const cy = player === 1 ? board.y + board.height - offsetY : board.y + offsetY
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
