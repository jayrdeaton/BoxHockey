import { computeAimVector as computeSharedAimVector } from '@tastic/input'
import { applyFriction, applyGravityWells, boardCornerQuadrant, circleVsCircle as sharedCircleVsCircle, circleVsRect as sharedCircleVsRect, circleVsRoundedCorner, reflectOffNormal } from '@tastic/physics'

import { FRICTION_LEVELS, GRAVITY_WELL_MIN_DIST, MAX_SPEED, STOP_THRESHOLD, WALL_RESTITUTION } from '@/constants/game'
import { BoardLayout, GravityWell, PuckState } from '@/types'

export interface PhysicsResult extends PuckState {
  scored: 1 | 2 | null
  stopped: boolean
  bounced: boolean
  enteredWell: 'attract' | 'repel' | null
  // Set only when this step's bounce was against the invisible one-way door at the goal mouth -
  // see the "Settings.rink only: a one-way door" collision block below. That door is what
  // stops a puck already behind the line from passing back OUT through the same gap it would
  // otherwise score through; visually that gap (between the posts, where the static goal-line
  // <Line>s deliberately stop) looks open, so this is the collision a player actually needs a cue
  // for. null for every other bounce, including the puck striking the TRUE far boundary deeper in
  // the pocket (a real collision, just not this one - nothing flashes there).
  goalDoorHit: 'top' | 'bottom' | null
}

// Localized attractor/repeller: force falls off quadratically to exactly 0 at
// well.radius (bounded, unlike inverse-square, so a dt-clamped frame hitch near
// a strong well can't blow up velocity in one step) and, by default, only applies
// while the puck's own momentum is still above STOP_THRESHOLD - without that gate, a
// strong-enough well would hold the puck in a friction/force equilibrium above
// the stop threshold forever, softlocking the game in 'simulating'. A well with
// activeAtRest set bypasses that gate - for wells whose entire purpose is to evict an
// already-stopped puck (e.g. gravity's corner repellers) rather than hold one at
// an equilibrium, so the softlock risk the gate exists for doesn't apply to them.
export function applyGravityWellForces(x: number, y: number, vx: number, vy: number, wells: GravityWell[], dt: number): { vx: number; vy: number } {
  const result = applyGravityWells(
    { x, y },
    { x: vx, y: vy },
    wells.map((well) => ({ center: { x: well.x, y: well.y }, radius: well.radius, strength: well.strength, activeAtRest: well.activeAtRest })),
    dt,
    { stopThreshold: STOP_THRESHOLD, maxSpeed: MAX_SPEED, minDistance: GRAVITY_WELL_MIN_DIST }
  )
  return { vx: result.x, vy: result.y }
}

// Edge-triggered "just crossed into a well's influence radius" - compares the
// puck's distance to each well before vs. after this step, the same way wall/
// obstacle `bounced` is detected inline, so no "was inside last frame" state
// needs to live anywhere else.
function detectWellEntry(x0: number, y0: number, x: number, y: number, wells: GravityWell[]): 'attract' | 'repel' | null {
  for (const well of wells) {
    const distBefore = Math.hypot(well.x - x0, well.y - y0)
    const distAfter = Math.hypot(well.x - x, well.y - y)
    if (distBefore >= well.radius && distAfter < well.radius) {
      return well.strength >= 0 ? 'attract' : 'repel'
    }
  }
  return null
}

export interface TrajectoryPoint {
  x: number
  y: number
}

export function circleVsRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): { hit: boolean; nx: number; ny: number; depth: number } {
  const nearX = Math.max(rx, Math.min(cx, rx + rw))
  const nearY = Math.max(ry, Math.min(cy, ry + rh))
  const dx = cx - nearX
  const dy = cy - nearY
  const distSq = dx * dx + dy * dy
  if (distSq >= r * r) return { hit: false, nx: 0, ny: 0, depth: 0 }
  const dist = Math.sqrt(distSq)
  const nx = dist < 0.001 ? 0 : dx / dist
  const ny = dist < 0.001 ? -1 : dy / dist
  return { hit: true, nx, ny, depth: r - dist }
}

