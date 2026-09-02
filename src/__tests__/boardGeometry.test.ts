import { FRICTION_LEVELS, GOAL_LINE_STROKE_WIDTH, MAX_SPEED, WALL_POST_RADIUS_RATIO } from '@/constants/game'
import { BoardVariant, PuckSizeLevel } from '@/types'
import { computeBoardLayout, faceoffZoneCenters, faceoffZoneRadius } from '@/utils/board'
import { circleVsRect, computeTrajectory, stepPhysics } from '@/utils/physics'

// Integration coverage for computeBoardLayout + stepPhysics together, using the REAL layout
// geometry — unlike physics.test.ts/aiOpponent.test.ts, which construct a synthetic BoardLayout
// fixture by hand and so never exercise goalWidth/puckRadius's actual derivation. That gap is
// exactly what let a real regression through this session: goalWidth was briefly
// `puckRadius * 3`, which left only half a puck radius of aiming slop per side to clear the goal
// (stepPhysics requires the puck's whole diameter inside goalLeft/goalRight, not just its
// center) — tight enough that even a well-aimed "clear" shot would clip the goal line instead of
// scoring. See DIVIDER_HOLE_TO_PUCK_RADIUS's comment in constants/game.ts.
const insets = { top: 0, bottom: 0, left: 0, right: 0 }

function simulateToRest(puck: { x: number; y: number; vx: number; vy: number }, board: ReturnType<typeof computeBoardLayout>) {
  let p = puck
  for (let i = 0; i < 500; i++) {
    const result = stepPhysics(p, board, 1)
    p = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    if (result.scored !== null) return result.scored
    if (result.stopped) return null
  }
  return null
}

describe('computeBoardLayout goal geometry stays makeable', () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  // Started well past the center divider (0.75 of the way into the attacking zone, not at
  // board.centerY) — these tests are about the FAR GOAL's own opening margin (see the top-of-file
  // comment: "aiming slop ... to clear the goal"), not the separate divider-wall-hole mechanic,
  // which sits at centerY and would otherwise intercept a dead-center-ish shot before it ever
  // reached the geometry actually under test here. That collision used to go undetected — a
  // MAX_SPEED shot's single dt=1 step could tunnel clean through the divider's solid center panel
  // without stepPhysics ever sampling a position inside it — until stepPhysics started
  // sub-stepping large steps (see its own comment), which made that collision (correctly) start
  // registering and turned these into a test of "does it bounce off the divider", not "does it
  // clear the goal". Starting past the divider restores the original intent without relying on
  // the tunneling bug that used to paper over the wrong start position.
  const attackStartY = 0.75

  it.each(sizes)('a dead-center, full-speed shot from center ice scores at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'classic', size)
    const scored = simulateToRest({ x: board.centerX, y: board.y + board.height * attackStartY, vx: 0, vy: MAX_SPEED }, board)
    expect(scored).toBe(2)
  })

  it.each(sizes)('a shot half a puck radius off dead-center still scores at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'classic', size)
    const offset = board.puckRadius * 0.5
    const scored = simulateToRest({ x: board.centerX + offset, y: board.y + board.height * attackStartY, vx: 0, vy: MAX_SPEED }, board)
    expect(scored).toBe(2)
  })

  // Puck size doubles as a difficulty/accessibility tier (user feedback: "the bigger the setting
  // the more forgiving it should be") — DIVIDER_HOLE_TO_PUCK_RADIUS grows with puckSize, and per
  // explicit later correction the goal mouth's own corridor is now governed by centerInGoalX (the
  // same center-only threshold the universal goalposts and the score check use — see physics.ts's
  // own comment on why the flat wall's gap uses it too) rather than full-body clearance: the
  // half-corridor is puckRadius * DIVIDER_HOLE_TO_PUCK_RADIUS[puckSize] / 2, i.e. 1.75r/2r/2.5r for
  // small/medium/large.
  //
  // This used to be a physics simulation (a fixed off-center offset, asserting it only scores at
  // 'large'), but that's no longer a stable thing to assert: the goalposts sit exactly at the
  // corridor's own edge now, and a shot placed close enough to that edge to actually test the
  // corridor's width can clip a post and ricochet — off the post, off the divider wall, off the
  // far boundary — before eventually settling in EITHER goal, 500 simulated frames later. Which
  // goal a ricochet like that happens to end up in isn't a meaningful invariant to pin down, and
  // there's no offset that cleanly avoids every size's post while still landing outside every
  // "should miss" size's corridor (the margins are too tight — see git history for the numbers).
  // Checking the corridor's own half-width directly is what actually proves the tiers differ in
  // forgiveness, without depending on that chaotic edge case.
  it('the goal corridor half-width (the centerInGoalX threshold) grows with puckSize', () => {
    const halfWidthsInPuckRadii = sizes.map((size) => {
      const board = computeBoardLayout(400, 900, insets, 'classic', size)
      return board.goalWidth / 2 / board.puckRadius
    })
    expect(halfWidthsInPuckRadii).toEqual([1.75, 2, 2.5])
  })
})

