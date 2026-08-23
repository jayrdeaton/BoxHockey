import { useAutoPaperTheme } from '@rific/auto-paper'
import { Canvas, Circle, Group, Line, Path, Rect, Skia, SkPath, vec } from '@shopify/react-native-skia'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { cancelAnimation, Easing, SharedValue, useDerivedValue, useFrameCallback, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated'

import { COLORS, FACEOFF_COUNTDOWN_STEP_MS, FACEOFF_PRESS_RIPPLE_DURATION_MS, MAX_DRAG_PIXELS, MAX_SPEED, MIN_SHOOT_DRAG, STRIKE_DURATION_MS } from '@/constants/game'
import { AimIndicator, BoardLayout, FaceoffState, GamePhase, Player, PuckState } from '@/types'
import { faceoffZoneCenter, faceoffZoneRadius } from '@/utils/board'
import { computeGoalWedges } from '@/utils/goalWedges'
import { computeAimVector, computeTrajectory, TrajectoryPoint } from '@/utils/physics'

import { GravityWellMarker } from './GravityWellMarker'

// A ceiling, not the usual count — the real limits are previewLengthPx (how far the trail's
// allowed to reach, see maxFitting below) and drag power (see powerCount below). Sized just above
// what the longest previewLengthPx setting ('long', see SHOT_PREVIEW_LENGTH_RATIOS) can actually
// fit at the current chevron spacing (~41 on a typical board), so 'long' shows its full reach
// instead of being cut short by this cap, while chevronHighlight's sweep (below) still uses
// nearly the whole 0..1 ring instead of idling through a mostly-unused tail.
const MAX_AIM_CHEVRONS = 44
// Cycles/sec the highlight sweeps through the chevrons at full power (chevronSweepPhase below);
// scaled down toward CHEVRON_SWEEP_MIN_RATE_FACTOR for a light drag so a bare-minimum pull still
// visibly creeps rather than freezing.
const CHEVRON_SWEEP_BASE_RATE = 1.4
const CHEVRON_SWEEP_MIN_RATE_FACTOR = 0.18

interface ChevronPlacement {
  x: number
  y: number
  ux: number
  uy: number
}

// Walks a computeTrajectory() polyline (start + each bounce waypoint + final position) by
// cumulative arc length and returns the interpolated point + that segment's unit direction —
// the primitive that lets the chevron trail bend at each bounce crossed instead of following one
// straight ray. Returns null past the polyline's end (e.g. previewLengthPx reaches further than
// the shot actually travels before stopping).
function walkPolyline(points: TrajectoryPoint[], distance: number): ChevronPlacement | null {
  let remaining = distance
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const segDx = b.x - a.x
    const segDy = b.y - a.y
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy)
    if (segLen < 0.0001) continue
    if (remaining <= segLen) {
      const t = remaining / segLen
      return { x: a.x + segDx * t, y: a.y + segDy * t, ux: segDx / segLen, uy: segDy / segLen }
    }
    remaining -= segLen
  }
  return null
}

// Triangular falloff around a fixed slot on the 0..1 sweep ring (slot = index / MAX_AIM_CHEVRONS,
// not index / activeCount, so a chevron's position on the ring — and therefore the sweep's
// apparent spacing — doesn't jump as activeCount itself changes mid-drag).
function chevronHighlight(index: number, sweepPhase: number): number {
  'worklet'
  const slot = index / MAX_AIM_CHEVRONS
  const raw = Math.abs(sweepPhase - slot)
  const wrapped = Math.min(raw, 1 - raw)
  const band = 0.18
  return Math.max(0, 1 - wrapped / band)
}

// Fraction of a chevron's opacity lost by the far end of the CURRENT trail (not the MAX_AIM_
// CHEVRONS ceiling) — the near-puck chevron always stays full strength and the last one drawn
// always reaches this floor, so the taper reads the same whether the trail is 5 marks or 40.
const CHEVRON_TAIL_FADE = 0.85

function chevronFade(index: number, total: number): number {
  if (total <= 1) return 1
  return 1 - (index / (total - 1)) * CHEVRON_TAIL_FADE
}

// One component instance per chevron (rendered via .map() below), each owning its own single
// useDerivedValue call — sidesteps rules-of-hooks entirely (a hook inside a list-rendered
// component is completely normal; the previous approach with a fixed count of chevrons hand-
// unrolled a `useDerivedValue` per index specifically to avoid a *variable* number of hook calls
// in one component, which no longer applies now that each chevron is its own component). Keeps
// the highlight sweep on the UI thread (a SharedValue prop into Group's opacity) rather than
// reading `.value` during JS-thread render, which is what actually gives the sweep buttery frame-
// by-frame smoothness instead of only updating on each JS re-render.
// `path` is a small filled triangle now (see chevronPlacements below), not an open stroked V — at
// this size a thin stroke thins out to nearly nothing, while a solid fill stays a crisp little
// arrowhead. Plain fill (no `style`/`strokeWidth`/caps) is Skia's default Path style. `fade`
// (chevronFade above) tapers both layers together so the tail dims uniformly rather than the
// sweep highlight staying full-bright over an already-faded base mark.
function ChevronMark({ path, index, sweepPhase, color, fade }: { path: SkPath; index: number; sweepPhase: SharedValue<number>; color: string; fade: number }) {
  const highlight = useDerivedValue(() => chevronHighlight(index, sweepPhase.value) * fade)
  return (
    <Group>
      <Path path={path} color={color} opacity={0.55 * fade} />
      <Group opacity={highlight}>
        <Path path={path} color='#FFFFFF' />
      </Group>
    </Group>
  )
}