// Convex circle-vs-circle collision - used for the goalposts every variant builds (see GoalPost in
// types/index.ts). Same nx/ny convention as circleVsRect above (outward from the solid, into the
// puck's own free space), so it plugs into the identical dot < 0 reflection check both stepPhysics
// and computeTrajectory already use for obstacles.
export function circleVsCircle(cx: number, cy: number, r: number, ox: number, oy: number, oRadius: number): { hit: boolean; nx: number; ny: number; depth: number } {
  const dx = cx - ox
  const dy = cy - oy
  const dist = Math.hypot(dx, dy)
  const combined = r + oRadius
  if (dist >= combined) return { hit: false, nx: 0, ny: 0, depth: 0 }
  const nx = dist < 0.001 ? 0 : dx / dist
  const ny = dist < 0.001 ? -1 : dy / dist
  return { hit: true, nx, ny, depth: combined - dist }
}

function stepPhysicsOnce(puck: PuckState, board: BoardLayout, dt: number, friction: number): PhysicsResult {
  let { x, y, vx, vy } = puck
  const x0 = puck.x
  const y0 = puck.y

  const r = board.puckRadius
  const goalAbsLeft = board.x + board.goalLeft
  const goalAbsRight = board.x + board.goalRight
  // Regression guard: a puck already mid-crossing the front line at the START of this frame
  // (leading edge already past board.y/board.y+height, trailing edge not yet - scoring requires
  // FULL clearance, by design, so this is a real, reachable in-between state) skips friction this
  // frame instead of decaying normally. Without this, a puck that entered the goal mouth with only
  // modest speed (an ordinary soft shot, or one that lost speed to an earlier bank/post/well
  // interaction) could decay below STOP_THRESHOLD before its trailing edge ever cleared the line -
  // at which point nothing else acts on it there either (the flat wall is deliberately disabled
  // for the whole corridor once centerInGoalX is true, so a clean shot isn't stopped by its own
  // goal line), so it would simply sit there forever: not scored (body not fully through) and not
  // bounced back out. A real playtesting bug ("puck goes in the goal but doesn't score"), found via
  // an adversarial sweep after the goalpost/wall reordering fix above - confirmed reproducible
  // across every variant/puckSize even from a perfectly ordinary shot speed, not just a weak dribble
  // or a post-deflection edge case. Skipping friction (rather than merely exempting the `stopped`
  // check) is what actually guarantees eventual full clearance: a friction-decayed approach travels
  // a bounded total distance (a geometric series), which can be LESS than the remaining gap to full
  // clearance even given unlimited frames - holding speed constant instead covers that bounded,
  // sub-puck-diameter remaining gap in a bounded number of frames as long as speed is nonzero, which
  // it must be to have reached this leading-edge-past state in the first place.
  const centerInGoalX0 = x0 > goalAbsLeft && x0 < goalAbsRight
  const midCrossing = centerInGoalX0 && ((y0 - r < board.y && y0 + r >= board.y) || (y0 + r > board.y + board.height && y0 - r <= board.y + board.height))

  if (!midCrossing) {
    const frictioned = applyFriction({ x: vx, y: vy }, friction, dt)
    vx = frictioned.x
    vy = frictioned.y
  }

  const wellForce = applyGravityWellForces(x, y, vx, vy, board.gravityWells, dt)
  vx = wellForce.vx
  vy = wellForce.vy

  x += vx * dt
  y += vy * dt

  // Center-only, deliberately lenient (vs. a full-body-clearance test): "within the goal's own
  // x-range" for every purpose that cares about it below - the flat-wall skip (see the goal-mouth
  // wall check below), the score check, the goalpost collision gate ("went through the posts"
  // means the puck's own mass passed between them, not that it cleared them with a full
  // puck-radius of margin to spare), and the rink pocket's one-way door (see wasBehindTop/
  // wasBehindBottom below) - that door used to gate on a stricter full-body test, which left a real
  // gap a retreating puck could sneak out through; see its own comment for the fix.
  const centerInGoalX = x > goalAbsLeft && x < goalAbsRight
  let bounced = false
  let goalDoorHit: 'top' | 'bottom' | null = null

  // Hoisted up from right before the two return statements that use them, below - a clean,
  // already-fully-cleared score (see the early-return check right after this) needs them before the
  // collision block runs at all, not after.
  const wasBehindTop = y0 + r < board.y
  const wasBehindBottom = y0 - r > board.y + board.height

  // A puck that has ALREADY fully cleared the line this frame - BEFORE any corner/goalpost/wall
  // correction below ever touches it - is an unambiguous, already-complete score: return
  // immediately rather than risk a goalpost correction (see its own comment below on why it no
  // longer gates on centerInGoalX at all) nudging the position back and un-scoring a puck that had
  // already made it all the way through. This is a real, reachable case, not a defensive
  // hypothetical: a puck's trailing edge only needs to clear the line by its OWN radius to satisfy
  // "fully cleared" (y + r < board.y), and a goalpost's own collision radius is puckRadius +
  // postRadius - strictly LARGER than puckRadius alone - so a puck can be both fully cleared and
  // still within a post's collision distance at the same time.
  if (centerInGoalX && y + r < board.y && !wasBehindTop) return { x, y, vx, vy, scored: 1, stopped: false, bounced: false, enteredWell: null, goalDoorHit: null }
  if (centerInGoalX && y - r > board.y + board.height && !wasBehindBottom) return { x, y, vx, vy, scored: 2, stopped: false, bounced: false, enteredWell: null, goalDoorHit: null }

  // Settings.rink only (board.cornerRadius === 0 when it's off, so this is always null then): near
  // one of the 4 rounded outer corners, a single concave arc check replaces BOTH the flat
  // top/bottom and left/right wall checks below for this frame - this is also what opens the
  // wraparound path behind the goal, since within a corner's quadrant the flat front-wall check
  // (which would otherwise seal board.y everywhere outside the goal gap) simply doesn't run.
  const corner = boardCornerQuadrant(x, y, board)
  if (corner) {
    const col = circleVsRoundedCorner(x, y, r, corner.arcCenterX, corner.arcCenterY, board.cornerRadius)
    if (col.hit) {
      x = col.x
      y = col.y
      // col.nx/ny point OUTWARD from the arc center (toward the wall, away from the playable ice
      // - see circleVsRoundedCorner's own comment), so a puck driving further into the wall has a
      // velocity component ALONG that direction: dot > 0 is the case to remove/reflect. (dot < 0
      // here previously never fired for a puck actually approaching the corner - it stayed
      // clamped to the same arc point frame after frame with its into-the-wall velocity untouched,
      // reading as "stuck" rather than banking off the curve.)
      const dot = vx * col.nx + vy * col.ny
      if (dot > 0) {
        vx -= (1 + WALL_RESTITUTION) * dot * col.nx
        vy -= (1 + WALL_RESTITUTION) * dot * col.ny
      }
      bounced = true
    }
  } else {
    // Built for every variant now (see buildGoalPosts in utils/board.ts) - checked BEFORE the flat
    // wall below, not after (see the flat wall's own comment for why), and NOT gated on
    // centerInGoalX at all anymore - a real, reproducible bug (found via live playtesting, not just
    // the earlier adversarial sweep) turned up once posts became universal: since a post sits
    // EXACTLY at the corridor's own boundary (post.x === goalAbsLeft or goalAbsRight), an angled
    // approach's x-coordinate can tick past that exact threshold - flipping centerInGoalX true -
    // while the puck's CENTER is still sitting almost exactly on top of the post (well within
    // combined-radius distance vertically), and the old `if (!centerInGoalX)` gate would disable
    // the check at exactly that moment, letting the puck sail through a post it was still
    // overlapping with zero deflection. circleVsCircle's own distance test is what should decide
    // this, not a same-threshold x-only proxy for it: a puck genuinely centered well inside the
    // corridor (more than combined-radius from either post) was never going to overlap a post
    // anyway, gate or no gate, so removing the gate doesn't reopen the old "narrow corridor" problem
    // - it only changes behavior for shots that come close enough to a post to actually matter,
    // which is exactly the case that should still clang off it. The one thing this DOES require
    // protecting against - a puck that's already fully, legitimately scored this frame getting its
    // clearance undone by a lingering post correction - is handled by the early return above, which
    // runs before this loop ever gets a chance to touch a puck that's already cleanly through.
    let postHit = false
    for (const post of board.goalPosts) {
      // A puck already fully behind THIS post's own goal line (see wasBehindTop/wasBehindBottom's
      // own comment) is deep in the pocket, not approaching the goal mouth from the playable side
      // - real hockey posts don't extend backward into the net, so they shouldn't still deflect a
      // puck poking at them from behind. Gated per-post (not globally) since a puck can be behind
      // ONE goal's line while still approaching the OTHER goal's posts normally.
      if ((post.player === 2 && wasBehindTop) || (post.player === 1 && wasBehindBottom)) continue
      const col = sharedCircleVsCircle({ position: { x, y }, radius: r }, { position: { x: post.x, y: post.y }, radius: post.radius })
      if (col.hit) {
        x += col.normal.x * col.depth
        y += col.normal.y * col.depth
        const reflected = reflectOffNormal({ x: vx, y: vy }, col.normal, WALL_RESTITUTION)
        vx = reflected.x
        vy = reflected.y
        bounced = true
        postHit = true
      }
    }

    // The TRUE outer boundary - board.y/board.height when Settings.rink is off
    // (behindGoalDepth === 0 there), or behindGoalDepth further back when it's on. Either way the
    // gap in this flat wall is governed by centerInGoalX (the same center-only threshold the score
    // check and the goalpost check above use) rather than a wider, full-body-clearance opening: the
    // posts (buildGoalPosts, built unconditionally for every variant) are what actually make a
    // wide-angle approach to the goal mouth feel fair, so this flat wall only needs to get out of
    // their way once the puck's own center has genuinely entered the true goal opening, not before.
    // When rink is on, skipGoalGap additionally makes this wall solid across the FULL width outside
    // the corners, including at the goal mouth itself - real hockey boards are one continuous,
    // unbroken curve, and the goal is a SLOT (a scoring position, not a wall opening - see the
    // score check below), so a puck can freely sail past board.y there and only meets this same
    // solid curve further back, at the true outer boundary, rather than a boxy net cut into it.
    // When rink is off there's no pocket to skip into, so centerInGoalX alone determines the
    // gap - the goal line is "permeable": solid wall outside the true goal opening, nothing at all
    // within it (no depth behind to travel into, so clearing the threshold scores immediately).
    const skipGoalGap = board.behindGoalDepth > 0
    const outerTop = board.y - board.behindGoalDepth
    const outerBottom = board.y + board.height + board.behindGoalDepth
    // Widens the near-line wall's own permeable zone in X to also exclude any post's real reach -
    // a second, distinct fix beyond postHit above. postHit only makes the post win when BOTH it and
    // the wall would fire on the exact same frame; it doesn't stop the wall's OWN trigger (a flat
    // line at board.y ± puckRadius, independent of how far x is from a post, as long as x is outside
    // the narrow true corridor) from firing EARLIER than the post's circular reach would, at
    // moderate offsets. The post's max reach in x is puckRadius + postRadius, but it only gets that
    // full reach exactly at the post's own y - everywhere else its remaining reach shrinks (a
    // circle), while the wall's reach stays a constant puckRadius regardless of x. That means for any
    // x-offset roughly between 0.63x and 1x the post's own combined radius, the wall's fixed reach
    // exceeds the post's shrunken reach at that offset, so the wall fires first - a flat, straight
    // bounce standing in for what should be the post's own round shape (found via live playtesting:
    // "the wall shouldn't even extend to under the post"). Only matters when skipGoalGap is false -
    // the far wall skipGoalGap gates (rink on) sits well behind any post's actual y, nowhere near a
    // post's reach in practice, and this check is pure x, so it must stay scoped to the near-line
    // case specifically or it could wrongly suppress that legitimate, unrelated far boundary too.
    const nearPostX = !skipGoalGap && board.goalPosts.some((post) => Math.abs(x - post.x) < r + post.radius)
    if (!postHit && y - r < outerTop && (skipGoalGap || (!centerInGoalX && !nearPostX))) {
      y = outerTop + r
      vy = Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }

    if (!postHit && y + r > outerBottom && (skipGoalGap || (!centerInGoalX && !nearPostX))) {
      y = outerBottom - r
      vy = -Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }
  }

  // wasBehindTop/wasBehindBottom (hoisted above, alongside the early clean-score return) are what
  // guard the score check below against a puck reaching the goal from BEHIND (wrapped around via a
  // corner, only reachable when Settings.rink is on) - that must never score, that's where the
  // net is, even though nothing is physically rendered there. Only a FRESH crossing (wasn't already
  // fully behind a moment ago) counts. With rink off this is a no-op: the only way to ever get y0
  // already past the line there is by having already scored the instant it happened, so a live puck
  // can never start a step already in that state.

  // Settings.rink only: a one-way door at the goal mouth. Open front-to-back - entering (whether it
  // scores on a fresh crossing or continues past into the pocket) is always unobstructed - but
  // solid back-to-front within the goal's own x-range specifically: a puck that's already behind
  // the line and drifts into the goal's x-range (e.g. wandering over from the wider pocket via a
  // corner) can't just pass back out through the same slot it would otherwise score through. The
  // wider pocket OUTSIDE the goal's x-range has no such restriction - wraparound travel via the
  // corners stays open in both directions; this guards only the goal mouth itself. The two posts
  // (buildGoalPosts) sit right at this same x-range's edges but don't replace this door - they stop
  // a wide-angle approach from sliding in sideways from the open boards, not a puck already behind
  // the net finding its way to this exact slot.
  // Clamped a hair past the exact line (not flush to it) - landing exactly at y0+r === board.y
  // would make wasBehindTop's own strict "<" comparison false on the VERY NEXT step (still
  // pushed-back, moving away, but no longer counted as "was behind"), which let a puck that
  // just bounced off this door immediately satisfy the score condition's !wasBehindTop check
  // while still moving in the wrong direction - a real bug caught by boardGeometry.test.ts.
  // Gated on centerInGoalX, NOT inGoalX (full-body containment) - inGoalX is strictly narrower
  // (requires the puck's edge, not just its center, inside the corridor), and a puck retreating
  // from the pocket at an angle can cross the front line with its CENTER inside the goal's own
  // x-range but its edge already overlapping a post's x-line, where inGoalX is false. The
  // goalpost's own circular collision (radius puckRadius*0.18, centered exactly at (post.x,
  // board.y) - see buildGoalPosts) doesn't reliably cover that gap either: at the moment this
  // door-check condition first becomes true (y + r just reaching board.y), the puck's CENTER is
  // still a full puckRadius short of the post's own y - combined with an x-offset near the inGoalX
  // threshold, the puck-to-post distance can exceed their combined radius (r + 0.18r), so neither
  // check catches it and the puck sails back out through the goal mouth it just came from - a
  // real, reproducible escape matching the "puck comes out of the goal from behind it" bug report.
  // Scoring's own early-return check above already uses centerInGoalX as "the goal's x-range", so
  // this door - meant to be the back-to-front-solid counterpart of that same range (see this
  // block's own comment above) - has to use the same, wider test to stay consistent with it.
  const DOOR_CLAMP_MARGIN = 1
  if (board.behindGoalDepth > 0 && centerInGoalX && wasBehindTop && y + r >= board.y) {
    y = board.y - r - DOOR_CLAMP_MARGIN
    vy = -Math.abs(vy) * WALL_RESTITUTION
    bounced = true
    goalDoorHit = 'top'
  }
  if (board.behindGoalDepth > 0 && centerInGoalX && wasBehindBottom && y - r <= board.y + board.height) {
    y = board.y + board.height + r + DOOR_CLAMP_MARGIN
    vy = Math.abs(vy) * WALL_RESTITUTION
    bounced = true
    goalDoorHit = 'bottom'
  }

  // Same check as the early return above, run again here: the one-way door just above can push a
  // puck that was behind the line back toward (or past) it, which the early check - evaluated
  // before the whole collision block ran - couldn't have seen yet.
  if (centerInGoalX && y + r < board.y && !wasBehindTop) return { x, y, vx, vy, scored: 1, stopped: false, bounced: false, enteredWell: null, goalDoorHit: null }
  if (centerInGoalX && y - r > board.y + board.height && !wasBehindBottom) return { x, y, vx, vy, scored: 2, stopped: false, bounced: false, enteredWell: null, goalDoorHit: null }

  if (!corner) {
    if (x - r < board.x) {
      x = board.x + r
      vx = Math.abs(vx) * WALL_RESTITUTION
      bounced = true
    }
    if (x + r > board.x + board.width) {
      x = board.x + board.width - r
      vx = -Math.abs(vx) * WALL_RESTITUTION
      bounced = true
    }
  }

  for (const obs of board.obstacles) {
    const col = sharedCircleVsRect({ position: { x, y }, radius: r }, obs)
    if (col.hit) {
      x += col.normal.x * col.depth
      y += col.normal.y * col.depth
      const reflected = reflectOffNormal({ x: vx, y: vy }, col.normal, WALL_RESTITUTION)
      vx = reflected.x
      vy = reflected.y
      bounced = true
    }
  }

  const stopped = Math.abs(vx) < STOP_THRESHOLD && Math.abs(vy) < STOP_THRESHOLD
  const enteredWell = detectWellEntry(x0, y0, x, y, board.gravityWells)
  return { x, y, vx, vy, scored: null, stopped, bounced, enteredWell, goalDoorHit }
}