// Direct regression guard for a bug that already bit 'classic' once (see its buildObstacles case
// in utils/board.ts): a wall gap or gravity well positioned too close to a faceoff dot lets a
// dead-straight shot from the dot clear it with no real aiming required. Checked generically
// across every variant/puckSize rather than just the two new variants that prompted it, so any
// future board type gets the same guard for free.
describe('no wall gap or gravity well overlaps a faceoff dot', () => {
  const variants: BoardVariant[] = ['classic', 'gauntlet', 'gravity']
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  for (const variant of variants) {
    for (const size of sizes) {
      it(`${variant} at puckSize=${size}`, () => {
        const board = computeBoardLayout(400, 900, insets, variant, size)
        const dotRadius = faceoffZoneRadius(board)
        const dots = [...faceoffZoneCenters(board, 1), ...faceoffZoneCenters(board, 2)]

        for (const dot of dots) {
          for (const obs of board.obstacles) {
            const hit = circleVsRect(dot.x, dot.y, dotRadius, obs.x, obs.y, obs.width, obs.height).hit
            expect(hit).toBe(false)
          }
          for (const well of board.gravityWells) {
            const dist = Math.hypot(well.x - dot.x, well.y - dot.y)
            expect(dist).toBeGreaterThan(well.radius + dotRadius)
          }
        }
      })
    }
  }
})

// Regression coverage for a real playtesting bug: the two outer walls originally used a
// deliberately narrower gap (puckRadius*2.2) than the center wall's puckRadius*3.2, and the three
// walls sat at uneven y-fractions (0.28/0.5/0.72) rather than dividing the rink evenly — both
// corrected per explicit user feedback.
describe('gauntlet: every gap is the same size, and the walls divide the rink into 4 equal zones', () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  it.each(sizes)('all 3 walls use the same DIVIDER_HOLE_TO_PUCK_RADIUS gap width at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'gauntlet', size)
    // Each wall is 3 obstacle segments (2 holes) except the center wall (2 segments, 1 hole) — 8
    // segments total. Gap width = the horizontal distance between adjacent segments within the
    // same wall (same y). Group by y, then measure gaps.
    const byY = new Map<number, { x: number; width: number }[]>()
    for (const obs of board.obstacles) {
      const segs = byY.get(obs.y) ?? []
      segs.push({ x: obs.x, width: obs.width })
      byY.set(obs.y, segs)
    }
    const gapWidths: number[] = []
    for (const segs of byY.values()) {
      const sorted = [...segs].sort((a, b) => a.x - b.x)
      for (let i = 0; i < sorted.length - 1; i++) {
        gapWidths.push(sorted[i + 1].x - (sorted[i].x + sorted[i].width))
      }
    }
    expect(gapWidths).toHaveLength(5) // 2 gaps each in the top/bottom walls (2 holes) + 1 in the center wall (1 hole)
    for (const w of gapWidths) expect(w).toBeCloseTo(gapWidths[0], 5)
  })

  it('the 3 walls sit at y-fractions 0.25/0.5/0.75, dividing the rink into 4 equal zones', () => {
    const board = computeBoardLayout(400, 900, insets, 'gauntlet', 'medium')
    const wallYs = [...new Set(board.obstacles.map((o) => o.y))].sort((a, b) => a - b)
    expect(wallYs).toHaveLength(3)
    const boundaries = [board.y, ...wallYs.map((wy) => wy + board.wallThickness / 2), board.y + board.height]
    const zoneHeights = boundaries.slice(1).map((b, i) => b - boundaries[i])
    for (const h of zoneHeights) expect(h).toBeCloseTo(board.height / 4, 0)
  })
})

describe("rink's cornerRadius/behindGoalDepth", () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']
  const nonRinkVariants: BoardVariant[] = ['classic', 'gauntlet', 'gravity']

  it.each(sizes)('are both > 0 at puckSize=%s, and the extended boundary stays within the viewport', (size) => {
    const insetsZero = { top: 0, bottom: 0, left: 0, right: 0 }
    const board = computeBoardLayout(400, 900, insetsZero, 'classic', size, true)
    expect(board.cornerRadius).toBeGreaterThan(0)
    expect(board.behindGoalDepth).toBeGreaterThan(0)
    // The true collision boundary (board.y - behindGoalDepth .. board.y+height+behindGoalDepth)
    // must never fall outside [0, 900] — this is the direct regression guard for Strategy B
    // (see computeBoardLayout's own comment): behindGoalDepth eats into the front-line
    // board.height rather than growing past the original letterboxed viewport.
    expect(board.y - board.behindGoalDepth).toBeGreaterThanOrEqual(0)
    expect(board.y + board.height + board.behindGoalDepth).toBeLessThanOrEqual(900)
  })

  it.each(nonRinkVariants)('%s has cornerRadius=0 and behindGoalDepth=0', (variant) => {
    const board = computeBoardLayout(400, 900, insets, variant, 'medium')
    expect(board.cornerRadius).toBe(0)
    expect(board.behindGoalDepth).toBe(0)
  })
})

describe('rink: the true outer boundary never blocks a normal, gradually-completed goal', () => {
  // Slow enough that the puck takes many stepPhysics frames to fully clear the line (rather than
  // jumping past it in one integration step) — this is the case that would have hit the
  // 'behindGoalDepth' bug found during implementation: too shallow a pocket meant a puck mid-
  // crossing (leading edge past the line, trailing edge not yet) could already be overlapping the
  // true outer boundary (now solid across the full width for 'rink', goal mouth included — see
  // stepPhysics' skipGoalGap) and get bounced back out before ever completing the score.
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  it.each(sizes)('a slow, dead-center shot still scores at puckSize=%s', (size) => {
    const board = computeBoardLayout(400, 900, insets, 'classic', size, true)
    // Starts a few puck radii from the goal line (rather than mid-board) so friction decay alone
    // doesn't stop it short before it ever reaches the line — the point of this test is the
    // near-the-line crossing behavior, not full-board travel.
    const startY = board.y + board.height - board.puckRadius * 4
    const slowSpeed = board.puckRadius * 0.4 // small enough to take multiple frames to cross the line
    const scored = simulateToRest({ x: board.centerX, y: startY, vx: 0, vy: slowSpeed }, board)
    expect(scored).toBe(2)
  })
})

