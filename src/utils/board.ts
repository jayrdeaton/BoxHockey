import { Platform } from 'react-native'
import { EdgeInsets } from 'react-native-safe-area-context'

import { BOARD_ASPECT_RATIO, DESKTOP_WEB_MIN_WIDTH, DIVIDER_HOLE_TO_PUCK_RADIUS, FACEOFF_ZONE_RADIUS_RATIO, GOAL_LINE_STROKE_WIDTH, GRAVITY_WELL_ATTRACT_STRENGTH, GRAVITY_WELL_CORNER_REPEL_STRENGTH, PUCK_SIZE_RATIOS, WALL_POST_RADIUS_RATIO, WALL_THICKNESS } from '@/constants/game'
import { BoardLayout, BoardVariant, GoalPost, GravityWell, Obstacle, Player, PuckSizeLevel, WallPost } from '@/types'

export const BOARD_VARIANT_LABELS: Record<BoardVariant, string> = {
  classic: 'Classic',
  gauntlet: 'Gauntlet',
  gravity: 'Gravity'
}

// Shared by any variant that needs a full-width wall broken by one or more gaps, given their
// centers — gauntlet's three walls below. classic keeps its own hand-inlined 2-hole version
// in its own switch case rather than being rewritten onto this, so this change doesn't touch
// already-tuned, already-tested geometry for an unrelated feature.
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
      // Alternating goal -> 2-hole -> 1-hole (center) -> 2-hole -> goal, per explicit user
      // correction: every gap is the SAME size, using the exact same puckRadius-derived formula
      // classic's own holes use (DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize] × puckRadius) — not a
      // separate, narrower "challenge gate" size. The 3 walls also sit at y-fractions 0.25/0.5/0.75
      // so the two goal lines + 3 walls divide the rink into 4 equal-height zones, also per
      // explicit correction (this does put the outer two walls closer to the faceoff dots than is
      // fully comfortable — see faceoffZoneCenters below — but the equal-quarters requirement takes
      // priority; there was no slack left to also keep the old, wider clearance).
      const centerX = x + width / 2
      const gapW = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
      const outerOffset = width * 0.3 // same offset as classic's own holes, for the same reason (see classic's case above)
      const topY = y + height * 0.25 - wt / 2
      const midY = y + height * 0.5 - wt / 2
      const botY = y + height * 0.75 - wt / 2
      return [...buildWallWithGaps(x, width, topY, wt, [centerX - outerOffset, centerX + outerOffset], gapW), ...buildWallWithGaps(x, width, midY, wt, [centerX], gapW), ...buildWallWithGaps(x, width, botY, wt, [centerX - outerOffset, centerX + outerOffset], gapW)]
    }

    case 'gravity':
      // Same center divider as 'classic' — the wells (see buildGravityWells below) layer on top
      // of this rather than replacing it.
      return buildObstacles('classic', x, y, width, height, wt, puckRadius, puckSize)
  }
}