// How far a single stepPhysicsOnce call is allowed to move the puck before sub-stepping kicks in
// - see stepPhysics' own comment for why this exists at all. A first pass at 0.5×puckRadius closed
// the vast majority of the tunneling bug (an empirical sweep this file's own commit history covers
// went from a ~4-5% miss rate down to ~0.36%) but left a thin residual: even with substeps, there's
// always SOME discrete sample nearest to the true moment a puck's center crosses goalAbsLeft/Right,
// and 0.5×puckRadius was still coarse enough, relative to a goalpost's own small radius, for a
// trajectory drifting almost exactly along that boundary to occasionally get sampled a hair on the
// wrong side of it right as the line-crossing also resolves. Tightened well below the smallest
// features these checks need to catch cleanly (a goalpost's radius, itself already a fraction of
// puckRadius - see buildGoalPosts in utils/board.ts) rather than bounded by puckRadius itself. This
// can't drive the miss window to literally zero (that's a property of ANY discrete sampling of a
// continuous crossing, not something a finite substep count can fully eliminate) but shrinks it far
// enough that a real trajectory would need to align with the boundary to a small fraction of a
// pixel to still slip through - no longer something a player can produce by aiming "through the
// posts" in any normal sense. Still cheap: this is plain arithmetic, once per RAF frame.
const SUBSTEP_MAX_DISPLACEMENT_RATIO = 0.15
// Safety valve against a pathological velocity/dt combination looping unreasonably - ordinary play
// doesn't get close to this. At MAX_SPEED and the real dt clamp of 2.5, the tightened ratio above
// needs on the order of 15-20 substeps, comfortably under this cap.
const SUBSTEP_MAX_COUNT = 30