// A rotated capsule (stadium shape — straight sides, fully rounded ends) standing in for a
// paddle/stick head, matching the crossed-stick dowels in the app icon: a round-ended rod of
// diameter `thickness` (the direction it's facing/pushing) and overall length `face`. Built as a
// raw path (not a Group+transform+origin) so it can be driven from a useDerivedValue during the
// strike swing — see strikingPaddlePath below — since an animated Vector `origin` isn't a shape
// this library's declarative props obviously support, while a recomputed SkPath already is (same
// technique as the chevrons above). The two end caps are hand-walked as line segments (rather
// than SkPath arc ops, which operate in unrotated local/world space) so every point can go
// through the same cos/sin rotation as the straight sides.
const PADDLE_CAP_SEGMENTS = 12

function paddlePath(cx: number, cy: number, angle: number, face: number, thickness: number): SkPath {
  'worklet'
  const capR = thickness / 2
  // Half-length of the straight run between the two caps — local y before rotation, wide along
  // local y and thin along local x, so at angle 0 (facing +x) this is a vertical rod whose round
  // ends point up/down and whose flat sides face the +x/-x direction it's meant to push toward.
  const straightHalf = Math.max(0, face / 2 - capR)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const path = Skia.Path.Make()
  let started = false
  const point = (lx: number, ly: number) => {
    const px = cx + lx * cos - ly * sin
    const py = cy + lx * sin + ly * cos
    if (!started) {
      path.moveTo(px, py)
      started = true
    } else {
      path.lineTo(px, py)
    }
  }

  point(capR, -straightHalf)
  point(capR, straightHalf)
  // Bottom cap: semicircle from (capR, straightHalf) to (-capR, straightHalf), bulging toward +y.
  for (let i = 1; i <= PADDLE_CAP_SEGMENTS; i++) {
    const t = (i / PADDLE_CAP_SEGMENTS) * Math.PI
    point(capR * Math.cos(t), straightHalf + capR * Math.sin(t))
  }
  point(-capR, -straightHalf)
  // Top cap: semicircle from (-capR, -straightHalf) to (capR, -straightHalf), bulging toward -y.
  for (let i = 1; i <= PADDLE_CAP_SEGMENTS; i++) {
    const t = (i / PADDLE_CAP_SEGMENTS) * Math.PI
    point(-capR * Math.cos(t), -straightHalf - capR * Math.sin(t))
  }
  path.close()
  return path
}

// The faceoff zone circles only ever come in this one pair per player — flipping between them is
// how the press ripple (see the pressFlash effect below) locates a WRONG-zone press, which always
// lands on whichever of a player's two zones ISN'T faceoff.zones[idx].
function otherZoneIndex(z: 0 | 1): 0 | 1 {
  return z === 0 ? 1 : 0
}

export interface BoardProps {
  board: BoardLayout
  puck: PuckState
  aim: AimIndicator | null
  phase: GamePhase
  currentPlayer: Player
  lastScoredGoal: 'top' | 'bottom' | null
  scores: [number, number]
  scoreToWin: number
  faceoff: FaceoffState | null
  // Perimeter walls (all four sides) — see game.tsx's isDesktopWeb. On a phone (native or mobile
  // web) they'd sit redundantly right against the device's own physical edge, which already reads
  // as the boundary; only desktop web, with no such edge, gets them.
  showWalls: boolean
  // How far the aim chevron trajectory preview may reach, in board-local pixels — resolved from
  // the round's ShotPreviewLength setting in game.tsx (see SHOT_PREVIEW_LENGTH_RATIOS), not here,
  // same as `friction` is resolved before reaching useGameState.
  previewLengthPx: number
}