describe('goalposts still collide when an angled approach crosses the corridor boundary mid-contact', () => {
  // Real playtesting bug (found via a live-recorded repro, not just an earlier adversarial sweep):
  // each post sits EXACTLY at the corridor's own boundary (post.x === goalAbsLeft or goalAbsRight).
  // The old post-collision gate disabled itself the instant centerInGoalX went true — but an angled
  // approach's x-coordinate can tick past that exact threshold while the puck's CENTER is still
  // sitting almost on top of the post (well within combined-radius distance), since a post's
  // collision radius (puckRadius + postRadius) is strictly larger than the puckRadius-only margin
  // centerInGoalX's threshold implicitly assumes. The old gate let the puck sail straight through a
  // post it was still overlapping, with zero deflection — exactly "aimed right at the post, expected
  // it to bounce back, but it went right through." Fixed by making the post check purely
  // distance-based (circleVsCircle decides, not an x-only proxy for it) — see physics.ts's own
  // comment on the goalpost loop for why this doesn't reopen the earlier "narrow corridor" problem.
  for (const rink of [false, true]) {
    it(`a puck angled toward the top-left post deflects instead of slipping through (rink=${rink})`, () => {
      const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', rink)
      const post = board.goalPosts.find((p) => p.player === 2 && p.x < board.centerX)!
      const combined = board.puckRadius + post.radius
      // Starts outside the corridor (x < post.x, i.e. x < goalAbsLeft) and close enough to the post
      // to be within combined-radius, moving diagonally up-and-right so its x crosses the post's
      // exact x-coordinate (and centerInGoalX flips true) while y is still near the post's own y.
      let puck = { x: post.x - combined * 0.5, y: post.y + combined * 0.3, vx: 5, vy: -5 }
      let everBounced = false
      let maxVxChange = 0
      for (let i = 0; i < 10; i++) {
        const result = stepPhysics(puck, board, 1)
        if (result.bounced) everBounced = true
        maxVxChange = Math.max(maxVxChange, Math.abs(result.vx - 5))
        puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
        if (result.scored !== null) break
      }
      expect(everBounced).toBe(true)
      // A real ricochet substantially changes vx — a silent pass-through (the bug) would leave vx
      // essentially unchanged (still ~5, its untouched starting value).
      expect(maxVxChange).toBeGreaterThan(1)
    })
  }
})

describe("rink: goalposts stop deflecting a puck once it is fully behind that goal's own line", () => {
  // Real user report: "I'm hitting the posts on the back when I feel like I shouldn't be, behind
  // the goal" — real hockey posts don't extend backward into the net, they only matter for a shot
  // approaching the goal mouth from the playable side. Fixed by gating each post's collision on
  // the SAME wasBehindTop/wasBehindBottom flags stepPhysics' own one-way door already uses (see
  // physics.ts's post-loop comment) — a post whose own goal the puck is already fully behind is
  // skipped entirely, while the OTHER goal's posts (and this same goal's posts on an ordinary
  // front approach, or mid-crossing) are completely unaffected. Only reachable when rink is on —
  // with rink off, a live puck can never legitimately be "behind" a line without having already
  // scored the instant it happened (see wasBehindTop's own comment), so the gate is a structural
  // no-op there, not something that needs its own rink=false test.
  it('a puck deep in the pocket, poking at the top-left post from behind, passes through untouched', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    const post = board.goalPosts.find((p) => p.player === 2 && p.x < board.centerX)!
    const r = board.puckRadius
    // Comfortably behind the top line (wasBehindTop has real margin) while still genuinely
    // overlapping the post's own circle from the pocket side — without the fix this would clang
    // off the post exactly like the front-approach tests above prove it should when NOT behind.
    const overlap = post.radius * 0.5
    const puck = { x: post.x, y: board.y - r - (post.radius - overlap), vx: 3, vy: 0 }
    expect(puck.y + r).toBeLessThan(board.y) // sanity: genuinely wasBehindTop
    expect(Math.hypot(puck.x - post.x, puck.y - post.y)).toBeLessThan(r + post.radius) // sanity: genuinely overlapping
    const result = stepPhysics(puck, board, 1)
    expect(result.bounced).toBe(false)
    expect(result.vx).toBeCloseTo(3, 1) // velocity untouched — no deflection happened at all
  })

  it('the SAME post still deflects normally once the puck is back in front of the line', () => {
    // Regression guard against over-widening the gate: approaching from the playable side (not
    // behind) must keep working exactly like the existing "still collide" tests above. Just
    // bounced === true (not also a vx/vy assertion): this puck's straight-down-the-post-axis
    // approach makes the collision normal here nearly parallel to its own velocity, so a real hit
    // can legitimately leave velocity almost unchanged — bounced is what actually proves the
    // post's own circleVsCircle fired (as opposed to being skipped), which is the only thing this
    // test needs to guard against.
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    const post = board.goalPosts.find((p) => p.player === 2 && p.x < board.centerX)!
    const r = board.puckRadius
    const overlap = post.radius * 0.5
    const puck = { x: post.x, y: board.y + r + (post.radius - overlap), vx: -3, vy: 0 }
    expect(puck.y - r).toBeGreaterThan(board.y) // sanity: NOT behind — this is the field side
    const result = stepPhysics(puck, board, 1)
    expect(result.bounced).toBe(true)
  })

  it('symmetric case: a puck deep behind the BOTTOM line passes through the bottom-left post untouched', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    const post = board.goalPosts.find((p) => p.player === 1 && p.x < board.centerX)!
    const r = board.puckRadius
    const overlap = post.radius * 0.5
    const puck = { x: post.x, y: board.y + board.height + r + (post.radius - overlap), vx: -3, vy: 0 }
    expect(puck.y - r).toBeGreaterThan(board.y + board.height) // sanity: genuinely wasBehindBottom
    expect(Math.hypot(puck.x - post.x, puck.y - post.y)).toBeLessThan(r + post.radius) // sanity: overlapping
    const result = stepPhysics(puck, board, 1)
    expect(result.bounced).toBe(false)
    expect(result.vx).toBeCloseTo(-3, 1)
  })
})

