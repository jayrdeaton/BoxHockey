import { Platform } from 'react-native'
import { EdgeInsets } from 'react-native-safe-area-context'

import { BOARD_ASPECT_RATIO, DESKTOP_WEB_MIN_WIDTH, DIVIDER_HOLE_TO_PUCK_RADIUS, FACEOFF_ZONE_RADIUS_RATIO, GRAVITY_WELL_ATTRACT_STRENGTH, GRAVITY_WELL_CORNER_REPEL_STRENGTH, GRAVITY_WELL_REPEL_STRENGTH, PUCK_SIZE_RATIOS, WALL_THICKNESS } from '@/constants/game'
import { BoardLayout, BoardVariant, GravityWell, Obstacle, Player, PuckSizeLevel } from '@/types'

export const BOARD_VARIANT_LABELS: Record<BoardVariant, string> = {
  classic: 'Classic',
  gauntlet: 'Gauntlet',
  gauntletPlus: 'Gauntlet+',
  gravity: 'Gravity',
  gravityClassic: 'Gravity Classic',
  rink: 'Rink'
}

// Shared by any variant that needs a full-width wall broken by one or more gaps, given their
// centers — gauntletPlus's three walls below. classic/gauntlet keep their own hand-inlined
// 2-hole/1-hole versions in their own switch cases rather than being rewritten onto this, so this
// change doesn't touch already-tuned, already-tested geometry for an unrelated feature.
function buildWallWithGaps(x: number, width: number, wallY: number, wt: number, gapCenters: number[], gapW: number): Obstacle[] {
  const sorted = [...gapCenters].sort((a, b) => a - b)
  const segments: Obstacle[] = []
  let cursor = x
  for (const gapCX of sorted) {
    segments.push({ x: cursor, y: wallY, width: gapCX - gapW / 2 - cursor, height: wt })
    cursor = gapCX + gapW / 2
  }
  segments.push({ x: cursor, y: wallY, width: x + width - cursor, height: wt })
  return segments
}

function buildObstacles(variant: BoardVariant, x: number, y: number, width: number, height: number, wt: number, puckRadius: number, puckSize: PuckSizeLevel, behindGoalDepth: number): Obstacle[] {
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

    case 'gauntletPlus': {
      // Alternating goal -> 2-hole -> 1-hole (center) -> 2-hole -> goal. The outer two walls use a
      // NARROWER gap than classic's goal-matching DIVIDER_HOLE_TO_PUCK_RADIUS formula (these are
      // mid-board challenge gates, not the goal itself, so there's no reason to tie their width to
      // goal-scoring precision) and are offset further from center than the faceoff dot's own
      // 0.27w offset (see faceoffZoneCenters below) so a dead-straight shot from the dot doesn't
      // thread the near wall's gate for free — see boardGeometry.test.ts's dot-clearance
      // assertion, which is the actual authority on whether this offset is wide enough, not this
      // comment. The center wall's single gap reuses today's 'gauntlet' formula verbatim.
      const centerX = x + width / 2
      const outerGapW = puckRadius * 2.2
      const outerOffset = width * 0.38
      const centerGapW = puckRadius * 3.2
      const topY = y + height * 0.32 - wt / 2
      const midY = y + height * 0.5 - wt / 2
      const botY = y + height * 0.68 - wt / 2
      return [...buildWallWithGaps(x, width, topY, wt, [centerX - outerOffset, centerX + outerOffset], outerGapW), ...buildWallWithGaps(x, width, midY, wt, [centerX], centerGapW), ...buildWallWithGaps(x, width, botY, wt, [centerX - outerOffset, centerX + outerOffset], outerGapW)]
    }

    case 'gravityClassic':
      // Same center divider as 'classic' — the wells (see buildGravityWells below) layer on top
      // of this rather than replacing it.
      return buildObstacles('classic', x, y, width, height, wt, puckRadius, puckSize, behindGoalDepth)

    case 'rink': {
      // A solid wall spanning exactly the goal's own x-range, flush against the true outer
      // boundary behind each goal (behindGoalDepth back from board.y/board.y+height — see
      // computeBoardLayout, which extends the true collision boundary out there while board.y/
      // board.height keep meaning "the front goal line" for every other consumer, same as always).
      // This is what makes "can't score from behind" true: the goal-scoring check in stepPhysics
      // only looks at current position (whole puck body past the line, within goal x-range), not
      // which direction the puck arrived from — without this wall, a puck that wrapped around via
      // a rounded corner into the pocket could drift sideways into the goal's x-range while
      // already past the line and trigger an accidental score. This wall physically closes off
      // that one region, so satisfying the score condition still always means coming at it from
      // the front, same as every other variant.
      const goalW = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
      const goalCenterX = x + width / 2
      const netWallX = goalCenterX - goalW / 2
      const topNetY = y - behindGoalDepth
      const botNetY = y + height + behindGoalDepth - wt
      return [
        { x: netWallX, y: topNetY, width: goalW, height: wt },
        { x: netWallX, y: botNetY, width: goalW, height: wt }
      ]
    }
  }
}