function buildGravityWells(variant: BoardVariant, x: number, y: number, width: number, height: number, puckRadius: number, puckSize: PuckSizeLevel): GravityWell[] {
  switch (variant) {
    case 'classic':
    case 'gauntlet':
      return []

    case 'gravity': {
      // classic's center wall (see buildObstacles above) plus 4 corner repellers and 1 center
      // attractor. Corner wells use activeAtRest — see GRAVITY_WELL_CORNER_REPEL_STRENGTH's own
      // comment in constants/game.ts — so a puck can never permanently die in a corner, which is
      // the whole point of them.
      //
      // Per explicit user correction after playtesting: a well only ever affects the puck while
      // the puck is within its own radius, so a small "field" barely does anything noticeable —
      // these radii need to be generous (much bigger than the earlier, minimally-reachable sizing)
      // for the pull/push to actually be felt in normal play, not just brushed on the rare exact
      // pass. Rendering opacity was bumped to match (see GravityWellMarker.tsx) so a much bigger
      // field still reads as a clear zone rather than an overwhelming wash.
      const cornerR = width * 0.17
      const cornerOffsetX = width * 0.2
      const cornerOffsetY = height * 0.055
      // Per explicit design direction: the pull well sits exactly at the board's true center,
      // literally coincident with classic's solid center wall, rather than tucked into one of its
      // two gaps. Radius is NOT an arbitrary constant — it's anchored to classic's own hole
      // geometry (see buildObstacles' 'classic' case) so it's guaranteed reachable regardless of
      // puckSize: a fixed radius here (originally width*0.11) turned out to land entirely inside
      // the solid wall segment for every puck size, never once reaching either hole's open space —
      // a puck could physically never get within range of it, a well that could never affect
      // anything by construction, not a tuning problem. holeOffset here matches classic's exactly
      // (0.3w); reaching well past that (0.6×holeW, up from the original bare-minimum 0.15×) is
      // the same "make it much bigger" correction as the corner wells above — capped at 0.6 rather
      // than higher, since 'large' puckSize's wider holeW otherwise pushes this well's reach close
      // enough to overlap the faceoff dots (see boardGeometry.test.ts's dot-clearance guard).
      const centerX = x + width / 2
      const centerY = y + height / 2
      const holeOffset = width * 0.3
      const holeW = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
      const centerWellR = holeOffset + holeW * 0.6
      return [
        { x: x + cornerOffsetX, y: y + cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: x + width - cornerOffsetX, y: y + cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: x + cornerOffsetX, y: y + height - cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: x + width - cornerOffsetX, y: y + height - cornerOffsetY, radius: cornerR, strength: GRAVITY_WELL_CORNER_REPEL_STRENGTH, activeAtRest: true },
        { x: centerX, y: centerY, radius: centerWellR, strength: GRAVITY_WELL_ATTRACT_STRENGTH }
      ]
    }
  }
}

// Built for EVERY board variant (see GoalPost's own comment in types/index.ts for why these are
// circles, not more Obstacle rects, and why this is unconditional now rather than gated on a
// setting). Sized well below the puck's own radius — per explicit correction after playtesting, a
// first pass at 0.28×puckRadius still read as too wide; narrowed further.
//
// Centered EXACTLY at (goalAbsLeft, board.y) / (goalAbsRight, board.y) — per explicit correction,
// the same point where the goal line's own two segments end (see Board.tsx's p1/p2 goal Line
// pairs) and where the crease arc's own two ends land (goalCreaseRadius = goalWidth / 2, centered
// on the goal — see computeGoalWedges), so the post reads as a single shared endpoint capping all
// three rather than something offset to one side of it. This is safe to do without reopening the
// "narrow corridor" problem an earlier version had with flush-but-offset placement: the goalpost
// collision loop in physics.ts is now purely distance-based (circleVsCircle decides, no
// centerInGoalX gate — an earlier x-only gate let a puck slip through a post it was still
// overlapping, since the post sits exactly at the gate's own threshold), and the flat wall's own
// reach is separately widened to step back from a post's full combined-radius reach (see
// physics.ts's nearPostX), so a post's whole round shape governs consistently across its actual
// reach rather than being partly shadowed by the flat wall or an x-only gate. A puck whose center
// is still outside the true goal opening (missed the net) can still clip a post on the way past.
// Player 1 always defends the bottom goal (see faceoffZoneCenters below), so the bottom pair is
// colored for player 1 and the top pair for player 2 — Board.tsx reads GoalPost.player to match
// each post to its own goal's crease/line color rather than the neutral wall color every other
// obstacle gets.
function buildGoalPosts(x: number, y: number, width: number, height: number, puckRadius: number, puckSize: PuckSizeLevel): GoalPost[] {
  const goalWidth = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
  const goalAbsLeft = x + (width - goalWidth) / 2
  const goalAbsRight = goalAbsLeft + goalWidth
  const radius = puckRadius * WALL_POST_RADIUS_RATIO
  return [
    { x: goalAbsLeft, y: y, radius, player: 2 },
    { x: goalAbsRight, y: y, radius, player: 2 },
    { x: goalAbsLeft, y: y + height, radius, player: 1 },
    { x: goalAbsRight, y: y + height, radius, player: 1 }
  ]
}