describe('the flat wall never fires within a post\'s own reach (no "flat bounce standing in for the post")', () => {
  // A second, distinct bug from the one above, found via live playtesting right after that fix
  // landed ("the wall shouldn't even extend to under the post"): the goalpost-before-wall ordering
  // only makes the post win when BOTH it and the flat wall would fire on the exact same frame — it
  // doesn't stop the wall's OWN trigger (a flat line at board.y ± puckRadius, independent of how
  // far x is from a post, as long as x is outside the true corridor) from firing EARLIER than the
  // post's circular reach would, at moderate offsets. The post's reach in x tops out at puckRadius +
  // postRadius, but only exactly at the post's own y — everywhere else its remaining reach shrinks
  // (a circle), while the wall's reach stays a constant puckRadius regardless of x. For any x-offset
  // roughly between 0.63x and 1x the post's own combined radius, the wall's fixed reach used to
  // exceed the post's shrunken reach at that offset, so the wall fired first — a flat, straight
  // bounce standing in for what should have been the post's own round shape. Fixed by widening the
  // near-line wall's own permeable zone (see physics.ts's nearPostX) to also exclude any post's real
  // reach, not just the narrow true corridor.
  const insets = { top: 0, bottom: 0, left: 0, right: 0 }

  it("every offset genuinely within the post's own combined radius produces a real (non-flat) deflection", () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', false)
    const post = board.goalPosts.find((p) => p.player === 2 && p.x < board.centerX)!
    const combined = board.puckRadius + post.radius

    // Sampled across the exact band the old bug affected (0.63-1.0x combined), plus points on
    // either side for context — every one of these approaches passes within the post's own reach
    // at its closest point, so every one of them must produce a real, non-flat ricochet.
    const offsetRatios = [0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.99]
    const flatBounces: number[] = []
    for (const offsetRatio of offsetRatios) {
      const offset = combined * offsetRatio
      let puck = { x: post.x - offset, y: board.y + board.puckRadius * 4, vx: 0, vy: -4 }
      for (let i = 0; i < 40; i++) {
        const before = puck
        const result = stepPhysics(puck, board, 1)
        puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
        if (result.bounced) {
          if (Math.abs(puck.vx - before.vx) <= 0.5) flatBounces.push(offsetRatio)
          break
        }
        if (result.scored !== null) break
      }
    }
    expect(flatBounces).toEqual([])
  })

  it("an offset genuinely beyond the post's reach still correctly bounces off the flat wall", () => {
    // The fix must not over-widen the exemption — an offset the post can never reach (regardless of
    // y) should still hit ordinary, solid boards, same as any other spot along the boundary.
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', false)
    const post = board.goalPosts.find((p) => p.player === 2 && p.x < board.centerX)!
    const combined = board.puckRadius + post.radius
    let puck = { x: post.x - combined * 1.3, y: board.y + board.puckRadius * 4, vx: 0, vy: -4 }
    let flatBounce = false
    for (let i = 0; i < 40; i++) {
      const before = puck
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      if (result.bounced) {
        flatBounce = Math.abs(puck.vx - before.vx) <= 0.5
        break
      }
    }
    expect(flatBounce).toBe(true)
  })
})

describe("rink: a puck deep in a corner pocket can't register as a score", () => {
  it('sitting well past the front line but outside the goal x-range does not score', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    // Positioned inside a top corner's pocket (near the left wall, past board.y by more than the
    // puck's own radius) — nowhere near the goal's x-range.
    const puck = { x: board.x + board.cornerRadius * 0.3, y: board.y - board.behindGoalDepth * 0.5, vx: 0, vy: 0 }
    const result = stepPhysics(puck, board, 1)
    expect(result.scored).toBeNull()
  })
})