export default function Board({ board, puck, aim, phase, currentPlayer, lastScoredGoal, scores, scoreToWin, faceoff, showWalls, previewLengthPx }: BoardProps) {
  const { x, y, width, height, goalLeft, goalRight, wallThickness, puckRadius, obstacles, gravityWells } = board

  const goalAbsLeft = x + goalLeft
  const goalAbsRight = x + goalRight
  const goalCX = x + width / 2

  const { colors: themeColors, dark } = useAutoPaperTheme()

  // Retro-vector palette: the board's structure (walls/obstacles) is the same literal
  // black/white-by-appearance foreground used elsewhere (index.tsx, game.tsx) rather than a themed
  // color — the box itself is neutral scaffolding, not a gameplay signal. Everything else that
  // isn't gameplay-signal color (a player's puck, the gravity wells' attract/repel accents) is a
  // flat neutral that flips with light/dark too — there's no filled board-surface panel anymore, so
  // the screen's own true-black/white background shows through and these neutrals have to read
  // against either.
  const wallColor = dark ? '#FFFFFF' : '#000000'
  const lineColor = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'
  const glowColor = dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.13)'
  const wellHoleColor = dark ? '#000000' : '#FFFFFF'

  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary
  // The shooting player's accent color — drives the ring (idle only), the real/phantom stick,
  // and the chevron trajectory. No longer the puck's own fill (see the black-fill puck below) or
  // theme/contrast-derived (the puck's ring is a literal white/player-color pair, even in light
  // mode), so this is purely an identity color for everything ELSE that reads "whose shot is this".
  const activePlayerColor = currentPlayer === 1 ? p1Color : p2Color

  // Kept as a shared value (not read directly as the plain `puckRadius` prop) so derived values
  // below stay current even if the board is resized (screen rotation, etc.) — same discipline as
  // maxRingR just below, hoisted up here so the pulse/ring derivations that follow can use it too.
  const puckRadiusSV = useSharedValue(puckRadius)
  puckRadiusSV.value = puckRadius

  // ─── Pulsing glow + ring (idle only) ──────────────────────────────────────
  // One driver (idlePulseT) for both the ambient glow radius and the ring's own pulse, so they
  // breathe in lockstep rather than as two independent effects. The ring recolors to
  // activePlayerColor and pulses only while genuinely "waiting for a shot" (idle) — every other
  // phase, aiming included, it's plain white and static (see ringColor/ringOpacity below and the
  // puck render further down), even in light mode.
  const idlePulseT = useSharedValue(0)

  useEffect(() => {
    if (phase === 'idle') {
      idlePulseT.value = 0
      idlePulseT.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(idlePulseT)
      idlePulseT.value = 0
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const glowR = useDerivedValue(() => puckRadiusSV.value * (phase === 'aiming' ? 1.45 : 1.3 + idlePulseT.value * 0.35))
  const ringColor = phase === 'idle' ? activePlayerColor : '#FFFFFF'
  const ringOpacity = useDerivedValue(() => (phase === 'idle' ? 0.65 + idlePulseT.value * 0.35 : 1))

  // ─── Gravity well particle clock ──────────────────────────────────────────
  // Decorative, independent of the physics loop — runs continuously regardless
  // of game phase, same "clock owned once by Board.tsx" idea as glowR above.
  const wellParticleProgress = useSharedValue(0)

  useEffect(() => {
    wellParticleProgress.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.linear }), -1, false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Goal celebration rings ───────────────────────────────────────────────
  // puckRadiusSV is hoisted above (shared with the glow/ring pulse) — keep maxRingR as a shared
  // value too so derived values stay current even if the board is resized (screen rotation, etc.).
  const maxRingR = useSharedValue(board.goalWidth * 0.85)
  maxRingR.value = board.goalWidth * 0.85

  const ring1P = useSharedValue(0)
  const ring2P = useSharedValue(0)
  const ring3P = useSharedValue(0)

  useEffect(() => {
    if (lastScoredGoal === null) return
    ring1P.value = 0
    ring2P.value = 0
    ring3P.value = 0
    ring1P.value = withTiming(1, { duration: 850, easing: Easing.out(Easing.cubic) })
    ring2P.value = withDelay(160, withTiming(1, { duration: 850, easing: Easing.out(Easing.cubic) }))
    ring3P.value = withDelay(320, withTiming(1, { duration: 850, easing: Easing.out(Easing.cubic) }))
  }, [lastScoredGoal]) // eslint-disable-line react-hooks/exhaustive-deps

  const ring1R = useDerivedValue(() => puckRadiusSV.value + ring1P.value * maxRingR.value)
  const ring2R = useDerivedValue(() => puckRadiusSV.value + ring2P.value * maxRingR.value)
  const ring3R = useDerivedValue(() => puckRadiusSV.value + ring3P.value * maxRingR.value)
  const ring1O = useDerivedValue(() => (1 - ring1P.value) * 0.75)
  const ring2O = useDerivedValue(() => (1 - ring2P.value) * 0.75)
  const ring3O = useDerivedValue(() => (1 - ring3P.value) * 0.75)

  const celebCY = lastScoredGoal === 'top' ? y : y + height
  const celebColor = lastScoredGoal === 'top' ? p2Color : p1Color

  // ─── Aim direction chevrons ────────────────────────────────────────────────
  // Now a power/bank-aware preview (previously deliberately NOT a simulated trajectory, to
  // preserve shot-banking skill/guessing — reversed per explicit design request). Reuses
  // computeTrajectory (utils/physics.ts) — already a fully-working bounce simulator, previously
  // only exercised by physics.test.ts — to get bounce waypoints, then walks/truncates that
  // polyline to `previewLengthPx` so the trail bends to follow a bank shot's post-bounce
  // direction only if the bounce falls within the settings-controlled preview length.
  // Pull-back aiming: the puck fires in the OPPOSITE direction from the drag (like a slingshot
  // or pool cue), so dx/dy point from the puck toward -drag, not toward the drag itself — this
  // is also computeAimVector/computeTrajectory's expected sign convention (they don't
  // re-negate), so reuse this exact dx/dy without flipping it again.
  const chevDx = aim ? aim.startX - aim.currentX : 0
  const chevDy = aim ? aim.startY - aim.currentY : 0
  const chevDragDist = Math.sqrt(chevDx * chevDx + chevDy * chevDy)
  const showChevrons = phase === 'aiming' && !!aim && chevDragDist >= MIN_SHOOT_DRAG
  const { power: chevPower } = computeAimVector(chevDx, chevDy, MAX_DRAG_PIXELS, MAX_SPEED)

  const chevronPlacements = useMemo(() => {
    if (!showChevrons) return [] as (SkPath | null)[]

    const waypoints = computeTrajectory(puck.x, puck.y, chevDx, chevDy, board, MAX_DRAG_PIXELS, MAX_SPEED, 3)
    const chevronWidth = puckRadius * 0.14
    const chevronDepth = puckRadius * 0.11
    const spacing = puckRadius * 0.55
    const startOffset = puckRadius * 1.7 // starts just past the puck's own edge/glow

    // Power controls how many chevrons appear (more pull = more chevrons); previewLengthPx is a
    // ceiling on how far they're allowed to reach. 'off' (previewLengthPx = 0) falls out for
    // free here — maxFitting becomes 0 and nothing renders, no special case needed.
    const maxFitting = Math.max(0, Math.floor((previewLengthPx - startOffset) / spacing) + 1)
    const powerCount = chevPower <= 0 ? 0 : Math.round(1 + chevPower * (MAX_AIM_CHEVRONS - 1))
    const activeCount = Math.min(MAX_AIM_CHEVRONS, maxFitting, powerCount)

    const placements: (SkPath | null)[] = []
    for (let i = 0; i < activeCount; i++) {
      const p = walkPolyline(waypoints, startOffset + i * spacing)
      if (!p) {
        placements.push(null)
        continue
      }
      // Small filled triangle (apex at p, pointing along the travel direction), not an open
      // stroked V — see ChevronMark's comment on why a fill reads better at this size.
      const px = -p.uy
      const py = p.ux
      const backX = p.x - p.ux * chevronDepth
      const backY = p.y - p.uy * chevronDepth
      const path = Skia.Path.Make()
      path.moveTo(p.x, p.y)
      path.lineTo(backX + px * chevronWidth, backY + py * chevronWidth)
      path.lineTo(backX - px * chevronWidth, backY - py * chevronWidth)
      path.close()
      placements.push(path)
    }
    return placements
  }, [showChevrons, puck.x, puck.y, puckRadius, chevDx, chevDy, board, previewLengthPx, chevPower])

  // Highlight sweep — travels through the chevrons at a rate tied to live power, without
  // restarting/jumping every time power changes mid-drag (a fixed-duration withRepeat/withTiming
  // can't smoothly re-rate; a per-frame accumulator can). chevronPowerSV is assigned directly
  // during render, same convention as puckRadiusSV/maxRingR above.
  const chevronPowerSV = useSharedValue(0)
  chevronPowerSV.value = chevPower

  const chevronSweepPhase = useSharedValue(0)
  const chevronFrame = useFrameCallback((info) => {
    'worklet'
    const dtSec = (info.timeSincePreviousFrame ?? 16.7) / 1000
    const rate = CHEVRON_SWEEP_BASE_RATE * Math.max(chevronPowerSV.value, CHEVRON_SWEEP_MIN_RATE_FACTOR)
    chevronSweepPhase.value = (chevronSweepPhase.value + dtSec * rate) % 1
  }, false)

  useEffect(() => {
    chevronFrame.setActive(phase === 'aiming')
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Goal crease / score arcs ──────────────────────────────────────────────
  // The crease doubles as the score meter: a half-circle outline bulging from each goal mouth
  // into the field, sized to the goal itself (radius = half the goal width) — but instead of one
  // continuous outline, it's split into `scoreToWin` equal arc segments (see computeGoalWedges),
  // one per point needed to win, each with a small gap (WEDGE_GAP_DEG, inset symmetrically within
  // its own slot) on either side so segments stay individually countable with no radial divider
  // lines needed. An unscored segment stays a faint neutral stroke; a scored one lights up solid
  // in that player's color — so the outline visibly builds up point by point and reads as a fully
  // solid ring exactly when that player wins. Plain open arcs (Skia's addArc, not closed back to
  // center) — no fill, just the outline itself, per the "just an outline" ask. Behind the arcs, a
  // static ambient tint (p1CreaseFill/p2CreaseFill below) fills the same half-disc at low opacity
  // — the ever-present "this is your goal" wash the crease always had, independent of score, that
  // the arcs alone would otherwise have dropped.
  const goalCreaseRadius = board.goalWidth / 2
  const WEDGE_GAP_DEG = 5

  // Player 1 always sits at the bottom (see board.ts's faceoffZoneCenters) — so p1's crease/
  // wedges are the ones anchored at y+height-r/baseAngle 180, and p2's at y-r/baseAngle 0.
  const p1CreaseFill = useMemo(() => {
    const r = goalCreaseRadius
    return Skia.PathBuilder.Make()
      .addArc({ x: goalCX - r, y: y + height - r, width: r * 2, height: r * 2 }, 180, 180)
      .close()
      .detach()
  }, [goalCX, y, height, goalCreaseRadius])

  const p2CreaseFill = useMemo(() => {
    const r = goalCreaseRadius
    return Skia.PathBuilder.Make()
      .addArc({ x: goalCX - r, y: y - r, width: r * 2, height: r * 2 }, 0, 180)
      .close()
      .detach()
  }, [goalCX, y, goalCreaseRadius])

  const p1Wedges = useMemo(() => {
    const r = goalCreaseRadius
    return computeGoalWedges(scoreToWin, 180).map(({ startAngle, sweepAngle }) =>
      Skia.PathBuilder.Make()
        .addArc({ x: goalCX - r, y: y + height - r, width: r * 2, height: r * 2 }, startAngle + WEDGE_GAP_DEG / 2, sweepAngle - WEDGE_GAP_DEG)
        .detach()
    )
  }, [goalCX, y, height, goalCreaseRadius, scoreToWin])

  const p2Wedges = useMemo(() => {
    const r = goalCreaseRadius
    return computeGoalWedges(scoreToWin, 0).map(({ startAngle, sweepAngle }) =>
      Skia.PathBuilder.Make()
        .addArc({ x: goalCX - r, y: y - r, width: r * 2, height: r * 2 }, startAngle + WEDGE_GAP_DEG / 2, sweepAngle - WEDGE_GAP_DEG)
        .detach()
    )
  }, [goalCX, y, goalCreaseRadius, scoreToWin])

  // ─── Rink faceoff circles ─────────────────────────────────────────────────
  // Mostly decorative — colored (with a center dot, like a real rink's faceoff dot) in whichever
  // player's half they sit in, so the "whose side" cue shows up a third time out in the open
  // "bare ice" between each crease and the center line. Two per half, mirrored left/right of
  // center — positions come from utils/board.ts's faceoffZoneCenters, the same source game.tsx's
  // 'coinFlip' puck placement and 'faceoff' tap hit-test both use, so this drawing can never drift
  // from where the puck actually lands or where a tap actually registers.
  const faceoffRadius = faceoffZoneRadius(board)
  // Small resting size the rest of the time; enlarged only while a draw is actually active
  // (faceoff !== null, i.e. for the whole 'faceoff' phase, not just the live moment — the web key
  // hint labels are up throughout) so it's big enough to sit under game.tsx's web-only key hint
  // label (a 24x24 "A"/"D"/"←"/"→" text box, see FACEOFF_KEY_HINTS) as its keycap background —
  // that label's own text color is contrast-computed against the *player's* color, not this dot,
  // but the dot needs to be large enough for that computed contrast to actually read against.
  // Reverts the instant the draw resolves and faceoff goes back to null, rather than staying
  // enlarged as the board's permanent resting look.
  const faceoffDotRadius = faceoffRadius * (faceoff !== null ? 0.32 : 0.08)
  // A toned-down wash of the player's color for the live background, not a full-saturation fill —
  // the ring/dot (always rendered, see the faceoffCenters.map() below) stay the visual accent on
  // top of it, rather than being swallowed by a solid disc.
  const faceoffLiveTintOpacity = 0.35
  const faceoffCenters: { cx: number; cy: number; color: string; player: Player; zoneIndex: 0 | 1 }[] = ([1, 2] as Player[]).flatMap((player) =>
    ([0, 1] as const).map((zoneIndex) => {
      const c = faceoffZoneCenter(board, player, zoneIndex)
      return { cx: c.x, cy: c.y, color: player === 1 ? p1Color : p2Color, player, zoneIndex }
    })
  )

  // ─── Face-off press-target pulse ──────────────────────────────────────────
  // BOTH of a player's two circles pulse identically during the countdown/hold — a player has to
  // watch both of their own options and can't rest a finger on a known spot ahead of time, since
  // they don't know yet which one (faceoff.zones, randomized fresh each draw — see
  // useGameState.ts) is about to go live. They pulse dim grey on each countdown tick (in step with
  // game.tsx's identical faceoff?.count-keyed haptic), hold steady through the randomized hold
  // that follows (no visual cue there, on purpose — see constants/game.ts), then the moment the
  // live window opens only the actual target snaps to that player's own color — the other reverts
  // to its plain decorative look. Reacting to WHICH one colors, not just WHEN, is the point (see
  // game.tsx's stableFaceoffZoneTap, which hit-tests taps against both of a player's circles and
  // only accepts the one matching faceoff.zones).
  const faceoffPulse = useSharedValue(0.2)
  useEffect(() => {
    if (!faceoff || faceoff.count === null) return
    faceoffPulse.value = 0.6
    faceoffPulse.value = withTiming(0.2, { duration: FACEOFF_COUNTDOWN_STEP_MS * 0.6, easing: Easing.out(Easing.quad) })
  }, [faceoff?.count]) // eslint-disable-line react-hooks/exhaustive-deps
  const faceoffLive = faceoff !== null && (faceoff.stage === 'live' || faceoff.stage === 'resolved')

  // ─── Face-off press ripple ────────────────────────────────────────────────
  // One progress value per PLAYER (not per zone) — a player only ever has one live press per draw
  // (see FaceoffState.pressFlash's idempotency), so which of their two zones it actually paints on
  // is captured once, at press time, into p1RippleZone/p2RippleZone below rather than needing a
  // second SharedValue per zone. Driven off faceoff.pressFlash — set on EVERY press, right or
  // wrong, and (unlike faceoff.count above) the only faceoff field that also covers a CPU press,
  // which never runs through game.tsx's own client-side tap feedback (see useFaceoff.ts). A plain
  // "value changed" check isn't enough here the way it is for faceoffPulse's count watcher above:
  // pressFlash also changes back to null at the start of every fresh draw (initialFaceoffState),
  // and that reset must NOT replay a ripple — so prevPressFlashRef exists specifically to tell "a
  // new press landed" (null -> a timestamp) apart from "a new draw began" (a timestamp -> null),
  // mirroring game.tsx's own prevFaceoffStageRef guard for the identical reason.
  //
  // WHICH zone to paint is captured into REACT STATE (not re-derived from the live `faceoff` prop
  // at render time) because a draw's own resolution nulls out `faceoff` almost immediately after —
  // useFaceoff.ts's "no announcement, no pause" resolved-to-knock handoff dispatches FACEOFF_LAUNCH
  // on the very next tick, and FACEOFF_LAUNCH sets `faceoff: null`. The press that WINS the draw is
  // exactly the one whose ripple would otherwise render for at most a frame before vanishing —
  // silently defeating the "see how fast they hit it" point for the single most interesting press
  // of the draw. Latching the target zone (and letting p1RippleProgress/p2RippleProgress keep
  // animating independently of `faceoff`'s own lifecycle) lets every ripple finish its full
  // FACEOFF_PRESS_RIPPLE_DURATION_MS regardless of how quickly the draw resolves afterward.
  const p1RippleProgress = useSharedValue(0)
  const p2RippleProgress = useSharedValue(0)
  const [p1RippleZone, setP1RippleZone] = useState<0 | 1 | null>(null)
  const [p2RippleZone, setP2RippleZone] = useState<0 | 1 | null>(null)
  const prevPressFlashRef = useRef<[number | null, number | null]>(faceoff?.pressFlash ?? [null, null])
  useEffect(() => {
    const prev = prevPressFlashRef.current
    const curr = faceoff?.pressFlash ?? [null, null]
    prevPressFlashRef.current = curr
    if (curr[0] !== null && curr[0] !== prev[0] && faceoff) {
      setP1RippleZone(faceoff.disqualified[0] ? otherZoneIndex(faceoff.zones[0]) : faceoff.zones[0])
      p1RippleProgress.value = 0
      p1RippleProgress.value = withTiming(1, { duration: FACEOFF_PRESS_RIPPLE_DURATION_MS, easing: Easing.out(Easing.cubic) })
    }
    if (curr[1] !== null && curr[1] !== prev[1] && faceoff) {
      setP2RippleZone(faceoff.disqualified[1] ? otherZoneIndex(faceoff.zones[1]) : faceoff.zones[1])
      p2RippleProgress.value = 0
      p2RippleProgress.value = withTiming(1, { duration: FACEOFF_PRESS_RIPPLE_DURATION_MS, easing: Easing.out(Easing.cubic) })
    }
  }, [faceoff?.pressFlash]) // eslint-disable-line react-hooks/exhaustive-deps

  const faceoffRippleExpand = faceoffRadius * 0.85
  const p1RippleR = useDerivedValue(() => faceoffRadius + p1RippleProgress.value * faceoffRippleExpand)
  const p2RippleR = useDerivedValue(() => faceoffRadius + p2RippleProgress.value * faceoffRippleExpand)
  const p1RippleO = useDerivedValue(() => (1 - p1RippleProgress.value) * 0.85)
  const p2RippleO = useDerivedValue(() => (1 - p2RippleProgress.value) * 0.85)

  // ─── Zone lines ───────────────────────────────────────────────────────────
  // A rink's blue-line equivalent: a bold full-width bar, in each player's own color, sitting
  // further out than the crease/faceoff circles but short of center — real blue lines sit about
  // 70% of the way from the goal line to center ice, hence the 0.72 fraction. Unlike the goal
  // crease/goal line (sized to the actual goal opening), this spans the full board width the
  // way a real blue line spans the full rink, so it reads as "this whole zone is yours" rather
  // than another marker for the goal itself.
  const zoneLineFraction = 0.72
  const p1ZoneLineY = y + height - (height / 2) * zoneLineFraction
  const p2ZoneLineY = y + (height / 2) * zoneLineFraction

  // ─── 'rink' perimeter (rounded corners) ───────────────────────────────────
  // A single continuous stroked path (centerline + strokeWidth=wallThickness, not 4 filled Rects
  // like the square-corner variants below) — the existing square-corner approach was deliberately
  // NOT extended to RoundedRect per-segment (see the comment on the plain-Rect block further down)
  // because independently-rounded segments left a visible notch where two pieces met; one
  // continuous path sidesteps that by construction. Built off the TRUE outer boundary (extended by
  // behindGoalDepth — see computeBoardLayout), not board.y/height, so the wall visually recedes
  // into the pocket depth near each goal rather than sitting flush at the front line. Uses the
  // same Skia.PathBuilder.addArc API the goal-crease arcs above already use.
  const rinkPerimeterPath = useMemo(() => {
    if (board.cornerRadius <= 0) return null
    const cr = board.cornerRadius
    const outerTop = y - board.behindGoalDepth
    const outerBottom = y + height + board.behindGoalDepth
    const left = x
    const right = x + width
    return Skia.PathBuilder.Make()
      .moveTo(left + cr, outerTop)
      .lineTo(goalAbsLeft, outerTop)
      .moveTo(goalAbsRight, outerTop)
      .lineTo(right - cr, outerTop)
      .addArc({ x: right - cr * 2, y: outerTop, width: cr * 2, height: cr * 2 }, 270, 90)
      .lineTo(right, outerBottom - cr)
      .addArc({ x: right - cr * 2, y: outerBottom - cr * 2, width: cr * 2, height: cr * 2 }, 0, 90)
      .lineTo(goalAbsRight, outerBottom)
      .moveTo(goalAbsLeft, outerBottom)
      .lineTo(left + cr, outerBottom)
      .addArc({ x: left, y: outerBottom - cr * 2, width: cr * 2, height: cr * 2 }, 90, 90)
      .lineTo(left, outerTop + cr)
      .addArc({ x: left, y: outerTop, width: cr * 2, height: cr * 2 }, 180, 90)
      .detach()
  }, [board.cornerRadius, board.behindGoalDepth, x, y, width, height, goalAbsLeft, goalAbsRight])

  // ─── Stick/paddle ─────────────────────────────────────────────────────────
  // While aiming, the paddle sits at puck position + drag offset rather than at the raw touch
  // point — a drag can now start anywhere on the board (see useGameState's tryAimStart), so
  // drawing it at the literal finger position could put it far from the puck entirely. Offset
  // from the puck instead, it always reads as "pulling back from the puck" regardless of where
  // the finger landed. Clamped to MAX_DRAG_PIXELS (the same distance that already maxes out shot
  // power in useGameState's shoot) so a drag spanning the whole screen doesn't visually fling the
  // paddle far past where pulling back any further stopped mattering.
  const paddleFace = puckRadius * 2.3
  const paddleThickness = puckRadius * 0.45

  const rawDragX = aim ? aim.currentX - aim.startX : 0
  const rawDragY = aim ? aim.currentY - aim.startY : 0
  const rawDragDist = Math.sqrt(rawDragX * rawDragX + rawDragY * rawDragY)
  const dragClampScale = rawDragDist > MAX_DRAG_PIXELS ? MAX_DRAG_PIXELS / rawDragDist : 1
  // + here, not -: useGameState's shoot() fires the puck along -drag (a slingshot pull), so the
  // pulled-back paddle itself belongs on the +drag side — the same side as the finger, opposite
  // the puck's eventual travel direction. Getting this backwards puts the paddle on the puck's
  // departure side instead of its pulled-back approach side.
  const stickX = puck.x + rawDragX * dragClampScale
  const stickY = puck.y + rawDragY * dragClampScale
  // Facing direction (paddle → puck) stays fixed for the whole swing below — neither stickX/Y nor
  // puck.x/y change again once 'striking' begins (the gesture already ended, and the puck itself
  // doesn't move until APPLY_STRIKE), so recomputing this every render is cheap and stable, unlike
  // deriving it from the animating strikeX/Y themselves (which would degenerate as they approach
  // the contact point below).
  const stickAngle = Math.atan2(puck.y - stickY, puck.x - stickX)
  const aimingPaddlePath = paddlePath(stickX, stickY, stickAngle, paddleFace, paddleThickness)

  // The swing stops with the paddle's face just touching the puck's edge, not centered on top of
  // it — a paddle that ended concentric with the puck would read as a ring sitting on/around it
  // rather than a collision. `puckRadius + paddleThickness / 2` is the distance between the two
  // shapes' centers at the moment their edges meet.
  const contactDist = puckRadius + paddleThickness / 2
  const contactX = puck.x - Math.cos(stickAngle) * contactDist
  const contactY = puck.y - Math.sin(stickAngle) * contactDist

  // On release, the paddle swings from the pulled-back spot to that contact point over
  // STRIKE_DURATION_MS (see useGameState/game.tsx) — captured once per swing, not re-triggered by
  // later renders.
  const strikeX = useSharedValue(0)
  const strikeY = useSharedValue(0)

  useEffect(() => {
    if (phase !== 'striking' || !aim) return
    strikeX.value = stickX
    strikeY.value = stickY
    strikeX.value = withTiming(contactX, { duration: STRIKE_DURATION_MS, easing: Easing.in(Easing.cubic) })
    strikeY.value = withTiming(contactY, { duration: STRIKE_DURATION_MS, easing: Easing.in(Easing.cubic) })
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const strikingPaddlePath = useDerivedValue(() => paddlePath(strikeX.value, strikeY.value, stickAngle, paddleFace, paddleThickness))

  // Phantom paddle faces the phantom puck (aim.startX/Y, your original touch-down point) the same
  // way the real paddle faces the real puck — at the raw, unclamped finger position, distinct
  // from the real paddle's clamped stickX/Y.
  const phantomStickAngle = aim ? Math.atan2(aim.startY - aim.currentY, aim.startX - aim.currentX) : 0
  const phantomPaddlePath = aim ? paddlePath(aim.currentX, aim.currentY, phantomStickAngle, paddleFace, paddleThickness) : null

  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Goal crease background tint — see the useMemo above */}
        <Group opacity={0.28}>
          <Path path={p1CreaseFill} color={p1Color} />
          <Path path={p2CreaseFill} color={p2Color} />
        </Group>

        {/* Score arcs — see the useMemo above */}
        {p1Wedges.map((path, i) => (
          <Path key={`p1-wedge-${i}`} path={path} style='stroke' strokeWidth={2.5} strokeCap='round' color={i < scores[0] ? p1Color : lineColor} />
        ))}
        {p2Wedges.map((path, i) => (
          <Path key={`p2-wedge-${i}`} path={path} style='stroke' strokeWidth={2.5} strokeCap='round' color={i < scores[1] ? p2Color : lineColor} />
        ))}

        {/* Rink faceoff circles — see the comment above. The ring + center dot are permanent
            chrome, present in every state exactly alike (idle, pulsing, live) — only a background
            fill behind them changes: none when idle, a dim pulsing wash while counting down/
            holding, or a muted "container" tint (faceoffLiveTintOpacity — a toned-down wash of
            the player's own color, not a full-saturation fill) the instant this is the live
            target. Keeping the ring/dot constant is what makes the background read as a state
            change rather than a different decoration replacing it. */}
        {faceoffCenters.map((c, i) => {
          const isChosen = faceoff !== null && faceoff.zones[c.player - 1] === c.zoneIndex
          const live = faceoffLive && isChosen
          const pulsing = faceoff !== null && (faceoff.stage === 'countdown' || faceoff.stage === 'hold')
          // Ready-check (game's first draw only — see FaceoffState's doc comment): that player's
          // ring brightens to full opacity the moment they signal ready, the plainest possible
          // "you're set, waiting on the other player" cue, reverting to the normal dim ring once
          // the countdown actually starts.
          const isReady = faceoff !== null && faceoff.stage === 'ready' && faceoff.ready[c.player - 1]
          // Which of this player's two zones their press ripple belongs on — latched into
          // p1RippleZone/p2RippleZone at press time (see the pressFlash effect above), NOT
          // re-derived from the live faceoff.zones/disqualified here, so the ripple survives
          // faceoff going null when the draw resolves (see that effect's comment for why). Reading
          // it fresh from `faceoff` here would also reintroduce the exact bug the latching was
          // added to fix: faceoff.disqualified defaults to false and faceoff.zones is populated
          // from the start of the draw, so an ungated re-derivation would resolve to the CORRECT
          // zone the instant the draw begins — long before either player has pressed anything —
          // silently revealing the answer before the intended 'live' flash.
          const pressedZoneIndex = c.player === 1 ? p1RippleZone : p2RippleZone
          const showRipple = pressedZoneIndex === c.zoneIndex
          const rippleR = c.player === 1 ? p1RippleR : p2RippleR
          const rippleO = c.player === 1 ? p1RippleO : p2RippleO
          return (
            <Group key={i}>
              {pulsing && (
                <Group opacity={faceoffPulse}>
                  <Circle cx={c.cx} cy={c.cy} r={faceoffRadius} color={wallColor} />
                </Group>
              )}
              {live && (
                <Group opacity={faceoffLiveTintOpacity}>
                  <Circle cx={c.cx} cy={c.cy} r={faceoffRadius} color={c.color} />
                </Group>
              )}
              <Group opacity={isReady ? 1 : 0.45}>
                <Circle cx={c.cx} cy={c.cy} r={faceoffRadius} style='stroke' strokeWidth={1.5} color={c.color} />
              </Group>
              <Circle cx={c.cx} cy={c.cy} r={faceoffDotRadius} color={c.color} />
              {showRipple && (
                <Group opacity={rippleO}>
                  <Circle cx={c.cx} cy={c.cy} r={rippleR} style='stroke' strokeWidth={2.5} color={c.color} />
                </Group>
              )}
            </Group>
          )
        })}

        {/* Zone lines — see the comment above */}
        <Group opacity={0.5}>
          <Line p1={vec(x, p1ZoneLineY)} p2={vec(x + width, p1ZoneLineY)} color={p1Color} strokeWidth={4} />
          <Line p1={vec(x, p2ZoneLineY)} p2={vec(x + width, p2ZoneLineY)} color={p2Color} strokeWidth={4} />
        </Group>

        {/* Goal lines — full board width like a real rink's goal line, in each player's own
            color, but broken across the actual goal opening (matching the perimeter walls'
            own gap below) so the line itself marks exactly where the goal's edges are. */}
        <Line p1={vec(x, y)} p2={vec(goalAbsLeft, y)} color={p2Color} strokeWidth={2} />
        <Line p1={vec(goalAbsRight, y)} p2={vec(x + width, y)} color={p2Color} strokeWidth={2} />
        <Line p1={vec(x, y + height)} p2={vec(goalAbsLeft, y + height)} color={p1Color} strokeWidth={2} />
        <Line p1={vec(goalAbsRight, y + height)} p2={vec(x + width, y + height)} color={p1Color} strokeWidth={2} />

        {/* Perimeter walls — same solid, neutral wallColor style as the center divider below (not
            a themed/player color — the box itself is scaffolding, not a gameplay signal), so the
            whole structure reads as one piece built from the same material. They sit flush
            against the play field's boundary but extend outward from it (not inward, which would
            eat into gameplay space). Desktop-web only — see BoardProps. Square corners (plain
            Rect, not RoundedRect) — independently-rounded segments left a small rounded notch
            where two walls met at a boundary corner instead of a clean square joint. */}
        {showWalls && rinkPerimeterPath && <Path path={rinkPerimeterPath} style='stroke' strokeWidth={wallThickness} strokeCap='round' color={wallColor} />}
        {showWalls && !rinkPerimeterPath && (
          <>
            <Rect x={x - wallThickness} y={y - wallThickness} width={wallThickness} height={height + wallThickness * 2} color={wallColor} />
            <Rect x={x + width} y={y - wallThickness} width={wallThickness} height={height + wallThickness * 2} color={wallColor} />
            <Rect x={x} y={y - wallThickness} width={goalAbsLeft - x} height={wallThickness} color={wallColor} />
            <Rect x={goalAbsRight} y={y - wallThickness} width={x + width - goalAbsRight} height={wallThickness} color={wallColor} />
            <Rect x={x} y={y + height} width={goalAbsLeft - x} height={wallThickness} color={wallColor} />
            <Rect x={goalAbsRight} y={y + height} width={x + width - goalAbsRight} height={wallThickness} color={wallColor} />
          </>
        )}

        {/* Obstacles */}
        {obstacles.map((obs, i) => (
          <Rect key={i} x={obs.x} y={obs.y} width={obs.width} height={obs.height} color={wallColor} />
        ))}

        {/* Gravity wells */}
        {gravityWells.map((well, i) => (
          <GravityWellMarker key={i} x={well.x} y={well.y} holeRadius={well.radius} attracting={well.strength >= 0} progress={wellParticleProgress} foreground={well.strength >= 0 ? COLORS.wellAttract : COLORS.wellRepel} background={wellHoleColor} />
        ))}

        {/* Aim direction chevrons — dashed trail (base color + a brighter sweeping highlight per
            chevron, see ChevronMark above) bending to follow a bank shot's post-bounce direction
            wherever previewLengthPx reaches far enough to reveal it. */}
        {chevronPlacements.map((path, i) => path && <ChevronMark key={i} path={path} index={i} sweepPhase={chevronSweepPhase} color={activePlayerColor} fade={chevronFade(i, chevronPlacements.length)} />)}

        {/* Phantom paddle + phantom puck — a drag-distance indicator distinct from the real
            paddle/puck below: the phantom puck stays anchored at the exact point you first
            touched down (aim.startX/Y), the phantom paddle follows your live, unclamped finger
            position (aim.currentX/Y), facing back toward the phantom puck and trailing further
            from it the harder you pull. Releasing back near the phantom puck is releasing near
            your own start point, which already cancels the shot via MIN_SHOOT_DRAG in
            useGameState's shoot() — this is a pure visual for that existing rule, no
            gameplay-logic changes needed. Not player-colored on the puck side — it's a position
            marker, not a turn indicator. */}
        {phantomPaddlePath && <Path path={phantomPaddlePath} color={activePlayerColor} opacity={0.35} />}
        {phase === 'aiming' && aim && (
          <Group opacity={0.3}>
            <Circle cx={aim.startX} cy={aim.startY} r={puckRadius} color='#000000' />
            <Circle cx={aim.startX} cy={aim.startY} r={puckRadius} style='stroke' strokeWidth={2} color='#FFFFFF' />
          </Group>
        )}

        {/* Paddle — a solid rotated mallet head (see paddlePath above), not a ring: sits at the
            pulled-back finger position facing the puck while aiming, then swings in to strike the
            puck's edge (see contactX/Y above) once released. */}
        {phase === 'aiming' && aim && <Path path={aimingPaddlePath} color={activePlayerColor} />}
        {phase === 'striking' && <Path path={strikingPaddlePath} color={activePlayerColor} />}

        {/* Puck (+ glow, ring) — on 'rink' boards only (behindGoalDepth > 0), clipped to the
            front-line play rectangle so a puck that's crossed into a goal or a corner pocket
            visually slides into a slot and disappears, the "portal" effect standing in for real,
            visible board depth behind the net (see behindGoalDepth's own comment in
            utils/board.ts — the depth is physically necessary for correct collision, but the clip
            is what keeps it from ever actually being seen). A no-op clip on every other variant,
            so no separate unclipped branch is needed. */}
        <Group clip={board.behindGoalDepth > 0 ? Skia.XYWHRect(x, y, width, height) : undefined}>
          {/* Puck glow */}
          {(phase === 'idle' || phase === 'aiming') && <Circle cx={puck.x} cy={puck.y} r={glowR} color={glowColor} />}

          {/* Puck — always a flat black fill, in every phase and regardless of theme. The ring
              recolors to activePlayerColor and pulses only while waiting for a shot (idle); every
              other phase it's a plain, literal white — see idlePulseT/ringColor/ringOpacity above. */}
          <Circle cx={puck.x} cy={puck.y} r={puckRadius} color='#000000' />
          <Group opacity={ringOpacity}>
            <Circle cx={puck.x} cy={puck.y} r={puckRadius} style='stroke' strokeWidth={2} color={ringColor} />
          </Group>
        </Group>

        {/* Celebration rings */}
        {lastScoredGoal !== null && (
          <Group>
            <Group opacity={ring1O}>
              <Circle cx={goalCX} cy={celebCY} r={ring1R} style='stroke' strokeWidth={2.5} color={celebColor} />
            </Group>
            <Group opacity={ring2O}>
              <Circle cx={goalCX} cy={celebCY} r={ring2R} style='stroke' strokeWidth={2} color={celebColor} />
            </Group>
            <Group opacity={ring3O}>
              <Circle cx={goalCX} cy={celebCY} r={ring3R} style='stroke' strokeWidth={1.5} color={celebColor} />
            </Group>
          </Group>
        )}
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