// The puck entering (or nearly entering) a goal is a genuinely thin target - see stepPhysicsOnce's
// own score-check/one-way-door comments for the geometry. stepPhysicsOnce only samples collisions
// at its END position, once per call: a single oversized step (real gameplay dt is clamped to 2.5
// in useGameState.ts's RAF loop, not always ~1 - any frame hitch worse than ~42ms produces it) can
// carry a fast puck's position from clearly in front of the goal line to well past the ENTIRE
// behind-goal pocket in one call, tripping the unconditional true-outer-wall clamp before the score
// check ever runs, while ALSO drifting sideways enough in that same step to land just outside the
// goal's own x-range by the time it's sampled - so a shot that would cleanly score under finer
// timing instead silently bounces off the back wall and is then permanently barred from scoring by
// the one-way door's wasBehindTop/Bottom guard (a fresh crossing never happened, as far as that
// state can tell). Splitting a large step into several smaller stepPhysicsOnce calls closes this
// without touching any of the delicate goal/door/post logic itself - it just guarantees none of
// those checks are ever asked to evaluate a jump bigger than the gaps they're built to catch.
// Friction composes cleanly across the split (frictionFactor = friction^dt, and
// friction^(dt/n) raised to the n-th power is exactly friction^dt again), so an ordinary
// non-tunneling frame behaves identically to before, just resolved in finer-grained steps.
export function stepPhysics(puck: PuckState, board: BoardLayout, dt = 1, friction: number = FRICTION_LEVELS.medium): PhysicsResult {
  const speed = Math.hypot(puck.vx, puck.vy)
  const safeMaxDisplacement = board.puckRadius * SUBSTEP_MAX_DISPLACEMENT_RATIO
  const substeps = speed * dt > safeMaxDisplacement ? Math.min(SUBSTEP_MAX_COUNT, Math.ceil((speed * dt) / safeMaxDisplacement)) : 1
  if (substeps <= 1) return stepPhysicsOnce(puck, board, dt, friction)

  const subDt = dt / substeps
  let current = puck
  let anyBounced = false
  let lastEnteredWell: 'attract' | 'repel' | null = null
  let lastGoalDoorHit: 'top' | 'bottom' | null = null
  for (let i = 0; i < substeps; i++) {
    const result = stepPhysicsOnce(current, board, subDt, friction)
    anyBounced = anyBounced || result.bounced
    lastEnteredWell = result.enteredWell ?? lastEnteredWell
    lastGoalDoorHit = result.goalDoorHit ?? lastGoalDoorHit
    // A score or a stop is final - stop sub-stepping immediately rather than continuing to
    // integrate a puck that's already been removed from play (or come to rest) this frame.
    if (result.scored !== null || result.stopped) return { ...result, bounced: anyBounced, enteredWell: lastEnteredWell, goalDoorHit: lastGoalDoorHit }
    current = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
  }
  return { ...current, scored: null, stopped: false, bounced: anyBounced, enteredWell: lastEnteredWell, goalDoorHit: lastGoalDoorHit }
}