// Regression coverage for a real playtesting bug: the first implementation kept the flat wall at
// board.y across nearly the entire width, with only a tiny notch receding near the literal
// corners — that notch's own geometry couldn't reach the true boundary either, so a puck could
// never actually get behind the goal at all; 'rink' just shrank board.height for nothing. The fix
// moved the flat wall itself to the true outer boundary (outerTop/outerBottom) everywhere outside
// the goal mouth and the (now purely cosmetic) rounded corners — see stepPhysics' own comment.
describe('rink: the pocket is reachable without needing the rounded corner at all', () => {
  it('a puck sailing wide of the goal (not banked into a corner) can cross into the pocket', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    // Well clear of both the goal's x-range and the corner's x-range, heading straight at the
    // true outer boundary — this is the main, ordinary path into the pocket, not an edge case.
    let puck = { x: board.x + board.width * 0.25, y: board.y + board.height * 0.15, vx: 0, vy: -6 }
    let reachedPocket = false
    for (let i = 0; i < 300; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      if (puck.y < board.y) reachedPocket = true
      if (result.scored !== null || result.stopped) break
    }
    expect(reachedPocket).toBe(true)
  })

  it('a straight shot at the goal mouth still scores normally (the pocket fix does not break scoring)', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    // Started past the center divider, not at board.centerY — see the "goal geometry stays
    // makeable" describe block's own attackStartY comment above: 'classic' has a real divider
    // wall at centerY regardless of the rink pocket setting (buildObstacles depends only on the
    // base variant), so starting mid-board would test bouncing off that wall, not the pocket fix.
    const scored = simulateToRest({ x: board.centerX, y: board.y + board.height * 0.75, vx: 0, vy: MAX_SPEED }, board)
    expect(scored).toBe(2)
  })
})

describe('rink: the true outer boundary is solid everywhere, including the goal mouth', () => {
  it('a puck already behind the line, within the goal x-range, still bounces off the true edge rather than sailing through', () => {
    // Already past the front line (wasBehindTop true, so it can't accidentally score here — see
    // the directional-guard tests above) and heading straight at the true outer boundary, dead
    // center in the goal's own x-range. Confirms the boundary has no goal-shaped gap in it for
    // 'rink' — without that, this puck would fly straight through and never stop.
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    // y0 must clear board.y by more than a full puck radius, or the puck isn't actually "fully
    // behind" yet (wasBehindTop false) and a subsequent crossing is a legitimate fresh score, not
    // the scenario this test means to set up.
    let puck = { x: board.centerX, y: board.y - board.puckRadius - board.behindGoalDepth * 0.3, vx: 0, vy: -8 }
    let everBounced = false
    for (let i = 0; i < 200; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      if (result.bounced) everBounced = true
      expect(result.scored).toBeNull() // never scores — it was already behind the line the whole time
      if (result.stopped) break
    }
    expect(everBounced).toBe(true)
  })

  it('does NOT flag goalDoorHit for a bounce off the TRUE far boundary — a different collision from the goal-mouth door, using real layout geometry', () => {
    // A single isolated step against the far wall specifically (not a multi-step run toward it —
    // a puck given enough time bouncing around the pocket will likely touch BOTH the far wall and
    // the door before coming to rest, which wouldn't isolate which collision this test cares about).
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    const outerTop = board.y - board.behindGoalDepth
    const puck = { x: board.centerX, y: outerTop + board.puckRadius + 1, vx: 0, vy: -5 }
    const result = stepPhysics(puck, board, 1)
    expect(result.bounced).toBe(true)
    expect(result.goalDoorHit).toBeNull()
  })

  it('flags goalDoorHit for a puck already behind the line bouncing off the door on its way back toward the front, using real layout geometry', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    // Same starting position as the test above (already behind the line, within the goal's own
    // x-range), but heading back TOWARD the front line (positive vy) instead of deeper into the
    // pocket — this is what actually reaches the door.
    let puck = { x: board.centerX, y: board.y - board.puckRadius - board.behindGoalDepth * 0.3, vx: 0, vy: 8 }
    let sawGoalDoorHit: 'top' | 'bottom' | null = null
    for (let i = 0; i < 200; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      expect(result.scored).toBeNull() // the door's whole job is to prevent this from ever scoring
      if (result.goalDoorHit) sawGoalDoorHit = result.goalDoorHit
      if (result.stopped) break
    }
    expect(sawGoalDoorHit).toBe('top')
  })
})

// Regression coverage for a real playtesting bug: a puck that ended up behind the line within the
// goal's own x-range (without having freshly scored — e.g. drifted in from the wider pocket) could
// simply sail back out through the front of the goal mouth into the field, since nothing physically
// stopped it there (only the score check's own directional guard, which prevents a false SCORE but
// doesn't prevent the puck's actual position from passing through). Visually this reads as "the
// puck came back through the goal." Fixed with a one-way door: open front-to-back, solid
// back-to-front, scoped to just the goal's own x-range (see stepPhysics' own comment).
describe('rink: a puck behind the goal cannot pass back out through the front of the goal mouth', () => {
  it('stays behind the line for the entire simulation, all the way to rest', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    let puck = { x: board.centerX, y: board.y - board.puckRadius - board.behindGoalDepth * 0.3, vx: 0, vy: -8 }
    let everCrossedBackToFront = false
    for (let i = 0; i < 500; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      expect(result.scored).toBeNull()
      if (puck.y + board.puckRadius >= board.y) everCrossedBackToFront = true
      if (result.stopped) break
    }
    expect(everCrossedBackToFront).toBe(false)
  })

  // Regression coverage for a second, narrower real bug in the same door: it used to gate on
  // inGoalX (the puck's whole body strictly inside the corridor) rather than centerInGoalX (the
  // same center-only "goal's own x-range" test the score check/goalposts already use elsewhere).
  // A puck retreating close enough to a post's x that its edge overlapped the post's own x-line
  // had inGoalX go false right where the door needed to fire — and at the y where the door check
  // first turns true (trailing edge just reaching board.y), the puck's center is still a full
  // puckRadius short of the post's own y, so the post's own small collision radius (puckRadius *
  // 0.18) doesn't reach that far either: neither check caught it, and the puck sailed back out
  // through the goal mouth right past the post it had just skirted.
  it('also stays behind the line retreating near a post, where the old full-body gate had a gap', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    const nearPostX = board.x + board.goalLeft + board.puckRadius * 0.9
    let puck = { x: nearPostX, y: board.y - board.puckRadius - 2, vx: 0, vy: 3 }
    let everCrossedBackToFront = false
    for (let i = 0; i < 500; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      expect(result.scored).toBeNull()
      if (puck.y + board.puckRadius >= board.y) everCrossedBackToFront = true
      if (result.stopped) break
    }
    expect(everCrossedBackToFront).toBe(false)
  })
})