function buildGravityWells(variant: BoardVariant, x: number, y: number, width: number, height: number): GravityWell[] {
  switch (variant) {
    case 'classic':
    case 'gauntlet':
    case 'gauntletPlus':
    case 'rink':
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

    case 'gravityClassic': {
      // classic's center wall (see buildObstacles above) plus 4 corner repellers and 1 center
      // attractor. Corner wells are deliberately small/tucked-in (offsets measured from each
      // side, not from center like 'gravity's wells above) and use activeAtRest — see
      // GRAVITY_WELL_CORNER_REPEL_STRENGTH's own comment in constants/game.ts — so a puck can
      // never permanently die in a corner, which is the whole point of them.
      const cornerR = width * 0.09
      const cornerOffsetX = width * 0.16
      const cornerOffsetY = height * 0.08
      // Per explicit design direction: the pull well sits exactly at the board's true center,
      // literally coincident with classic's solid center wall, rather than tucked into one of its
      // two gaps. This is physically sound as-is — applyGravityWellForces only needs a target
      // coordinate, not a reachable one; a puck approaching from either half gets pulled toward
      // the wall face and then collides with the wall's own Obstacle rect well before it could
      // ever reach the literal center point, same as it already can't tunnel through any other
      // wall. Rendered so it visibly sits on/over the wall segment there (see Board.tsx).
      const centerX = x + width / 2
      const centerY = y + height / 2
      return [
        { x: x + cornerOffsetX, y: y + cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: x + width - cornerOffsetX, y: y + cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: x + cornerOffsetX, y: y + height - cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: x + width - cornerOffsetX, y: y + height - cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: centerX, y: centerY, radius: width * 0.11, strength: GRAVITY_WELL_ATTRACT_STRENGTH }
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
  const outerY = margin + (availableHeight - height) / 2

  const puckRadius = width * PUCK_SIZE_RATIOS[puckSize]
  // Same formula buildObstacles' 'classic' case uses for its divider holes (holeW) — see
  // DIVIDER_HOLE_TO_PUCK_RADIUS's own comment for why these two openings are deliberately kept
  // identical rather than tuned independently.
  const goalWidth = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
  const goalLeft = (width - goalWidth) / 2
  const goalRight = goalLeft + goalWidth

  // 'rink' only: extends the TRUE collision boundary behind each goal (rounded corners + a
  // behind-the-net pocket — see physics.ts's boardCornerQuadrant/circleVsRoundedCorner and
  // buildObstacles' 'rink' case for the net's back wall) while keeping x/y/width/height below
  // meaning exactly what they mean for every other variant: the front-line-to-front-line playing
  // rectangle that faceoffZoneCenters, aiOpponent.ts's targeting, faceoff.ts, and every crease/
  // zone-line render in Board.tsx already assume — none of those need to change for 'rink'.
  //
  // behindGoalDepth must be >= 2*puckRadius + wallThickness: that's the puck's own full diameter
  // (leading edge to trailing edge) plus the net wall's own thickness. A puck completing a normal,
  // gradual goal (not a single-frame instant clear) has its leading edge sitting exactly
  // puckRadius*2 past the line at the moment its trailing edge finally clears — if the net's back
  // wall sat any closer than that, a slow/moderate shot would collide with its own goal's back
  // wall mid-crossing and bounce back out before ever completing the score. 2.5x (rather than the
  // bare 2x + wt minimum) leaves real margin rather than a razor's-edge boundary. The 'portal'
  // clip on the puck's own rendering (see Board.tsx) is what keeps this invisible to the player —
  // the depth is physically necessary but never actually seen.
  const behindGoalDepth = variant === 'rink' ? puckRadius * 2.5 + WALL_THICKNESS : 0
  // Must be >= behindGoalDepth or the rounded corner's own arc (see boardCornerQuadrant in
  // physics.ts, which only exempts the flat front-wall check within cornerRadius of the TRUE
  // outer corner) never actually reaches back to the front line (board.y) — leaving a flat,
  // un-exempted wall segment between where the quadrant starts and the front line, which would
  // silently seal the pocket off from the field entirely. 1.15x leaves a little slack beyond the
  // bare minimum so the curve visibly opens rather than just barely grazing the line.
  const cornerRadius = variant === 'rink' ? behindGoalDepth * 1.15 : 0

  const y = outerY + behindGoalDepth
  const fieldHeight = height - behindGoalDepth * 2

  return {
    x,
    y,
    width,
    height: fieldHeight,
    wallThickness: WALL_THICKNESS,
    goalWidth,
    goalLeft,
    goalRight,
    puckRadius,
    centerX: x + width / 2,
    centerY: y + fieldHeight / 2,
    obstacles: buildObstacles(variant, x, y, width, fieldHeight, WALL_THICKNESS, puckRadius, puckSize, behindGoalDepth),
    gravityWells: buildGravityWells(variant, x, y, width, fieldHeight),
    cornerRadius,
    behindGoalDepth
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