// Wall posts: decorative round pegs capping each divider/gauntlet-wall gap's edges, built for
// every variant and mode, including rink (see computeBoardLayout's wallPosts field). Purely
// visual — the corresponding Obstacle rect's own corner already collides correctly at this exact point
// (rect-vs-circle collision clamps to the rect's nearest point, which IS the gap-edge corner), so
// this carries no `player` field and needs no physics.ts changes — see WallPost's own comment in
// types/index.ts.
//
// Deliberately its own function, recomputing the same hole-edge x-coordinates buildObstacles
// derives rather than sharing them — same "independent sibling function" precedent buildGoalPosts
// already sets. Sits on each wall's fixed centerline (y + height * frac, e.g. y + height/2 for
// classic) — the same centerline regardless of wt, matching the "wall's centerline is fixed even
// as wt shrinks" property buildObstacles' own wallY formula already has, so a wall post never
// visually shifts between rink on/off.
function buildWallPosts(variant: BoardVariant, x: number, y: number, width: number, height: number, puckRadius: number, puckSize: PuckSizeLevel): WallPost[] {
  const holeW = puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize]
  const radius = puckRadius * WALL_POST_RADIUS_RATIO
  const centerX = x + width / 2
  const holeOffset = width * 0.3 // matches buildObstacles' classic/gauntlet outerOffset

  function postsForHole(holeCX: number, wallCenterY: number): WallPost[] {
    return [
      { x: holeCX - holeW / 2, y: wallCenterY, radius },
      { x: holeCX + holeW / 2, y: wallCenterY, radius }
    ]
  }

  switch (variant) {
    case 'classic': {
      const wallCenterY = y + height / 2
      return [...postsForHole(centerX - holeOffset, wallCenterY), ...postsForHole(centerX + holeOffset, wallCenterY)]
    }
    case 'gauntlet': {
      const topY = y + height * 0.25
      const midY = y + height * 0.5
      const botY = y + height * 0.75
      return [
        ...postsForHole(centerX - holeOffset, topY),
        ...postsForHole(centerX + holeOffset, topY),
        ...postsForHole(centerX, midY),
        ...postsForHole(centerX - holeOffset, botY),
        ...postsForHole(centerX + holeOffset, botY)
      ]
    }
    case 'gravity':
      // Same center divider as 'classic' — see buildObstacles' identical recursion.
      return buildWallPosts('classic', x, y, width, height, puckRadius, puckSize)
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

export function computeBoardLayout(screenWidth: number, screenHeight: number, insets: EdgeInsets, variant: BoardVariant = 'classic', puckSize: PuckSizeLevel = 'medium', rink: boolean = false): BoardLayout {
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

  // GameSettings.rink only: extends the TRUE collision boundary behind each goal (rounded corners
  // + a behind-the-net pocket — see physics.ts's boardCornerQuadrant/circleVsRoundedCorner) while
  // keeping x/y/width/height below meaning exactly what they mean when rink is off: the
  // front-line-to-front-line playing rectangle that faceoffZoneCenters, aiOpponent.ts's targeting,
  // faceoff.ts, and every crease/zone-line render in Board.tsx already assume — none of those need
  // to change when rink is toggled. The goal's own back wall isn't a separate Obstacle here — the
  // goalposts (built unconditionally, see buildGoalPosts) plus the permeable/solid outer-wall
  // switch in physics.ts (skipGoalGap) are what actually govern the goal mouth in both states.
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
  //
  // Also floored at insets.top/insets.bottom (not just the puck-diameter minimum above) — per
  // explicit feedback, the pocket should reach all the way to the physical screen edge on both
  // ends, not stop at some small fixed depth. Since topBorrow/bottomBorrow below each cap at
  // min(behindGoalDepth, their own inset), flooring depth at max(both insets) is what actually lets
  // BOTH borrows hit their own full inset simultaneously — anything less and the shorter inset
  // would've been the one under-using its own space. The one cost: fieldHeight only recovers
  // topBorrow+bottomBorrow while still subtracting 2×behindGoalDepth (see below), so when the two
  // insets differ (a notch vs. a home indicator, say) the smaller side doesn't fully cancel out —
  // a small, unavoidable trade for genuinely reaching both edges rather than neither.
  const behindGoalDepth = rink ? Math.max(puckRadius * 2.5 + WALL_THICKNESS, insets.top, insets.bottom) : 0
  // Purely a visual/physical corner-rounding radius now — see physics.ts's boardCornerQuadrant
  // and the "outside the corner and the goal, the true wall sits at outerTop/outerBottom" fix
  // there. Earlier this had to be >= behindGoalDepth because the flat wall stayed at the FRONT
  // line (board.y) everywhere except this one small notch, so the notch's own arc was the ONLY
  // path into the pocket at all, and had to reach all the way back on its own. Now that the flat
  // wall itself sits at the true outer boundary for the whole width outside the corners, the arc
  // only has to round off the literal 4 corners — a modest, fixed proportion of board width reads
  // better visually than the old dramatic curve did. No longer drawn in normal play either (see
  // rinkPerimeterPath's own comment in Board.tsx) — this radius now only shapes the actual
  // collision boundary, so a puck banking into a corner still feels rounded even with nothing
  // drawn there to show it.
  const cornerRadius = rink ? width * 0.12 : 0

  // See BoardLayout's own doc comment — only gauntlet's wall positions force this off the
  // default.
  const faceoffOffsetYRatio = variant === 'gauntlet' ? 0.3 : 0.42

  // GameSettings.rink only (0 when it's off, since behindGoalDepth is 0 there): rather than shrink
  // the front-line field by the full behindGoalDepth at both ends, borrow from the safe-area
  // insets first — that space (status bar/notch at top, home indicator at bottom) is otherwise
  // just empty background today. Capped at insets.top/insets.bottom themselves (can't borrow more
  // than actually exists there); whatever's left over after borrowing still shrinks the field, so
  // this degrades gracefully on devices with small/no insets (old iPhones, Android) rather than
  // assuming the room is always there. See boardMarginTop's own doc comment on BoardLayout for how
  // this reaches the screen container itself.
  const topBorrow = Math.min(behindGoalDepth, insets.top)
  const bottomBorrow = Math.min(behindGoalDepth, insets.bottom)
  const boardMarginTop = insets.top - topBorrow

  // y itself does NOT need to account for topBorrow — moving the screen container's own origin
  // up by topBorrow (via boardMarginTop) already achieves the visual effect entirely on its own;
  // this stays the exact same "front line sits behindGoalDepth past the outer edge" formula every
  // variant already uses. Only fieldHeight changes: it grows back by however much was borrowed at
  // each end, on top of the plain "shrink by 2×behindGoalDepth" every variant already computes.
  const y = outerY + behindGoalDepth
  const fieldHeight = height - behindGoalDepth * 2 + topBorrow + bottomBorrow

  // Always as thin as the goal line itself (GOAL_LINE_STROKE_WIDTH) — same constant Board.tsx's
  // goal-line <Line> strokeWidth reads, so the two stay equal by construction, in every mode
  // including rink (per explicit correction: this isn't rink-conditional, it applies everywhere).
  // Feeds BOTH the returned wallThickness field below and buildObstacles' wt param from this
  // single value — never let those two diverge (see boardGeometry.test.ts's "3 walls sit at
  // y-fractions..." test, which reads board.wallThickness dynamically to derive wall-segment
  // boundaries). WALL_THICKNESS itself still backs boardMargin and the behindGoalDepth clearance
  // formula below — both physical/layout concerns unrelated to this rendered/collided thickness.
  const wallThickness = GOAL_LINE_STROKE_WIDTH

  return {
    x,
    y,
    width,
    height: fieldHeight,
    wallThickness,
    goalWidth,
    goalLeft,
    goalRight,
    puckRadius,
    centerX: x + width / 2,
    centerY: y + fieldHeight / 2,
    obstacles: buildObstacles(variant, x, y, width, fieldHeight, wallThickness, puckRadius, puckSize),
    gravityWells: buildGravityWells(variant, x, y, width, fieldHeight, puckRadius, puckSize),
    goalPosts: buildGoalPosts(x, y, width, fieldHeight, puckRadius, puckSize),
    // Built for every variant/mode, including rink — see WallPost's own comment in types/index.ts
    // and buildWallPosts above.
    wallPosts: buildWallPosts(variant, x, y, width, fieldHeight, puckRadius, puckSize),
    cornerRadius,
    behindGoalDepth,
    faceoffOffsetYRatio,
    boardMarginTop
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
  const offsetY = (board.height / 2) * board.faceoffOffsetYRatio
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