// Regression coverage for a real playtesting bug: the goal used to be a small physical net box
// (a back wall plus two side posts) blocking the puck from traveling behind it at all — the exact
// opposite of the point of this mode. Per explicit correction, the goal is now a SLOT with no
// physical structure of its own (buildObstacles builds no net structure for any variant): nothing stops a puck from
// entering the goal's x-range from the pocket side. What still prevents scoring from behind is a
// same-frame DIRECTIONAL check (see stepPhysics' wasBehindTop/wasBehindBottom) — only a fresh
// crossing (wasn't already fully behind the line a moment ago) counts.
describe("rink: a puck already behind the line can't score by drifting into the goal's x-range", () => {
  it('drifting sideways toward the goal from the open pocket does not score, even with no net walls', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    // Starts in the open pocket area (not in the goal's x-range), moving sideways toward it — the
    // whole pocket is open now (no net structure at all), so only the directional check protects
    // this.
    let puck = { x: board.x + board.width * 0.3, y: board.y - board.behindGoalDepth * 0.5, vx: 4, vy: 0 }
    let scored: number | null = null
    for (let i = 0; i < 200; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      if (result.scored !== null) {
        scored = result.scored
        break
      }
      if (result.stopped) break
    }
    expect(scored).toBeNull()
  })

  it('a single step that starts already behind the line and ends in the goal x-range does not score', () => {
    // The most direct test of the directional guard itself: y0 (start of step) is already fully
    // past the line, x lands inside the goal's x-range by the end of the SAME step — without the
    // wasBehindTop guard this would incorrectly register as a fresh score.
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', true)
    const puck = { x: board.centerX - board.puckRadius * 3, y: board.y - board.behindGoalDepth * 0.4, vx: board.puckRadius * 3, vy: 0 }
    const result = stepPhysics(puck, board, 1)
    expect(result.scored).toBeNull()
  })
})

// Regression coverage for a real playtesting bug: the center attractor was originally sized
// (width*0.11) without accounting for how far classic's own holes actually sit from center — for
// every puck size, that radius landed entirely inside the solid wall, never once reaching open
// space a puck could occupy. A well nothing can ever get close to is a well that can never affect
// anything, which is exactly what got reported.
describe('gravity: the center attractor actually reaches open space', () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  it.each(sizes)("its influence radius extends past classic's nearest hole edge at puckSize=%s", (size) => {
    const board = computeBoardLayout(400, 900, insets, 'gravity', size)
    const attractor = board.gravityWells.find((w) => w.strength > 0)!
    // classic's hole center sits width*0.3 from board center (see buildObstacles' 'classic' case)
    // — the well's own x/y already sit at board center, so distance-to-hole-center is exactly
    // that offset.
    const holeCenterDist = board.width * 0.3
    expect(attractor.radius).toBeGreaterThan(holeCenterDist)
  })
})

// 'rink' "borrows" the safe-area insets (status bar/notch at top, home indicator at bottom) for
// its behind-the-goal pocket instead of shrinking the front-line field by the full depth at both
// ends — that space is otherwise just empty background. See boardMarginTop's own doc comment on
// BoardLayout: the screen container's own top margin has to move to match, since board.y/height
// stay in the SAME coordinate system either way (only the container's origin moves).
describe('rink borrows from the safe-area insets for its pocket depth', () => {
  // A realistic notched-phone inset, not the zero-inset `insets` used by every other describe
  // block in this file — the whole point of this feature is dormant at insets=0.
  const notchedInsets = { top: 59, bottom: 34, left: 0, right: 0 }

  it('boardMarginTop is less than insets.top when there is a pocket to fund', () => {
    const board = computeBoardLayout(400, 900, notchedInsets, 'classic', 'medium', true)
    expect(board.behindGoalDepth).toBeGreaterThan(0)
    expect(board.boardMarginTop).toBeLessThan(notchedInsets.top)
    expect(board.boardMarginTop).toBeGreaterThanOrEqual(0)
  })

  it.each<BoardVariant>(['classic', 'gauntlet', 'gravity'])('boardMarginTop equals insets.top exactly on %s (nothing to borrow)', (variant) => {
    const board = computeBoardLayout(400, 900, notchedInsets, variant, 'medium')
    expect(board.boardMarginTop).toBe(notchedInsets.top)
  })

  it('the true outer boundary, converted to real screen coordinates, never goes past the physical screen edges', () => {
    const screenHeight = 900
    const board = computeBoardLayout(400, screenHeight, notchedInsets, 'classic', 'medium', true)
    // Converting board-local y back to screen space is exactly boardMarginTop + y (see
    // p1TapGesture/p2TapGesture's own conversion in game.tsx, which does the reverse).
    const outerTopScreen = board.boardMarginTop + (board.y - board.behindGoalDepth)
    const outerBottomScreen = board.boardMarginTop + (board.y + board.height + board.behindGoalDepth)
    expect(outerTopScreen).toBeGreaterThanOrEqual(0)
    expect(outerBottomScreen).toBeLessThanOrEqual(screenHeight)
  })

  it('the field recovers real space vs. the pre-borrowing baseline, for these same insets', () => {
    // NOT a comparison against a zero-inset board — when both insets are smaller than
    // behindGoalDepth (as here: 59/34 vs. medium's ~68px), borrowing's "add back topBorrow +
    // bottomBorrow" exactly cancels availableHeight's own "subtract insets.top + insets.bottom",
    // so a notched board's height can legitimately come out EQUAL to a zero-inset board's — that
    // isn't a bug, it's what happens when the entire inset (not the entire depth) gets borrowed.
    // The real baseline this feature should beat is "what this SAME device would have gotten
    // without borrowing at all" — i.e. availableHeight - 2×behindGoalDepth, the old formula.
    const board = computeBoardLayout(400, 900, notchedInsets, 'classic', 'medium', true)
    const availableHeight = 900 - notchedInsets.top - notchedInsets.bottom // mobile/native: no desktop letterbox margin
    const preBorrowingFieldHeight = availableHeight - board.behindGoalDepth * 2
    expect(board.height).toBeGreaterThan(preBorrowingFieldHeight)
    expect(board.height - preBorrowingFieldHeight).toBe(notchedInsets.top + notchedInsets.bottom)
  })

  it('a puck sailing wide of the goal can still reach the pocket with a notched inset (the borrowed depth is still real, physical space)', () => {
    const board = computeBoardLayout(400, 900, notchedInsets, 'classic', 'medium', true)
    let puck = { x: board.x + board.width * 0.25, y: board.y + board.height * 0.15, vx: 0, vy: -6 }
    let reachedPocket = false
    for (let i = 0; i < 300; i++) {
      const result = stepPhysics(puck, board, 1)
      puck = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
      if (puck.y < board.y) reachedPocket = true
      if (result.scored !== null || result.stopped) break
    }
    expect(reachedPocket).toBe(true)
  })
})