export function computeAimVector(dragDx: number, dragDy: number, maxDragPixels: number, maxSpeed: number): { vx: number; vy: number; power: number } {
  const { velocity, power } = computeSharedAimVector({ x: dragDx, y: dragDy }, maxDragPixels, maxSpeed)
  return { vx: velocity.x, vy: velocity.y, power }
}

// Simulate puck trajectory from current position given a drag direction.
// Returns waypoints: start + each bounce contact + final position.
// Straight segments between waypoints represent the actual path (friction is
// light enough that curvature is negligible between bounces).
// `friction` defaults to FRICTION_LEVELS.medium (matching stepPhysics' own default) - previously
// hardcoded to a fixed 0.993 regardless of the round's actual friction setting, which is CLOSER TO
// but not equal to 'low' (0.992) and meaningfully higher (less decel) than 'medium' (0.986) or
// 'high' (0.976). Over several frames that gap compounds into a real speed mismatch at the moment
// of contact with anything downstream, which is part of what made a bounce prediction - a post's
// small collision radius especially - land at a visibly different point/angle than the real shot.
export function computeTrajectory(startX: number, startY: number, dragDx: number, dragDy: number, board: BoardLayout, maxDragPixels: number, maxSpeed: number, maxBounces = 5, friction: number = FRICTION_LEVELS.medium): TrajectoryPoint[] {
  const { vx: initVx, vy: initVy } = computeAimVector(dragDx, dragDy, maxDragPixels, maxSpeed)
  if (initVx === 0 && initVy === 0) return []

  const r = board.puckRadius
  const goalAbsLeft = board.x + board.goalLeft
  const goalAbsRight = board.x + board.goalRight

  const points: TrajectoryPoint[] = [{ x: startX, y: startY }]
  let x = startX
  let y = startY
  let vx = initVx
  let vy = initVy
  let bounces = 0

  let hitMaxBounces = false
  for (let step = 0; step < 800 && !hitMaxBounces; step++) {
    // Mirrors stepPhysics' midCrossing friction exemption exactly - see its own comment.
    const centerInGoalX0 = x > goalAbsLeft && x < goalAbsRight
    const midCrossing = centerInGoalX0 && ((y - r < board.y && y + r >= board.y) || (y + r > board.y + board.height && y - r <= board.y + board.height))
    if (!midCrossing) {
      vx *= friction
      vy *= friction
    }
    const wellForce = applyGravityWellForces(x, y, vx, vy, board.gravityWells, 1)
    vx = wellForce.vx
    vy = wellForce.vy
    if (Math.sqrt(vx * vx + vy * vy) < 0.4) break

    // Splits this frame's movement into finer substeps so a fast-moving puck can't tunnel straight
    // past a small target - a goalpost above all, see stepPhysics' own SUBSTEP_MAX_DISPLACEMENT_
    // RATIO comment - between two sampled positions. Mirrors stepPhysics' own outer substep
    // wrapper: the substep COUNT is chosen once per frame off the frame's own speed, but each
    // substep below moves by whatever vx/vy IS AT THAT MOMENT (substeps), so a bounce partway
    // through a frame immediately shrinks/redirects every subsequent substep's own movement within
    // that same frame instead of only affecting the NEXT frame - the same reason a real shot can
    // reflect off a post at a materially different angle than this preview previously predicted,
    // since the preview used to sample collisions only once per frame at the FULL per-frame
    // displacement, easily clearing straight past a post's small collision radius in one jump.
    const frameSpeed = Math.sqrt(vx * vx + vy * vy)
    const safeMaxDisplacement = r * SUBSTEP_MAX_DISPLACEMENT_RATIO
    const substeps = frameSpeed > safeMaxDisplacement ? Math.min(SUBSTEP_MAX_COUNT, Math.ceil(frameSpeed / safeMaxDisplacement)) : 1

    for (let sub = 0; sub < substeps; sub++) {
      const yBefore = y
      x += vx / substeps
      y += vy / substeps

      let bounced = false
      // Mirrors stepPhysics' centerInGoalX exactly - see its own comment.
      const centerInGoalX = x > goalAbsLeft && x < goalAbsRight

      // Mirrors stepPhysics' hoisted wasBehindTop/wasBehindBottom + early clean-score return
      // exactly - see its own comment for why this has to run before the collision block, not after.
      const wasBehindTop = yBefore + r < board.y
      const wasBehindBottom = yBefore - r > board.y + board.height
      if (centerInGoalX && ((y + r < board.y && !wasBehindTop) || (y - r > board.y + board.height && !wasBehindBottom))) {
        points.push({ x, y })
        return points
      }

      // Mirrors stepPhysics' rounded-corner handling exactly (see boardCornerQuadrant's own doc
      // comment) - null/no-op whenever Settings.rink is off.
      const corner = boardCornerQuadrant(x, y, board)
      if (corner) {
        const col = circleVsRoundedCorner(x, y, r, corner.arcCenterX, corner.arcCenterY, board.cornerRadius)
        if (col.hit) {
          x = col.x
          y = col.y
          // Mirrors stepPhysics' corner reflection exactly, sign included - see its own comment.
          const dot = vx * col.nx + vy * col.ny
          if (dot > 0) {
            vx -= (1 + WALL_RESTITUTION) * dot * col.nx
            vy -= (1 + WALL_RESTITUTION) * dot * col.ny
          }
          bounced = true
        }
      } else {
        // Mirrors stepPhysics' goalpost-before-wall ordering exactly, and its NOT-gated-on-
        // centerInGoalX fix - see its own comment for why the old x-only gate let a puck slip
        // through a post it was still overlapping.
        let postHit = false
        for (const post of board.goalPosts) {
          // Mirrors stepPhysics' post-behind-the-line gate exactly - see its own comment.
          if ((post.player === 2 && wasBehindTop) || (post.player === 1 && wasBehindBottom)) continue
          const col = circleVsCircle(x, y, r, post.x, post.y, post.radius)
          if (col.hit) {
            x += col.nx * col.depth
            y += col.ny * col.depth
            const dot = vx * col.nx + vy * col.ny
            if (dot < 0) {
              vx -= (1 + WALL_RESTITUTION) * dot * col.nx
              vy -= (1 + WALL_RESTITUTION) * dot * col.ny
            }
            bounced = true
            postHit = true
          }
        }

        // Mirrors stepPhysics' outerTop/outerBottom fix exactly (including skipGoalGap and the
        // centerInGoalX-gated gap, and the nearPostX widening - see its own comment for why the
        // wall's own flat trigger needs to also step back from any post's real circular reach).
        const skipGoalGap = board.behindGoalDepth > 0
        const outerTop = board.y - board.behindGoalDepth
        const outerBottom = board.y + board.height + board.behindGoalDepth
        const nearPostX = !skipGoalGap && board.goalPosts.some((post) => Math.abs(x - post.x) < r + post.radius)
        if (!postHit && y - r < outerTop && (skipGoalGap || (!centerInGoalX && !nearPostX))) {
          y = outerTop + r
          vy = Math.abs(vy) * WALL_RESTITUTION
          bounced = true
        }
        if (!postHit && y + r > outerBottom && (skipGoalGap || (!centerInGoalX && !nearPostX))) {
          y = outerBottom - r
          vy = -Math.abs(vy) * WALL_RESTITUTION
          bounced = true
        }
      }

      // Mirrors stepPhysics' one-way goal-mouth door exactly, margin included - see its own comment
      // (gated on centerInGoalX, not the narrower full-body inGoalX, to close the escape gap).
      if (board.behindGoalDepth > 0 && centerInGoalX && wasBehindTop && y + r >= board.y) {
        y = board.y - r - 1
        vy = -Math.abs(vy) * WALL_RESTITUTION
        bounced = true
      }
      if (board.behindGoalDepth > 0 && centerInGoalX && wasBehindBottom && y - r <= board.y + board.height) {
        y = board.y + board.height + r + 1
        vy = Math.abs(vy) * WALL_RESTITUTION
        bounced = true
      }

      // Same check as the early return above, run again here (mirrors stepPhysics exactly): the
      // one-way door just above can push a puck that was behind the line back toward (or past) it,
      // which the early check - evaluated before the collision block ran - couldn't have seen yet.
      if (centerInGoalX && ((y + r < board.y && !wasBehindTop) || (y - r > board.y + board.height && !wasBehindBottom))) {
        points.push({ x, y })
        return points
      }
      if (!corner && x - r < board.x) {
        x = board.x + r
        vx = Math.abs(vx) * WALL_RESTITUTION
        bounced = true
      }
      if (!corner && x + r > board.x + board.width) {
        x = board.x + board.width - r
        vx = -Math.abs(vx) * WALL_RESTITUTION
        bounced = true
      }

      for (const obs of board.obstacles) {
        const col = circleVsRect(x, y, r, obs.x, obs.y, obs.width, obs.height)
        if (col.hit) {
          x += col.nx * col.depth
          y += col.ny * col.depth
          const dot = vx * col.nx + vy * col.ny
          if (dot < 0) {
            vx -= (1 + WALL_RESTITUTION) * dot * col.nx
            vy -= (1 + WALL_RESTITUTION) * dot * col.ny
          }
          bounced = true
        }
      }

      if (bounced) {
        points.push({ x, y })
        bounces++
        if (bounces >= maxBounces) {
          hitMaxBounces = true
          break
        }
      }
    }
  }

  points.push({ x, y })
  return points
}