// Walls (the desktop-web perimeter box and the classic/gauntlet center-divider walls) always read
// as thin as the goal line itself, in every mode including rink — per explicit correction, this
// is NOT rink-conditional (an earlier version gated it to rink-off only). See computeBoardLayout's
// wallThickness local.
describe('walls are always as thin as the goal line', () => {
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']
  const variants: BoardVariant[] = ['classic', 'gauntlet', 'gravity']

  for (const variant of variants) {
    for (const rink of [false, true]) {
      it.each(sizes)(`${variant}: board.wallThickness equals GOAL_LINE_STROKE_WIDTH when rink=${rink}, puckSize=%s`, (size) => {
        const board = computeBoardLayout(400, 900, insets, variant, size, rink)
        expect(board.wallThickness).toBe(GOAL_LINE_STROKE_WIDTH)
        // Confirm the SAME value actually sized the obstacles, not just the returned field.
        for (const obs of board.obstacles) {
          expect(Math.min(obs.width, obs.height)).toBeCloseTo(GOAL_LINE_STROKE_WIDTH, 5)
        }
      })
    }
  }
})

// Regression coverage for the same divider-hole visual clarity this session added: thinning the
// walls (above) makes each hole's edges less visually anchored, so they get the same small round
// "post" cap treatment buildGoalPosts already gives the goal mouth — see buildWallPosts in
// utils/board.ts. These are purely decorative (the Obstacle rect's own corner already collides
// correctly at this exact point), so there's no physics.ts coverage needed here, only geometry.
// Built for every mode including rink — same "not rink-conditional" correction as wallThickness.
describe('wall posts cap each divider/gauntlet gap edge, in every mode', () => {
  for (const rink of [false, true]) {
    it(`classic/gravity: 4 posts at the 2 holes' edges, on the wall's fixed centerline (rink=${rink})`, () => {
      for (const variant of ['classic', 'gravity'] as BoardVariant[]) {
        const board = computeBoardLayout(400, 900, insets, variant, 'medium', rink)
        expect(board.wallPosts).toHaveLength(4)
        for (const post of board.wallPosts) {
          expect(post.y).toBeCloseTo(board.y + board.height / 2, 5)
          expect(post.radius).toBeCloseTo(board.puckRadius * WALL_POST_RADIUS_RATIO, 5)
        }
      }
    })

    it(`gauntlet: 10 posts total across all 3 walls (4 + 2 + 4) (rink=${rink})`, () => {
      const board = computeBoardLayout(400, 900, insets, 'gauntlet', 'medium', rink)
      expect(board.wallPosts).toHaveLength(10)
    })

    it(`every wall post sits on an obstacle edge (x matches a gap edge, y on that same wall's centerline) (rink=${rink})`, () => {
      // Ties the decorative post's geometry directly to the real collision rect it's capping. A
      // post sits on the wall's vertical CENTERLINE (post.y === obs.y + obs.height/2), not a rect
      // corner — unlike the goal line (a zero-thickness Line, so its posts land exactly on its
      // endpoints), a divider wall is a real Rect with height, and the post (radius puckRadius *
      // WALL_POST_RADIUS_RATIO) is deliberately taller than the thinned-down wall band it caps,
      // the same way goalposts already read taller than the goal line's own stroke width.
      for (const variant of ['classic', 'gauntlet', 'gravity'] as BoardVariant[]) {
        const board = computeBoardLayout(400, 900, insets, variant, 'medium', rink)
        for (const post of board.wallPosts) {
          const matchesAGapEdge = board.obstacles.some((obs) => {
            const onThisWallRow = Math.abs(post.y - (obs.y + obs.height / 2)) < 0.01
            const atThisEdge = Math.abs(obs.x - post.x) < 0.01 || Math.abs(obs.x + obs.width - post.x) < 0.01
            return onThisWallRow && atThisEdge
          })
          expect(matchesAGapEdge).toBe(true)
        }
      }
    })
  }
})

// A wall post is its own circle (radius puckRadius * WALL_POST_RADIUS_RATIO), so the "no wall gap
// or gravity well overlaps a faceoff dot" guard above (which only proves clearance to the bare
// rect corner) doesn't automatically cover clearance to a post-sized circle centered at that same
// corner — checked separately here rather than folded into that guard, since a failure here means
// revisiting holeOffset/WALL_POST_RADIUS_RATIO, not the divider-hole geometry that guard covers.
describe('wall posts do not overlap a faceoff dot, in every mode', () => {
  const variants: BoardVariant[] = ['classic', 'gauntlet', 'gravity']
  const sizes: PuckSizeLevel[] = ['small', 'medium', 'large']

  for (const variant of variants) {
    for (const size of sizes) {
      for (const rink of [false, true]) {
        it(`${variant} at puckSize=${size} (rink=${rink})`, () => {
          const board = computeBoardLayout(400, 900, insets, variant, size, rink)
          const dotRadius = faceoffZoneRadius(board)
          const dots = [...faceoffZoneCenters(board, 1), ...faceoffZoneCenters(board, 2)]

          for (const dot of dots) {
            for (const post of board.wallPosts) {
              const dist = Math.hypot(post.x - dot.x, post.y - dot.y)
              expect(dist).toBeGreaterThan(dotRadius + post.radius)
            }
          }
        })
      }
    }
  }
})

describe('computeTrajectory — post bounces stay close to what stepPhysics actually does', () => {
  // Real bug, user-reported ("the angle preview is definitely not working, especially off of
  // posts"): computeTrajectory used to move a puck by its FULL per-frame velocity in one jump each
  // iteration (no sub-stepping), unlike stepPhysics itself, which splits a frame into several finer
  // sub-steps specifically because a goalpost's collision radius is a genuinely thin target a fast
  // puck can jump clean past between two sampled positions (see SUBSTEP_MAX_DISPLACEMENT_RATIO's own
  // comment in physics.ts). At MAX_SPEED (22px/frame) against a goalpost's small radius, a single
  // un-substepped frame could sail straight through a grazing hit the real, sub-stepped physics
  // would have caught — or land deep enough inside it to produce a wildly different bounce angle —
  // producing a genuinely non-physical preview: a manual repro of this exact scenario, run against
  // the pre-fix implementation, produced a trajectory whose own y-coordinate went 11.9 -> 424.8 ->
  // 8.6 -> -24.5 (repeatedly moving BACKWARD along a straight-down shot with zero vx), nothing like
  // what the puck could actually do. computeTrajectory gained the same sub-stepping stepPhysics
  // already has to close this gap.
  const insets = { top: 0, bottom: 0, left: 0, right: 0 }

  it('a fast, near-tangential graze off a goalpost bounces at close to the real contact point, not a wildly different one', () => {
    const board = computeBoardLayout(400, 900, insets, 'classic', 'medium', false)
    const post = board.goalPosts.find((p) => p.player === 2 && p.x < board.centerX)!
    const r = board.puckRadius
    const combined = r + post.radius

    // A near-tangential graze (0.9x combined radius) at MAX_SPEED — the specific shape of shot the
    // old single-step-per-frame code was most prone to sampling past entirely.
    const lateralOffset = combined * 0.9
    const startX = post.x + lateralOffset
    const startY = post.y - 200

    // Ground truth: sub-stepped stepPhysics driven from the exact same start, straight down at
    // MAX_SPEED, using the round's actual medium friction (the same default computeTrajectory now
    // uses — see its own friction param).
    let p = { x: startX, y: startY, vx: 0, vy: MAX_SPEED }
    let realBouncePos: { x: number; y: number } | null = null
    for (let i = 0; i < 30 && !realBouncePos; i++) {
      const result = stepPhysics(p, board, 1, FRICTION_LEVELS.medium)
      if (result.bounced) realBouncePos = { x: result.x, y: result.y }
      p = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
    }
    expect(realBouncePos).not.toBeNull()

    // dragDy = maxDragPixels (full pull straight down) reproduces the same vy = MAX_SPEED, vx = 0
    // starting velocity as the ground truth above.
    const traj = computeTrajectory(startX, startY, 0, 160, board, 160, MAX_SPEED, 5, FRICTION_LEVELS.medium)
    expect(traj.length).toBeGreaterThan(1) // a real bounce must have been recorded at all

    const predictedBounce = traj[1]
    const errorPx = Math.hypot(predictedBounce.x - realBouncePos!.x, predictedBounce.y - realBouncePos!.y)
    // Well under puckRadius (23px on this fixture) — the pre-fix code missed this graze entirely
    // (bounced: false the whole approach) or, in other offset/speed combinations, landed a bounce
    // point tens of pixels off with an unrelated resulting angle.
    expect(errorPx).toBeLessThan(r)

    // Coherence guard against the exact failure mode quoted above: a straight-down approach (vx=0
    // throughout, so x is fixed) must never predict the puck moving BACKWARD in y before the bounce.
    for (let i = 1; i < traj.length; i++) {
      expect(traj[i].y).toBeGreaterThanOrEqual(traj[i - 1].y - 1) // -1px slack for float rounding
    }
  })
})
