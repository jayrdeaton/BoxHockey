import { useAutoPaperTheme } from '@rific/auto-paper'
import { Canvas, Circle, Group, Line, Path, Rect, Skia, SkPath, vec } from '@shopify/react-native-skia'
import { GoalDoorFlash, ScoreWedges, ZoneLine } from '@tastic/sprites/hockey'
import { CelebrationRings, Disc, GoalPost, ObstacleRect } from '@tastic/sprites/shapes'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { cancelAnimation, Easing, interpolateColor, SharedValue, useDerivedValue, useFrameCallback, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

import { COIN_FLIP_BASE_HALF_TURNS, COIN_FLIP_FADE_MS, COIN_FLIP_HOLD_MS, COIN_FLIP_MIN_SCALE_X, COIN_FLIP_SPIN_MS, COIN_FLIP_TRAVEL_MS, COLORS, CONTROL_SCHEME_SIGN, FACEOFF_COUNTDOWN_STEP_MS, FACEOFF_PRESS_RIPPLE_DURATION_MS, GOAL_BOARD_FLASH_DECAY_MS, GOAL_BOARD_FLASH_PEAK_OPACITY, GOAL_CREASE_FLASH_PEAK_OPACITY, GOAL_LINE_STROKE_WIDTH, GOAL_WEDGE_FLASH_FINAL_BLINKS, GOAL_WEDGE_FLASH_FINAL_MS, GOAL_WEDGE_FLASH_SEG_MS, GOAL_WEDGE_FLASH_STEP_MS, GOAL_WEDGE_SWEEP_BUDGET_MS, MAX_FLICK_VELOCITY, MAX_SPEED, MAX_STICK_PULLBACK_PIXELS, MIN_FLICK_VELOCITY, MIN_SHOOT_DRAG, PUCK_BURST_DURATION_MS, PUCK_BURST_MAX_DIST_RATIO, PUCK_BURST_SHARD_COUNT, PUCK_SCORE_FADE_DELAY_MS, PUCK_SCORE_FADE_MS, STRIKE_DURATION_MS, TRIPLE_TAP_SWIPE_FLASH_DURATION_MS } from '@/constants/game'
import { AimIndicator, BoardLayout, ControlScheme, FaceoffState, GamePhase, Player, PuckState, ShotPreviewLength, TripleTapState } from '@/types'
import { faceoffZoneCenter, faceoffZoneRadius, tripleTapZoneCenter, tripleTapZoneRadius } from '@/utils/board'
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
// Width (in raw drag pixels) of the opacity ramp the stick/front-arrow cross-fade through around
// MIN_SHOOT_DRAG (see cancelZoneFadeOpacity below) — replaces a hard pop-in/out right at that
// boundary with a short fade, still fully transparent through most of the cancel zone and fully
// opaque once genuinely past it.
const CANCEL_ZONE_FADE_PX = 16
// Velocity-space counterpart to CANCEL_ZONE_FADE_PX above (points/sec) — the same cross-fade
// treatment around MIN_FLICK_VELOCITY now that the cancel zone is a dual gate (distance AND
// velocity, see cancelZoneFadeOpacity below). First-pass value.
const CANCEL_ZONE_VELOCITY_FADE_UNITS = 80
// Flip to true locally to see the rink pocket setting's true collision curve (corners +
// behind-goal pocket) while tuning cornerRadius/behindGoalDepth in computeBoardLayout — off by
// default, since normal play deliberately draws nothing back there (see rinkPerimeterPath's own
// comment below).
const SHOW_RINK_DEBUG_PERIMETER = false

// Coin-flip spin-growth sub-timing (see the coin flip section below) — how long the coin takes to
// swell up to its peak size, how long it lingers there, and (implicitly, as whatever's left of
// COIN_FLIP_SPIN_MS + COIN_FLIP_HOLD_MS) how long it takes to settle back down to resting size
// before the fade begins. Local to this file (unlike COIN_FLIP_SPIN_MS etc.) since game.tsx's own
// auto-advance timer only cares about the spin's total duration, never this internal curve.
const COIN_FLIP_GROW_UP_MS = 400
const COIN_FLIP_GROW_HOLD_MS = 200
const COIN_FLIP_GROW_DOWN_MS = Math.max(0, COIN_FLIP_SPIN_MS + COIN_FLIP_HOLD_MS - COIN_FLIP_GROW_UP_MS - COIN_FLIP_GROW_HOLD_MS)

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

// Distance along the ray (startX,startY) + t*(ux,uy) until it first exits the board's play-field
// rectangle (left/right/top/bottom) — a plain slab/AABB raycast, only ever dividing on the axis
// the ray actually heads toward (a ray running exactly parallel to an axis, ux or uy === 0, just
// leaves that axis at Infinity rather than dividing by zero). Used by the front power arrow to
// clamp its tip at the wall instead of drawing straight through it — see its own comment.
function rayDistanceToBoardEdge(startX: number, startY: number, ux: number, uy: number, left: number, right: number, top: number, bottom: number): number {
  let dist = Infinity
  if (ux > 0) dist = Math.min(dist, (right - startX) / ux)
  else if (ux < 0) dist = Math.min(dist, (left - startX) / ux)
  if (uy > 0) dist = Math.min(dist, (bottom - startY) / uy)
  else if (uy < 0) dist = Math.min(dist, (top - startY) / uy)
  return dist
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

// One highlight overlay per wedge in the just-scored player's build-up sequence — same
// component-per-item/single-shared-clock trick as ChevronMark above, for the same reason: how
// many segments need a highlight varies goal to goal (0..scoreToWin-1, up to 9), so a fixed set
// of hook calls (fine for ring1P/ring2P/ring3P, a hardcoded 3) can't work here. clockMs is one
// shared "elapsed ms since this sweep started" driver; startMs/durationMs is this wedge's own
// window within it. color interpolates resting color -> white -> back so the flash reads as
// "brighter", not just "more opaque over itself" (opacity alone would be a no-op against an
// identical base color).
// `raw` is the 0..1 intensity curve. Without blinkCount it's the original instant-peak/eased-decay
// shape (matches faceoffPulse) used for the earlier build-up steps. With blinkCount set (the
// just-earned final segment only — see the render site) it instead oscillates blinkCount times via
// abs(sin(...)) before landing at 0 — "flash a couple times before settling on the score," per
// explicit request — the (1 - t) envelope makes each successive blink dimmer than the last so it
// reads as settling rather than cutting off abruptly.
function WedgeFlashOverlay({ path, clockMs, startMs, durationMs, peakOpacity, color, blinkCount }: { path: SkPath; clockMs: SharedValue<number>; startMs: number; durationMs: number; peakOpacity: number; color: string; blinkCount?: number }) {
  const raw = useDerivedValue(() => {
    const t = (clockMs.value - startMs) / durationMs
    if (t < 0 || t >= 1) return 0
    return blinkCount ? Math.abs(Math.sin(t * Math.PI * blinkCount)) * (1 - t) : (1 - t) * (1 - t)
  })
  const flashColor = useDerivedValue(() => interpolateColor(raw.value, [0, 1], [color, '#FFFFFF']))
  const flashOpacity = useDerivedValue(() => raw.value * peakOpacity)
  return (
    <Group opacity={flashOpacity}>
      <Path path={path} style='stroke' strokeWidth={2.5} strokeCap='round' color={flashColor} />
    </Group>
  )
}

// One shard per particle in the puck's departure burst ("explode, or fade out, or something" per
// explicit request) — same component-per-item/single-shared-clock trick as WedgeFlashOverlay
// above, driven by one shared `progress` (0..1) common to every shard in the burst. Each shard
// flies outward at its own fixed angle (evenly spaced around the puck, computed once at render
// site) from (cx, cy) — the puck's own resting position at the moment it scored — shrinking and
// fading as it travels, landing at fully transparent exactly as progress reaches 1 so nothing is
// left behind once the burst finishes.
function PuckShard({ cx, cy, angleRad, maxDist, radius, color, progress }: { cx: number; cy: number; angleRad: number; maxDist: number; radius: number; color: string; progress: SharedValue<number> }) {
  const shardCx = useDerivedValue(() => cx + Math.cos(angleRad) * maxDist * progress.value)
  const shardCy = useDerivedValue(() => cy + Math.sin(angleRad) * maxDist * progress.value)
  const shardR = useDerivedValue(() => radius * (1 - progress.value * 0.6))
  const shardO = useDerivedValue(() => 1 - progress.value)
  return <Circle cx={shardCx} cy={shardCy} r={shardR} color={color} opacity={shardO} />
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
  // Merged by game.tsx from state.aim ?? state.interceptAim — non-null during a normal 'aiming'/
  // 'striking' turn OR a mid-slide intercept drag (see isIntercepting below for telling those apart).
  aim: AimIndicator | null
  phase: GamePhase
  currentPlayer: Player
  // Whichever player's paddle/chevrons/ControlScheme should currently render — normally equal to
  // currentPlayer, but during the interceptable window (see puckInterceptable) or an active
  // intercept drag (isIntercepting) it's the RECEIVING player instead, since currentPlayer itself
  // doesn't flip until the interceptor's shot actually lands (see useGameState.ts's STRIKE case).
  aimingPlayer: Player
  // True only once a mid-slide intercept drag has actually started (GameState.interceptAim !==
  // null) — distinct from puckInterceptable (which can be true before anyone has touched
  // anything). Needed because `aim` alone can't tell "live aiming/intercept drag" apart from the
  // brief 'striking' windup that follows EVERY shot: STRIKE deliberately keeps `aim` non-null
  // through 'striking' (see its own comment) for the paddle-swing visual at line ~1164 below, so
  // treating aim-truthiness alone as "show the drag UI" would wrongly resurrect the phantom
  // marker/chevrons/aiming-paddle during that windup for every ordinary shot, not just intercepts.
  isIntercepting: boolean
  // True whenever the puck's own speed has dropped into the interceptable band (see
  // InterceptSpeed in types/index.ts) — independent of whether anyone has touched it yet. Drives
  // the discoverability cue (the idle-style ring/glow recoloring to aimingPlayer) so a human has
  // some signal the puck has become grabbable before they try dragging it.
  puckInterceptable: boolean
  lastScoredGoal: 'top' | 'bottom' | null
  scores: [number, number]
  scoreToWin: number
  // Same "counter + kind" shape as useGameState's own wellEnterCount/lastWellPolarity — bumped
  // whenever the puck struck the invisible one-way goal-mouth door (rink-on only). Drives the
  // goal-door flash below; never resets between rounds, so the flash effect diffs against a ref
  // rather than expecting a return to 0.
  goalDoorHitCount: number
  lastGoalDoorSide: 'top' | 'bottom' | null
  faceoff: FaceoffState | null
  tripleTap: TripleTapState | null
  // The ACTIVE (currently aiming) player's own pull/push preference — see ControlScheme in
  // types/index.ts. Just the one resolved value, not the whole per-player record: only whoever's
  // actually aiming right now can affect the stick/chevron rendering below, so game.tsx resolves
  // `roundSettings.controlScheme[currentPlayer]` once before passing it down.
  controlScheme: ControlScheme
  // The coin-flip ceremony (phase === 'coinFlip', see the section below) waits on a tap before it
  // plays at all — this flips true the instant that tap lands (see game.tsx's coinFlipStarted) and
  // stays true for the rest of that draw.
  coinFlipStarted: boolean
  // Perimeter walls (all four sides) — see game.tsx's isDesktopWeb. On a phone (native or mobile
  // web) they'd sit redundantly right against the device's own physical edge, which already reads
  // as the boundary; only desktop web, with no such edge, gets them.
  showWalls: boolean
  // How far the aim chevron trajectory preview may reach, in board-local pixels — resolved from
  // the round's ShotPreviewLength setting in game.tsx (see SHOT_PREVIEW_LENGTH_RATIOS), not here,
  // same as `friction` is resolved before reaching useGameState.
  previewLengthPx: number
  // The round's own ShotPreviewLength tier, unresolved — previewLengthPx alone can't tell 'off'
  // apart from 'short' vs 'medium'/'long' the way this component's aim indicators now need to (see
  // the stick/front-arrow/chevron-trail visibility gates further down): 'off' shows NOTHING (not
  // even the stick — "just feel it"), 'short' shows the stick + front power arrow (no trail, since
  // previewLengthPx at 'short' essentially never reaches a wall anyway), 'medium'/'long' show the
  // stick + the real bounce-aware chevron trail (no arrow — the trail is strictly more informative
  // once it's actually long enough to show something).
  shotPreviewLength: ShotPreviewLength
  // Real per-round deceleration (FRICTION_LEVELS[roundSettings.friction], resolved in game.tsx same
  // as previewLengthPx above) — fed into computeTrajectory so the chevron trail decays at the same
  // rate the real shot will, rather than a fixed approximation. Only affects the trajectory preview;
  // the puck's own real motion is still driven by useGameState/stepPhysics, never by this component.
  friction: number
}

export default function Board({ board, puck, aim, phase, currentPlayer, aimingPlayer, isIntercepting, puckInterceptable, lastScoredGoal, scores, scoreToWin, goalDoorHitCount, lastGoalDoorSide, faceoff, tripleTap, controlScheme, coinFlipStarted, showWalls, previewLengthPx, shotPreviewLength, friction }: BoardProps) {
  const { x, y, width, height, goalLeft, goalRight, wallThickness, puckRadius, obstacles, gravityWells, goalPosts, wallPosts } = board

  const goalAbsLeft = x + goalLeft
  const goalAbsRight = x + goalRight
  const goalCX = x + width / 2

  // How far the Canvas needs to bleed above its own container's top edge so nothing sitting at
  // the true y=0 boundary — the goal line/posts drawn centered on it, or a puck legitimately
  // still mid-crossing when it scores (stepPhysics requires its whole body clear the line first,
  // see the puck-render comment below) — gets its outward half silently clipped by the canvas's
  // own bounds. Only needed when Settings.rink is off: `boardArea`'s marginTop in game.tsx
  // reserves insets.top as a hard boundary with zero slack above it in that case (unlike the
  // bottom edge, which already has generous accidental slack — `boardArea`/`container` are both
  // `flex: 1` with no matching bottom inset reservation, so the canvas already extends well past
  // y+height for free). When rink is on, board.boardMarginTop already shrinks by however much
  // depth was borrowed into the inset (see computeBoardLayout's topBorrow), so the container is
  // already taller up top by exactly that much — no extra bleed needed on top of that. Sized off
  // the same `puckRadius * 2.5` a scoring puck needs to fully clear the line (see
  // computeBoardLayout's behindGoalDepth comment) — the same physical question, just answered for
  // canvas bounds instead of collision depth.
  const topBleed = board.behindGoalDepth === 0 ? puckRadius * 2.5 : 0
  const topBleedStyle = { top: -topBleed }

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

  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary
  // The shooting player's accent color — drives the ring (idle only), the real/phantom stick,
  // and the chevron trajectory. No longer the puck's own fill (see the black-fill puck below) or
  // theme/contrast-derived (the puck's ring is a literal white/player-color pair, even in light
  // mode), so this is purely an identity color for everything ELSE that reads "whose shot is this".
  const activePlayerColor = aimingPlayer === 1 ? p1Color : p2Color

  // Sign applied to the raw drag vector below to get the actual shot direction — see
  // CONTROL_SCHEME_SIGN and ControlScheme's own doc comment. 'pull' fires opposite the drag
  // (-1, slingshot); 'push' fires along it (+1, swipe/flick). Everything downstream (chevrons,
  // stick position) derives from this one value rather than re-branching on controlScheme itself.
  const shootSign = CONTROL_SCHEME_SIGN[controlScheme]

  // Kept as a shared value (not read directly as the plain `puckRadius` prop) so derived values
  // below (glowR's idle/aiming pulse) stay current even if the board is resized (screen rotation,
  // etc.), hoisted up here so those derivations can use it too. Mirrored via useLayoutEffect, not
  // assigned directly during render — Reanimated's strict mode flags writing to `.value` mid-render
  // (it fired on every single frame this was live, since Board re-renders every physics tick during
  // 'simulating'/'striking'), and useLayoutEffect corrects the value before paint just like
  // strikeX/Y's own layout effect below, so there's no stale-frame flash from deferring to a plain
  // useEffect instead.
  const puckRadiusSV = useSharedValue(puckRadius)
  useLayoutEffect(() => {
    puckRadiusSV.value = puckRadius
  }, [puckRadius]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Pulsing glow + ring (idle, or the interceptable window) ──────────────
  // One driver (idlePulseT) for both the ambient glow radius and the ring's own pulse, so they
  // breathe in lockstep rather than as two independent effects. The ring recolors to
  // activePlayerColor and pulses while "waiting for a shot" (idle) OR while the puck has slowed
  // into the interceptable band (puckInterceptable — see its own doc comment on BoardProps: this
  // is the only signal a human gets that the puck has become grabbable before they touch it) —
  // every other phase, aiming included, it's plain white and static (see ringColor/ringOpacity
  // below and the puck render further down), even in light mode.
  const idlePulseT = useSharedValue(0)
  const showIdlePulse = phase === 'idle' || puckInterceptable

  useEffect(() => {
    if (showIdlePulse) {
      idlePulseT.value = 0
      idlePulseT.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(idlePulseT)
      idlePulseT.value = 0
    }
  }, [showIdlePulse]) // eslint-disable-line react-hooks/exhaustive-deps

  // isIntercepting also counts as "aiming-sized" here, alongside phase === 'aiming' — an active
  // intercept drag never sets phase to 'aiming' (see GameState.interceptAim's own doc comment on
  // why phase deliberately stays 'simulating' throughout), so checking phase alone would miss it.
  const isAimingSized = phase === 'aiming' || isIntercepting
  const glowR = useDerivedValue(() => puckRadiusSV.value * (isAimingSized ? 1.45 : 1.3 + idlePulseT.value * 0.35))
  const ringColor = showIdlePulse ? activePlayerColor : '#FFFFFF'
  const ringOpacity = useDerivedValue(() => (showIdlePulse ? 0.65 + idlePulseT.value * 0.35 : 1))

  // ─── Gravity well particle clock ──────────────────────────────────────────
  // Decorative, independent of the physics loop — runs continuously regardless
  // of game phase, same "clock owned once by Board.tsx" idea as glowR above.
  const wellParticleProgress = useSharedValue(0)

  useEffect(() => {
    wellParticleProgress.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.linear }), -1, false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Goal celebration rings ───────────────────────────────────────────────
  // Now the shared @tastic/sprites/shapes CelebrationRings component (see its render further down)
  // — it owns the ring1P/2P/3P timing/radius/opacity derivation internally (confirmed byte-for-byte
  // identical 850/160/320ms timings, 0.75 peak opacity, 2.5/2/1.5 stroke widths), keyed off
  // lastScoredGoal itself as its triggerKey ('top'/'bottom' fit its string|number|null type
  // directly). celebCY/celebColor stay local — still needed as CelebrationRings' own x/y/color
  // props, and reused below by the edge-flash/wedge-flash celebration overlays too.
  const celebCY = lastScoredGoal === 'top' ? y : y + height
  const celebColor = lastScoredGoal === 'top' ? p2Color : p1Color

  // ─── Goal door flash (puck hit the invisible one-way door at the goal mouth, rink-on only) ──
  // Now the shared @tastic/sprites/hockey GoalDoorFlash component (see its render further down) —
  // it owns the goalDoorHitCount/lastGoalDoorSide-driven two-layer glow+core animation internally
  // (confirmed byte-for-byte identical to this app's own prior GOAL_DOOR_FLASH_* constants), so no
  // local SharedValues/useEffect/useDerivedValue are needed here anymore.

  // ─── Goal celebration: full-board flash ───────────────────────────────────
  // Translucent wash across the play field, celebColor (same defender's-color identity as the
  // rings), same spike-then-decay shape as faceoffPulse. Peak kept low (0.22) so puck/paddle/walls
  // stay legible through it — this is a punch, not a whiteout.
  const boardFlashO = useSharedValue(0)
  useEffect(() => {
    if (lastScoredGoal === null) return
    boardFlashO.value = GOAL_BOARD_FLASH_PEAK_OPACITY
    boardFlashO.value = withTiming(0, { duration: GOAL_BOARD_FLASH_DECAY_MS, easing: Easing.out(Easing.quad) })
  }, [lastScoredGoal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Goal celebration: goal line + post flash ─────────────────────────────
  // The scored-on goal's static line/posts get a separate animated overlay at the same position
  // (not a restructure of the static rendering) — color interpolation is what registers as
  // "brighter" since an opacity-only overlay in the same color as what's underneath is a no-op.
  const goalEdgeFlashT = useSharedValue(0)
  useEffect(() => {
    if (lastScoredGoal === null) return
    goalEdgeFlashT.value = 1
    goalEdgeFlashT.value = withTiming(0, { duration: GOAL_BOARD_FLASH_DECAY_MS, easing: Easing.out(Easing.quad) })
  }, [lastScoredGoal]) // eslint-disable-line react-hooks/exhaustive-deps
  const goalEdgeFlashColor = useDerivedValue(() => interpolateColor(goalEdgeFlashT.value, [0, 1], [celebColor, '#FFFFFF']))

  // ─── Goal celebration: score wedge build-up sweep ─────────────────────────
  // The SCORER'S OWN crease (opposite end of the board from the goal mouth just scored on) sweeps
  // a highlight through every wedge it just earned. scores is already post-incremented by the time
  // Board re-renders with the new lastScoredGoal (useGameState's PHYSICS_STEP), so
  // scores[scorer-1] - 1 is the newest wedge's own 0-indexed slot.
  const wedgeFlashScorer: Player | null = lastScoredGoal === 'top' ? 1 : lastScoredGoal === 'bottom' ? 2 : null
  const wedgeFlashNewIndex = wedgeFlashScorer !== null ? scores[wedgeFlashScorer - 1] - 1 : -1
  const wedgeFlashStepMs = wedgeFlashNewIndex > 0 ? Math.min(GOAL_WEDGE_FLASH_STEP_MS, GOAL_WEDGE_SWEEP_BUDGET_MS / wedgeFlashNewIndex) : 0

  const wedgeFlashClockMs = useSharedValue(0)
  useEffect(() => {
    if (lastScoredGoal === null || wedgeFlashNewIndex < 0) return
    const totalMs = wedgeFlashNewIndex * wedgeFlashStepMs + GOAL_WEDGE_FLASH_FINAL_MS
    wedgeFlashClockMs.value = 0
    wedgeFlashClockMs.value = withTiming(totalMs, { duration: totalMs, easing: Easing.linear })
  }, [lastScoredGoal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Goal celebration: puck departure (fade + shard burst) ────────────────
  // "The puck should explode... or fade out or something" — both: after a short grace delay (so
  // the puck is still visible for the first beat of the ring/flash rather than vanishing the
  // instant the goal registers), the puck itself fades out while a small burst of shards (see
  // PuckShard above) flies outward from its resting position. Reset to fully visible whenever
  // lastScoredGoal goes back to null (NEXT_ROUND placing the next puck) as well as driven forward
  // when it's set — one effect covers both, same shape as the ring/flash effects above.
  const puckVisibleO = useSharedValue(1)
  const puckBurstProgress = useSharedValue(0)
  useEffect(() => {
    if (lastScoredGoal === null) {
      puckVisibleO.value = 1
      puckBurstProgress.value = 0
      return
    }
    puckVisibleO.value = withDelay(PUCK_SCORE_FADE_DELAY_MS, withTiming(0, { duration: PUCK_SCORE_FADE_MS, easing: Easing.in(Easing.quad) }))
    puckBurstProgress.value = 0
    puckBurstProgress.value = withDelay(PUCK_SCORE_FADE_DELAY_MS, withTiming(1, { duration: PUCK_BURST_DURATION_MS, easing: Easing.out(Easing.cubic) }))
  }, [lastScoredGoal]) // eslint-disable-line react-hooks/exhaustive-deps
  const puckBurstMaxDist = puckRadius * PUCK_BURST_MAX_DIST_RATIO
  const puckBurstShardR = puckRadius * 0.35

  // ─── Coin flip (tip-off ceremony, 'coinFlip' mode only) ───────────────────────────────────
  // Purely cosmetic — by the time phase reaches 'coinFlip', makeInitialState (useGameState.ts) has
  // already placed `puck` at the winner's own rink faceoff dot and set `currentPlayer` to that
  // same winner; this is a few seconds of ceremony dramatizing an already-final result, never a
  // second source of truth for it.
  //
  // Waits on coinFlipStarted (a tap — see game.tsx) before playing at all. Until then, a plain
  // neutral ring breathes at board center — same invite-pulse language 'faceoff' mode's own
  // ready-check circles already use (see p1ReadyPulse/p2ReadyPulse below), no separate text prompt
  // needed. That ring is already the coin's own eventual size/position, so the tap below hands off
  // straight into the sequence with no separate "grow into place" beat first:
  //   1. Spin (coinFlipSpinPhase) — rapid rotation in half-turn units, squashing to a sliver and
  //      swapping face color each half-turn (see coinFlipScaleX/coinFlipFaceColor below), landing
  //      exactly on the winner's face — an integer half-turn is guaranteed by construction (see
  //      halfTurns below), so the spin always ends flat (no squash) on the correct color. Also
  //      swells past its resting size and back down again over this same span (coinFlipSpinGrowT —
  //      see COIN_FLIP_GROW_*_MS above), like a real tossed coin looming largest at the peak of its
  //      arc before settling back down — layered on TOP of the resting radius (coinFlipRadiusBig),
  //      never replacing it, and scaled by coinFlipCenteredT same as that resting radius (see
  //      coinFlipR below) so this extra swell can only ever happen while already centered, same
  //      no-clipping-at-the-edge guarantee Depart's own position/size coupling relies on. A plain
  //      white ring (same literal white as ringColor's non-idle puck outline further down) traces
  //      the coin's edge for the whole ceremony, not just after it lands — drawn in the same
  //      Group as the fill so it squashes right along with coinFlipScaleX instead of reading as a
  //      static circle laid over a moving disc.
  //   2. Hold — a beat with nothing animating, just long enough to register the landed face.
  //   3. Fade (coinFlipRevealT) — the landed face color bleeds to black, becoming the same
  //      black-fill/white-ring look the real puck has outside 'idle' (see ringColor and the puck
  //      render further down); the ring itself was already there throughout, so only the fill
  //      changes here.
  //   4. Depart (coinFlipCenteredT 1→0) — shrinks and slides from board center back down to
  //      puck.x/y at puckRadius, landing pixel-identical to where the real puck will appear the
  //      instant game.tsx's own COIN_FLIP_TOTAL_MS timer (started on the same tap) flips phase to
  //      'idle' and this overlay unmounts (see the puck Group's own phase gate below) — so the
  //      handoff reads as one continuous object, not a swap.
  const coinFlipInvitePulse = useSharedValue(0.2)
  const coinFlipAwaitingTap = phase === 'coinFlip' && !coinFlipStarted
  useEffect(() => {
    if (coinFlipAwaitingTap) {
      coinFlipInvitePulse.value = 0.2
      coinFlipInvitePulse.value = withRepeat(withTiming(0.6, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(coinFlipInvitePulse)
      coinFlipInvitePulse.value = 0.2
    }
  }, [coinFlipAwaitingTap]) // eslint-disable-line react-hooks/exhaustive-deps

  const coinFlipSpinPhase = useSharedValue(0)
  const coinFlipRevealT = useSharedValue(0)
  // Starts (and, between draws, rests) at 1 — "already centered/big", matching the invite ring
  // above exactly, so the tap that starts the spin has nothing to visually hand off; only Depart
  // at the very end ever moves this away from 1.
  const coinFlipCenteredT = useSharedValue(1)
  // 0 at rest (both before the spin starts and after it settles) — rises to 1 at the swell's peak
  // and back to 0 partway through the spin, entirely independent of coinFlipCenteredT above (see
  // coinFlipR below for how the two combine).
  const coinFlipSpinGrowT = useSharedValue(0)

  useEffect(() => {
    if (phase !== 'coinFlip' || !coinFlipStarted) return
    // +1 half-turn when the winner is P2 — cos(t*π) is +1 on an even half-turn (P1's face) and -1
    // on an odd one (P2's), so this is what actually guarantees the spin lands on the right color.
    const halfTurns = COIN_FLIP_BASE_HALF_TURNS + (currentPlayer === 1 ? 0 : 1)
    const revealAt = COIN_FLIP_SPIN_MS + COIN_FLIP_HOLD_MS
    const departAt = revealAt + COIN_FLIP_FADE_MS
    coinFlipSpinPhase.value = 0
    coinFlipRevealT.value = 0
    coinFlipCenteredT.value = 1
    coinFlipSpinGrowT.value = 0
    coinFlipSpinPhase.value = withTiming(halfTurns, { duration: COIN_FLIP_SPIN_MS, easing: Easing.out(Easing.cubic) })
    coinFlipSpinGrowT.value = withSequence(withTiming(1, { duration: COIN_FLIP_GROW_UP_MS, easing: Easing.out(Easing.cubic) }), withTiming(1, { duration: COIN_FLIP_GROW_HOLD_MS }), withTiming(0, { duration: COIN_FLIP_GROW_DOWN_MS, easing: Easing.inOut(Easing.cubic) }))
    coinFlipRevealT.value = withDelay(revealAt, withTiming(1, { duration: COIN_FLIP_FADE_MS, easing: Easing.out(Easing.quad) }))
    coinFlipCenteredT.value = withDelay(departAt, withTiming(0, { duration: COIN_FLIP_TRAVEL_MS, easing: Easing.inOut(Easing.cubic) }))
  }, [phase, coinFlipStarted]) // eslint-disable-line react-hooks/exhaustive-deps

  const coinFlipScaleX = useDerivedValue(() => Math.max(Math.abs(Math.cos(coinFlipSpinPhase.value * Math.PI)), COIN_FLIP_MIN_SCALE_X))
  // Frozen at the winner's own face color the instant the spin above finishes (coinFlipSpinPhase
  // stops changing thereafter), so this reads as a fixed start color for the fade below even
  // though it stays technically wired to the (by-then-static) spin value.
  const coinFlipFaceColor = useDerivedValue(() => (Math.cos(coinFlipSpinPhase.value * Math.PI) >= 0 ? p1Color : p2Color))
  const coinFlipFillColor = useDerivedValue(() => interpolateColor(coinFlipRevealT.value, [0, 1], [coinFlipFaceColor.value, '#000000']))

  const coinFlipRadiusBig = puckRadius * 2.4
  const coinFlipRadiusPeak = puckRadius * 3.4
  const coinFlipR = useDerivedValue(() => {
    const resting = puckRadius + (coinFlipRadiusBig - puckRadius) * coinFlipCenteredT.value
    const swell = (coinFlipRadiusPeak - coinFlipRadiusBig) * coinFlipSpinGrowT.value * coinFlipCenteredT.value
    return resting + swell
  })
  const coinFlipCX = useDerivedValue(() => puck.x + (board.centerX - puck.x) * coinFlipCenteredT.value)
  const coinFlipCY = useDerivedValue(() => puck.y + (board.centerY - puck.y) * coinFlipCenteredT.value)
  const coinFlipOrigin = useDerivedValue(() => vec(coinFlipCX.value, coinFlipCY.value))
  const coinFlipTransform = useDerivedValue(() => [{ scaleX: coinFlipScaleX.value }])

  // ─── Aim direction chevrons ────────────────────────────────────────────────
  // Now a power/bank-aware preview (previously deliberately NOT a simulated trajectory, to
  // preserve shot-banking skill/guessing — reversed per explicit design request). Reuses
  // computeTrajectory (utils/physics.ts) — a real stepPhysics-mirroring simulator, previously only
  // exercised by physics.test.ts — to get bounce waypoints, then walks/truncates that polyline to
  // `previewLengthPx` so the trail bends to follow a bank shot's post-bounce direction only if that
  // ONE bounce falls within the settings-controlled preview length. Deliberately capped to a single
  // bounce (maxBounces=1 in the computeTrajectory call below, not more) — see that call's own
  // comment for why a second predicted bend isn't trustworthy enough to draw with the same
  // confidence as the first.
  // Raw finger position delta (current touch minus where the drag started) — the actual shot
  // INPUT for 'pull'/'push' (see below), and, for every scheme, the DISTANCE half of the cancel
  // gate (MIN_SHOOT_DRAG's own comment in constants/game.ts).
  const rawAimDx = aim ? aim.currentX - aim.startX : 0
  const rawAimDy = aim ? aim.currentY - aim.startY : 0
  const rawAimDist = Math.sqrt(rawAimDx * rawAimDx + rawAimDy * rawAimDy)
  // Mirrors resolveStrikeVelocity in useGameState.ts exactly, so this preview never disagrees with
  // what would actually fire on release: 'flick' derives shot power/direction from the live
  // release-velocity ESTIMATE (aim.vx/vy, points/sec, smoothed — see AimIndicator's own comment);
  // 'pull'/'push' derive it from the raw drag distance instead (rawAimDx/Dy above) — the ORIGINAL
  // mechanic both of those schemes have always used, unrelated to release speed. shotInputMin/Max
  // are whichever pair of caps actually applies, so every formula below can stay written once, in
  // terms of these, rather than re-branching on scheme at each step.
  const isFlick = controlScheme === 'flick'
  const shotInputX = isFlick ? (aim?.vx ?? 0) : rawAimDx
  const shotInputY = isFlick ? (aim?.vy ?? 0) : rawAimDy
  const shotInputMin = isFlick ? MIN_FLICK_VELOCITY : MIN_SHOOT_DRAG
  const shotInputMax = isFlick ? MAX_FLICK_VELOCITY : MAX_STICK_PULLBACK_PIXELS
  // Signed by the active player's own ControlScheme (shootSign above) to get the actual shot
  // direction: 'pull' points opposite the drag (like a slingshot or pool cue), 'push'/'flick' point
  // along it. This is also computeAimVector/computeTrajectory's expected sign convention (they
  // don't re-negate), so reuse liveVx/liveVy as-is without flipping again. This is the ONE shared
  // source of truth for shot direction across the front arrow and chevron trail below (and, for
  // 'pull'/'push', the stick too) — every visual tracks the same live value, so the preview never
  // disagrees with what would actually fire if released right now.
  const liveVx = aim ? shootSign * shotInputX : 0
  const liveVy = aim ? shootSign * shotInputY : 0
  const liveSpeed = Math.hypot(liveVx, liveVy)
  // Unit direction of the live shot vector — falls back to (0,0) at/near zero speed rather than
  // dividing by zero; harmless, since every visual that uses it is also scaled by livePowerT/
  // pastCancelZone below, both 0 in that same near-zero-speed regime.
  const liveDirX = liveSpeed > 0.0001 ? liveVx / liveSpeed : 0
  const liveDirY = liveSpeed > 0.0001 ? liveVy / liveSpeed : 0
  // Same gate useGameState's resolveStrikeVelocity uses to decide cancel vs. strike: 'pull'/'push'
  // gate on distance alone (their only cancel condition, same as the pre-flick original); 'flick'
  // ANDs a speed floor on top (MIN_FLICK_VELOCITY — see its own comment in constants/game.ts for
  // why that scheme needs both). Gates the chevron trail below, and now also the stick and front
  // arrow further down: none of the three aiming indicators should show while a release right now
  // would just cancel, since none of them represent a real committed shot yet.
  const pastCancelZone = isAimingSized && !!aim && rawAimDist >= MIN_SHOOT_DRAG && (!isFlick || liveSpeed >= MIN_FLICK_VELOCITY)
  // 0 right at the cancel-zone boundary, 1 at shotInputMax — drives the stick's own length
  // (paddleFace below) and the front arrow's sharpness: for 'pull'/'push' this is a plain
  // drag-distance ratio (more pull = a longer stick/sharper arrow, the original mechanic); for
  // 'flick' it's velocity-based so the preview honestly reflects what a release right now would
  // produce (a slow, sustained drag shows little to no wind-up until the player actually starts
  // flicking).
  const livePowerT = Math.min(1, Math.max(0, (liveSpeed - shotInputMin) / (shotInputMax - shotInputMin)))
  // Opacity for the stick and front arrow (NOT the chevron trail — pastCancelZone above still
  // hard-gates that unchanged): cross-fades smoothly across the cancel gate(s) around their own
  // thresholds, rather than a hard pop at the boundary. velocityFade only applies to 'flick' — for
  // 'pull'/'push' there's no velocity gate at all, so it's left at 1 (a no-op in the min() below).
  const distanceFade = Math.min(1, Math.max(0, (rawAimDist - (MIN_SHOOT_DRAG - CANCEL_ZONE_FADE_PX)) / CANCEL_ZONE_FADE_PX))
  const velocityFade = isFlick ? Math.min(1, Math.max(0, (liveSpeed - (MIN_FLICK_VELOCITY - CANCEL_ZONE_VELOCITY_FADE_UNITS)) / CANCEL_ZONE_VELOCITY_FADE_UNITS)) : 1
  const cancelZoneFadeOpacity = Math.min(distanceFade, velocityFade)
  const { power: chevPower } = computeAimVector(liveVx, liveVy, shotInputMax, MAX_SPEED)

  // The real bounce-aware trail only shows at 'medium'/'long' — see shotPreviewLength's own doc
  // comment on BoardProps for the full tier breakdown ('off' none, 'short' stick+arrow, 'medium'/
  // 'long' stick+trail).
  const showTrajectoryTrail = pastCancelZone && (shotPreviewLength === 'medium' || shotPreviewLength === 'long')

  const chevronPlacements = useMemo(() => {
    if (!showTrajectoryTrail) return [] as (SkPath | null)[]

    // maxBounces=1, not 3 — computeTrajectory is a discrete, frame-stepped approximation of
    // stepPhysics (matched closely enough to be trustworthy for ONE bounce — see its own comment
    // on sub-stepping/friction — but a real, structural gap remains: gravity-well force there is
    // still only sampled once per frame at dt=1, not fresh per sub-step at the puck's actual live
    // position the way stepPhysicsOnce itself does it, and any small residual error at bounce 1
    // COMPOUNDS across the (often much longer) travel to bounce 2. A trail confidently drawing a
    // second bend the puck won't actually take is worse than no trail at all — showing only the
    // first, closely-matching segment and letting the trail simply run out past that bounce is the
    // honest choice: real distance/power still reads clearly from how far it reaches, it just never
    // asserts a bend it can't back up.
    const waypoints = computeTrajectory(puck.x, puck.y, liveVx, liveVy, board, shotInputMax, MAX_SPEED, 1, friction)
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
  }, [showTrajectoryTrail, puck.x, puck.y, puckRadius, liveVx, liveVy, board, previewLengthPx, chevPower, friction, shotInputMax])

  // Highlight sweep — travels through the chevrons at a rate tied to live power, without
  // restarting/jumping every time power changes mid-drag (a fixed-duration withRepeat/withTiming
  // can't smoothly re-rate; a per-frame accumulator can). chevronPowerSV mirrors chevPower via a
  // layout effect, same convention as puckRadiusSV above — NOT assigned directly during render
  // (that used to be this file's own convention, but it's exactly what Reanimated's strict mode
  // warns against; both this and puckRadiusSV were firing "Writing to `value` during component
  // render" on every frame until this fix).
  const chevronPowerSV = useSharedValue(0)
  useLayoutEffect(() => {
    chevronPowerSV.value = chevPower
  }, [chevPower]) // eslint-disable-line react-hooks/exhaustive-deps

  const chevronSweepPhase = useSharedValue(0)
  const chevronFrame = useFrameCallback((info) => {
    'worklet'
    const dtSec = (info.timeSincePreviousFrame ?? 16.7) / 1000
    const rate = CHEVRON_SWEEP_BASE_RATE * Math.max(chevronPowerSV.value, CHEVRON_SWEEP_MIN_RATE_FACTOR)
    chevronSweepPhase.value = (chevronSweepPhase.value + dtSec * rate) % 1
  }, false)

  useEffect(() => {
    chevronFrame.setActive(isAimingSized)
  }, [phase, isIntercepting]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Raw wedge angle data, memoized on its own (not just inline computeGoalWedges() calls) so the
  // ScoreWedges instances below — which memoize their own SkPath building keyed on this exact array
  // reference (see that component's own comment) — don't rebuild every render.
  const p1WedgeAngles = useMemo(() => computeGoalWedges(scoreToWin, 180), [scoreToWin])
  const p2WedgeAngles = useMemo(() => computeGoalWedges(scoreToWin, 0), [scoreToWin])

  // Still built locally as SkPaths (not just left to the shared ScoreWedges component below) because
  // WedgeFlashOverlay's own build-up sweep (see the goal-celebration render further down) needs to
  // stroke a highlight over these exact same paths — ScoreWedges owns its paths internally and
  // doesn't expose them, so the base wedge-outline rendering and the flash overlay can't both be
  // driven off a single shared computation without this local copy.
  const p1Wedges = useMemo(() => {
    const r = goalCreaseRadius
    return p1WedgeAngles.map(({ startAngle, sweepAngle }) =>
      Skia.PathBuilder.Make()
        .addArc({ x: goalCX - r, y: y + height - r, width: r * 2, height: r * 2 }, startAngle + WEDGE_GAP_DEG / 2, sweepAngle - WEDGE_GAP_DEG)
        .detach()
    )
  }, [goalCX, y, height, goalCreaseRadius, p1WedgeAngles])

  const p2Wedges = useMemo(() => {
    const r = goalCreaseRadius
    return p2WedgeAngles.map(({ startAngle, sweepAngle }) =>
      Skia.PathBuilder.Make()
        .addArc({ x: goalCX - r, y: y - r, width: r * 2, height: r * 2 }, startAngle + WEDGE_GAP_DEG / 2, sweepAngle - WEDGE_GAP_DEG)
        .detach()
    )
  }, [goalCX, y, goalCreaseRadius, p2WedgeAngles])

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

  // ─── Ready-check invite pulse (per player) ─────────────────────────────────
  // Gently breathes an unready player's ring to invite the tap that signals "I'm set" — same
  // withRepeat/ping-pong idle-breathing shape as idlePulseT above, just gated on "hasn't readied
  // yet" instead of "puck is idle". Stops (falling back to isReady's own static 0.45-vs-1 swap
  // below) the instant that player readies up — no need to keep inviting a tap that already
  // landed. Runs identically for a CPU-controlled player too (Board.tsx doesn't know or care which
  // seat is AI-controlled anywhere else, and there's no reason to start here).
  const p1ReadyPulse = useSharedValue(0)
  const p2ReadyPulse = useSharedValue(0)
  const p1Waiting = faceoff !== null && faceoff.stage === 'ready' && !faceoff.ready[0]
  const p2Waiting = faceoff !== null && faceoff.stage === 'ready' && !faceoff.ready[1]
  useEffect(() => {
    if (p1Waiting) {
      p1ReadyPulse.value = 0
      p1ReadyPulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(p1ReadyPulse)
      p1ReadyPulse.value = 0
    }
  }, [p1Waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (p2Waiting) {
      p2ReadyPulse.value = 0
      p2ReadyPulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(p2ReadyPulse)
      p2ReadyPulse.value = 0
    }
  }, [p2Waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  // 0.3-0.6 range: gentle, clearly dimmer than the isReady's static full-opacity ring, never fully
  // invisible so the "this is your circle" chrome never disappears entirely.
  const p1ReadyRingOpacity = useDerivedValue(() => 0.3 + p1ReadyPulse.value * 0.3)
  const p2ReadyRingOpacity = useDerivedValue(() => 0.3 + p2ReadyPulse.value * 0.3)

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
  // useFaceoff.ts's "no announcement, no pause" resolved-to-knock effect dispatches FACEOFF_LAUNCH
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

  // ─── Triple-tap zones ───────────────────────────────────────────────────────
  // One zone per player (not a pair like faceoff's own — see tripleTapZoneCenter's own comment in
  // utils/board.ts: no hidden target, so no zoneIndex dimension) — this mirrors the faceoff block's
  // techniques above (pulsing ring, latched press ripple) at that simpler cardinality.
  const tripleTapRadius = tripleTapZoneRadius(board)
  const tripleTapCenters: { cx: number; cy: number; color: string; player: Player }[] = ([1, 2] as Player[]).map((player) => {
    const c = tripleTapZoneCenter(board, player)
    return { cx: c.x, cy: c.y, color: player === 1 ? p1Color : p2Color, player }
  })
  // Dot radius (as a fraction of tripleTapRadius) grows with tapCount — 0/1/2 — so the dot itself
  // doubles as a "how many presses landed" cue with no separate counter UI, the same "the drawing
  // itself is the state" spirit as faceoffDotRadius's live/resting split above.
  const TRIPLE_TAP_DOT_RADII = [0.14, 0.24, 0.34] as const

  // "Armed, go for it" breathing invite once a player's own 2 taps are in and they haven't swiped
  // yet — same withRepeat/ping-pong shape as p1ReadyPulse/p2ReadyPulse above, just gated on
  // tapCount reaching 2 instead of "hasn't readied yet". Safe to derive live (never needs to
  // survive `tripleTap` going null the way the ripple/flash below do) since this is a live "is this
  // still true right now" cue, not a moment to preserve.
  const p1TripleTapArmedPulse = useSharedValue(0)
  const p2TripleTapArmedPulse = useSharedValue(0)
  const p1TripleTapArmed = tripleTap !== null && tripleTap.tapCount[0] === 2 && tripleTap.swipe[0] === null
  const p2TripleTapArmed = tripleTap !== null && tripleTap.tapCount[1] === 2 && tripleTap.swipe[1] === null
  useEffect(() => {
    if (p1TripleTapArmed) {
      p1TripleTapArmedPulse.value = 0
      p1TripleTapArmedPulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(p1TripleTapArmedPulse)
      p1TripleTapArmedPulse.value = 0
    }
  }, [p1TripleTapArmed]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (p2TripleTapArmed) {
      p2TripleTapArmedPulse.value = 0
      p2TripleTapArmedPulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(p2TripleTapArmedPulse)
      p2TripleTapArmedPulse.value = 0
    }
  }, [p2TripleTapArmed]) // eslint-disable-line react-hooks/exhaustive-deps
  const p1TripleTapRingOpacity = useDerivedValue(() => 0.3 + p1TripleTapArmedPulse.value * 0.3)
  const p2TripleTapRingOpacity = useDerivedValue(() => 0.3 + p2TripleTapArmedPulse.value * 0.3)

  // Press ripple — fires on EVERY press (taps 1, 2, and the swipe's own touch-down alike, see
  // TripleTapState.pressFlash's own doc comment), latched into local boolean state rather than
  // derived live from `tripleTap.pressFlash !== null` for the exact reason the faceoff ripple above
  // latches its own zone: tripleTap goes null the instant TRIPLE_TAP_LAUNCH fires, so a live
  // derivation would cut the most interesting press — the swipe that actually resolved the draw —
  // short by up to a full frame. No zone dimension to remember here (unlike faceoff's
  // p1RippleZone/p2RippleZone), just whether to show at all.
  const [p1TripleTapRippleActive, setP1TripleTapRippleActive] = useState(false)
  const [p2TripleTapRippleActive, setP2TripleTapRippleActive] = useState(false)
  const p1TripleTapRippleProgress = useSharedValue(0)
  const p2TripleTapRippleProgress = useSharedValue(0)
  const prevTripleTapPressFlashRef = useRef<[number | null, number | null]>(tripleTap?.pressFlash ?? [null, null])
  useEffect(() => {
    const prev = prevTripleTapPressFlashRef.current
    const curr = tripleTap?.pressFlash ?? [null, null]
    prevTripleTapPressFlashRef.current = curr
    if (curr[0] !== null && curr[0] !== prev[0]) {
      setP1TripleTapRippleActive(true)
      p1TripleTapRippleProgress.value = 0
      p1TripleTapRippleProgress.value = withTiming(1, { duration: FACEOFF_PRESS_RIPPLE_DURATION_MS, easing: Easing.out(Easing.cubic) })
    }
    if (curr[1] !== null && curr[1] !== prev[1]) {
      setP2TripleTapRippleActive(true)
      p2TripleTapRippleProgress.value = 0
      p2TripleTapRippleProgress.value = withTiming(1, { duration: FACEOFF_PRESS_RIPPLE_DURATION_MS, easing: Easing.out(Easing.cubic) })
    }
  }, [tripleTap?.pressFlash]) // eslint-disable-line react-hooks/exhaustive-deps
  const tripleTapRippleExpand = tripleTapRadius * 0.85
  const p1TripleTapRippleR = useDerivedValue(() => tripleTapRadius + p1TripleTapRippleProgress.value * tripleTapRippleExpand)
  const p2TripleTapRippleR = useDerivedValue(() => tripleTapRadius + p2TripleTapRippleProgress.value * tripleTapRippleExpand)
  const p1TripleTapRippleO = useDerivedValue(() => (1 - p1TripleTapRippleProgress.value) * 0.85)
  const p2TripleTapRippleO = useDerivedValue(() => (1 - p2TripleTapRippleProgress.value) * 0.85)

  // Swipe-captured directional flash — a brief streak along the captured vector's own angle, the
  // instant `swipe[idx]` is first set. Same latching need as the ripple above (the angle itself
  // would otherwise vanish the moment tripleTap goes null on launch) — captured into local state
  // once, never re-derived from the live prop afterward.
  const [p1SwipeFlashAngle, setP1SwipeFlashAngle] = useState<number | null>(null)
  const [p2SwipeFlashAngle, setP2SwipeFlashAngle] = useState<number | null>(null)
  const p1SwipeFlashProgress = useSharedValue(0)
  const p2SwipeFlashProgress = useSharedValue(0)
  const prevTripleTapSwipeRef = useRef<TripleTapState['swipe']>(tripleTap?.swipe ?? [null, null])
  useEffect(() => {
    const prev = prevTripleTapSwipeRef.current
    const curr = tripleTap?.swipe ?? [null, null]
    prevTripleTapSwipeRef.current = curr
    if (curr[0] !== null && prev[0] === null) {
      setP1SwipeFlashAngle(Math.atan2(curr[0].vy, curr[0].vx))
      p1SwipeFlashProgress.value = 0
      p1SwipeFlashProgress.value = withTiming(1, { duration: TRIPLE_TAP_SWIPE_FLASH_DURATION_MS, easing: Easing.out(Easing.cubic) })
    }
    if (curr[1] !== null && prev[1] === null) {
      setP2SwipeFlashAngle(Math.atan2(curr[1].vy, curr[1].vx))
      p2SwipeFlashProgress.value = 0
      p2SwipeFlashProgress.value = withTiming(1, { duration: TRIPLE_TAP_SWIPE_FLASH_DURATION_MS, easing: Easing.out(Easing.cubic) })
    }
  }, [tripleTap?.swipe]) // eslint-disable-line react-hooks/exhaustive-deps
  const tripleTapFlashLength = tripleTapRadius * 1.6
  const p1SwipeFlashO = useDerivedValue(() => (1 - p1SwipeFlashProgress.value) * 0.9)
  const p2SwipeFlashO = useDerivedValue(() => (1 - p2SwipeFlashProgress.value) * 0.9)

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

  // ─── rink pocket perimeter (curved caps behind each goal, NOT a full rounded rectangle) ─────
  // Two separate open subpaths (one per goal), each just an arc-line-arc "cap" — no vertical
  // segments running down the sides at all, per explicit correction: the long straight sides
  // rely on the device's own physical screen edge as the boundary, same as every other variant
  // (see showWalls' own doc comment) — only the NEW curved geometry behind each goal has no
  // existing screen-edge equivalent, so only that part needs to actually be drawn. Each cap
  // starts and ends at the tangent point where a hypothetical straight side wall would begin
  // (left/right, outerTop+cr or outerBottom-cr) — strokeCap='round' on the Path element below
  // gives those loose ends a soft rounded finish rather than a hard cut, reading as "the curve
  // originates there" rather than a wall that just stops.
  // Built off the TRUE outer boundary (extended by behindGoalDepth — see computeBoardLayout), not
  // board.y/height, so the curve sits back at the pocket's real depth rather than the front line.
  // Uses the same Skia.PathBuilder.addArc API the goal-crease arcs above already use.
  // No gap at the goal mouth itself — real rink boards are one unbroken curve behind the net; the
  // goal crease arcs (p1Wedges/p2Wedges above) already mark where the goal is.
  //
  // Kept computed (not deleted) purely so SHOW_RINK_DEBUG_PERIMETER below still has real geometry
  // to draw — normal play no longer renders it at all.
  const rinkPerimeterPath = useMemo(() => {
    if (board.cornerRadius <= 0) return null
    const cr = board.cornerRadius
    const outerTop = y - board.behindGoalDepth
    const outerBottom = y + height + board.behindGoalDepth
    const left = x
    const right = x + width
    return Skia.PathBuilder.Make()
      .moveTo(left, outerTop + cr)
      .addArc({ x: left, y: outerTop, width: cr * 2, height: cr * 2 }, 180, 90)
      .lineTo(right - cr, outerTop)
      .addArc({ x: right - cr * 2, y: outerTop, width: cr * 2, height: cr * 2 }, 270, 90)
      .moveTo(right, outerBottom - cr)
      .addArc({ x: right - cr * 2, y: outerBottom - cr * 2, width: cr * 2, height: cr * 2 }, 0, 90)
      .lineTo(left + cr, outerBottom)
      .addArc({ x: left, y: outerBottom - cr * 2, width: cr * 2, height: cr * 2 }, 90, 90)
      .detach()
  }, [board.cornerRadius, board.behindGoalDepth, x, y, width, height])

  // ─── Stick/paddle ─────────────────────────────────────────────────────────
  // Only ever RENDERED for 'pull'/'push' (see the render gates further down) — computed
  // unconditionally anyway (including for 'flick') since that's simpler than threading a
  // scheme-gated branch through every value below, and the extra math is free if unused.
  // While aiming, the paddle sits at puck position - shot-direction offset (i.e. opposite the
  // direction the puck is actually about to travel) rather than at the raw touch point — a drag
  // can now start anywhere on the board (see useGameState's tryAimStart), so drawing it at the
  // literal finger position could put it far from the puck entirely. Offset from the puck instead,
  // it always reads as "pulled back from the puck, about to swing forward" regardless of where the
  // finger landed or which ControlScheme is active. livePowerT (computed above, scheme-correctly
  // from either drag distance or release velocity) drives how far out that offset reaches, capped
  // at MAX_STICK_PULLBACK_PIXELS specifically (never shotInputMax) — this is a PIXEL-space visual
  // distance the front arrow below also places itself by, so it must stay in pixel units
  // regardless of scheme, unlike shotInputMax which is in whatever unit that scheme's power model
  // uses (a raw velocity number for 'flick', meaningless as a screen distance).
  const stickOffset = livePowerT * MAX_STICK_PULLBACK_PIXELS

  const paddleFace = puckRadius * (1.8 + 1.0 * livePowerT) // 1.8 (short, at the cancel-zone boundary) -> 2.8 (long, at max pull)
  const paddleThickness = puckRadius * 0.45

  // liveDirX/Y already carries shootSign (see the shared block above) and points along the true
  // shot direction, so the paddle sits on the OPPOSITE side — the side it swings away FROM, not
  // toward. For 'pull' (shootSign -1) that's the same side as the finger (a slingshot pull); for
  // 'push' (shootSign +1) that's the side BEHIND the finger, so swinging toward the finger's
  // current position pushes the puck forward along the swipe. Getting this backwards puts the
  // paddle on the puck's departure side instead of its pulled-back approach side.
  const stickX = puck.x - liveDirX * stickOffset
  const stickY = puck.y - liveDirY * stickOffset
  // Facing direction (paddle → puck) stays fixed for the whole swing below — stickX/Y is
  // snapshotted once, at the instant 'striking' begins (see the useLayoutEffect below), so
  // recomputing this every render is cheap and stable, unlike deriving it from the animating
  // strikeX/Y themselves (which would degenerate as they approach the contact point below). The
  // puck itself CAN keep moving during 'striking' now (a mid-slide pull/push intercept — see
  // useGameState.ts's PHYSICS_STEP, which no longer freezes physics for this windup), so the swing
  // still targets wherever the puck was AT THE MOMENT of release, not wherever it drifts to by the
  // time contact lands — accepted, since intercept-eligible speeds are slow enough that the drift
  // over one 130ms windup is visually negligible.
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

  // useLayoutEffect, not useEffect: strikeX/Y are shared values that live for the whole Board
  // lifetime, still holding wherever the LAST swing left them (or their 0,0 default on the very
  // first swing) right up until this runs. A plain useEffect fires after the 'striking' Path
  // above has already been mounted and painted at least once, so that stale leftover position
  // would flash on screen for a frame before snapping to stickX/Y here — exactly the glitch this
  // avoids by correcting the value before the browser/native paint, not after it.
  useLayoutEffect(() => {
    if (phase !== 'striking' || !aim) return
    strikeX.value = stickX
    strikeY.value = stickY
    strikeX.value = withTiming(contactX, { duration: STRIKE_DURATION_MS, easing: Easing.in(Easing.cubic) })
    strikeY.value = withTiming(contactY, { duration: STRIKE_DURATION_MS, easing: Easing.in(Easing.cubic) })
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const strikingPaddlePath = useDerivedValue(() => paddlePath(strikeX.value, strikeY.value, stickAngle, paddleFace, paddleThickness))

  // ─── Front power arrow ─────────────────────────────────────────────────────
  // A single triangle mirroring the stick's own pulled-back offset onto the OPPOSITE side of the
  // puck — same stickOffset (computed alongside the stick above) as stickX/Y, but added instead of
  // subtracted, so it sits out ahead of the puck along the direction it's about to travel and
  // grows/shrinks in lockstep with the stick's own live power.
  // Only shown at shotPreviewLength === 'short' — see its own doc comment on BoardProps for the
  // full tier breakdown. 'off' shows neither this nor the trail (nor the stick — a deliberate blind
  // "just feel it" mode); 'medium'/'long' show the real bounce-aware trail instead, which is
  // strictly more informative once it's actually long enough to reach anything.

  // Existence gate — whether to mount/compute the path at all. Separate from cancelZoneFadeOpacity
  // below (which handles the actual cancel-zone fade as an opacity, not a mount/unmount): this only
  // needs to skip a null `aim`, the near-zero-speed instant right at touch-down (liveDirX/Y default
  // to 0 there, which would otherwise draw a degenerate zero-direction arrow), and any tier other
  // than 'short' (see above).
  const showFrontArrow = isAimingSized && !!aim && liveSpeed > 0.001 && shotPreviewLength === 'short'

  // The arrow always FACES the true shot direction (no rotation) — what changes with pull is its
  // own sharpness, not its orientation. Right at the cancel-zone boundary it's wide with real body
  // already (not a hairline sliver) — a blunt, near-flat wedge you can actually see the shape of.
  // As live speed grows from MIN_FLICK_VELOCITY toward MAX_FLICK_VELOCITY it narrows and lengthens
  // into a proper sharp arrowhead — "sharpening to a point" as a shape change, not a spin. Uses the
  // SAME livePowerT the stick's own paddleFace grows with above, so both ends of the pull read as
  // one paired "how hard" cue: the stick lengthens behind the puck while the arrow sharpens ahead.
  const frontArrowWidth = puckRadius * (0.6 - 0.38 * livePowerT) // 0.6 (blunt) -> 0.22 (sharp)
  const frontArrowDepth = puckRadius * (0.22 + 0.28 * livePowerT) // 0.22 (flat, but real height) -> 0.5 (long point)

  const frontArrowPath = useMemo(() => {
    if (!showFrontArrow) return null
    const ux = liveDirX
    const uy = liveDirY
    // Clamped to the wall instead of drawing straight through it — with no trajectory bend to lean
    // on (that's exactly what 'off' is missing), stopping the tip right at the board edge is what
    // lets this still double as a bank-shot planning aid: where it lands on the wall is where the
    // puck's center will actually make contact. `- puckRadius` matches stepPhysics' own contact
    // point (x = board.x + r, etc.) — the puck's CENTER stops one radius short of the true edge.
    const wallDist = Math.max(0, rayDistanceToBoardEdge(puck.x, puck.y, ux, uy, x, x + width, y, y + height) - puckRadius)
    const placementDist = Math.min(stickOffset, wallDist)
    const tipX = puck.x + ux * placementDist
    const tipY = puck.y + uy * placementDist
    const backX = tipX - ux * frontArrowDepth
    const backY = tipY - uy * frontArrowDepth
    const px = -uy
    const py = ux
    const path = Skia.Path.Make()
    path.moveTo(tipX, tipY)
    path.lineTo(backX + px * frontArrowWidth, backY + py * frontArrowWidth)
    path.lineTo(backX - px * frontArrowWidth, backY - py * frontArrowWidth)
    path.close()
    return path
  }, [showFrontArrow, puck.x, puck.y, puckRadius, x, y, width, height, liveDirX, liveDirY, stickOffset, frontArrowWidth, frontArrowDepth])

  return (
    <View style={[styles.container, topBleedStyle]}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Shifts everything below back down by topBleed so it lands exactly where it always has
            on screen — the View/Canvas above are topBleed pixels taller (bled upward past the
            container's original top edge, see topBleed's own comment), so their local (0,0) is
            now topBleed higher up than board.y=0 used to assume. This Group is the one place that
            compensates; nothing below it needs to know the canvas got taller. */}
        <Group transform={[{ translateY: topBleed }]}>
          {/* Goal crease background tint — see the useMemo above */}
          <Group opacity={0.28}>
            <Path path={p1CreaseFill} color={p1Color} />
            <Path path={p2CreaseFill} color={p2Color} />
          </Group>

          {/* Score arcs — shared @tastic/sprites/hockey ScoreWedges (confirmed identical gap-shrunk
            arc-per-wedge geometry, same WEDGE_GAP_DEG=5/2.5px stroke defaults); takes the raw wedge
            angle data and builds/memoizes its own SkPaths, separately from the p1Wedges/p2Wedges
            SkPath copies above (kept only for WedgeFlashOverlay's sake — see that useMemo's comment). */}
          <ScoreWedges cx={goalCX} cy={y + height} radius={goalCreaseRadius} wedges={p1WedgeAngles} score={scores[0]} color={p1Color} unfilledColor={lineColor} />
          <ScoreWedges cx={goalCX} cy={y} radius={goalCreaseRadius} wedges={p2WedgeAngles} score={scores[1]} color={p2Color} unfilledColor={lineColor} />

          {/* Rink faceoff circles — see the comment above. The ring + center dot are permanent
            chrome, present in every state exactly alike (idle, pulsing, live) — only a background
            fill behind them changes: none when idle, a dim pulsing wash while counting down/
            holding, or a muted "container" tint (faceoffLiveTintOpacity — a toned-down wash of
            the player's own color, not a full-saturation fill) the instant this is the live
            target. Keeping the ring/dot constant is what makes the background read as a state
            change rather than a different decoration replacing it.
            NOT swapped to @tastic/sprites/hockey FaceoffCircle: that component bundles its ring+dot
            as one shape under a single external opacity control, always at full opacity internally.
            This app's own ring and dot genuinely need INDEPENDENT opacity — the dot renders below at
            a flat, constant full opacity always, while the ring (readyRingOpacity/isReady just below)
            is almost never at full opacity outside the brief ready-check window (it rests at 0.3, not
            1, the rest of the game — see p1ReadyRingOpacity/p2ReadyRingOpacity above). Forcing this
            through FaceoffCircle would mean either the dot starts dimming with the ring (it never has)
            or the ring is stuck permanently brighter than today. A real divergence, not a naming
            mismatch, so this stays its own local ring+dot render, unchanged. */}
          {faceoffCenters.map((c, i) => {
            const isChosen = faceoff !== null && faceoff.zones[c.player - 1] === c.zoneIndex
            const live = faceoffLive && isChosen
            const pulsing = faceoff !== null && (faceoff.stage === 'countdown' || faceoff.stage === 'hold')
            // Ready-check (game's first draw only — see FaceoffState's doc comment): that player's
            // ring gently pulses (see p1ReadyRingOpacity/p2ReadyRingOpacity above) to invite the tap
            // while still unready, then brightens to a static full opacity the moment they signal
            // ready — the plainest possible "you're set, waiting on the other player" cue.
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
            const readyRingOpacity = c.player === 1 ? p1ReadyRingOpacity : p2ReadyRingOpacity
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
                <Group opacity={isReady ? 1 : readyRingOpacity}>
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

          {/* Triple-tap zones — see the comment above (tripleTapCenters). One zone per player: the
            ring dims/brightens with the armed pulse once tapCount reaches 2, the center dot grows
            with tapCount so it reads as a "how many left" cue on its own, the ripple fires on every
            press (all 3), and a brief directional streak marks the swipe's own captured angle. */}
          {tripleTap &&
            tripleTapCenters.map((c) => {
              const idx = c.player - 1
              const dotRadius = tripleTapRadius * TRIPLE_TAP_DOT_RADII[tripleTap.tapCount[idx]]
              const armed = c.player === 1 ? p1TripleTapArmed : p2TripleTapArmed
              const ringOpacity = c.player === 1 ? p1TripleTapRingOpacity : p2TripleTapRingOpacity
              const rippleActive = c.player === 1 ? p1TripleTapRippleActive : p2TripleTapRippleActive
              const rippleR = c.player === 1 ? p1TripleTapRippleR : p2TripleTapRippleR
              const rippleO = c.player === 1 ? p1TripleTapRippleO : p2TripleTapRippleO
              const flashAngle = c.player === 1 ? p1SwipeFlashAngle : p2SwipeFlashAngle
              const flashO = c.player === 1 ? p1SwipeFlashO : p2SwipeFlashO
              return (
                <Group key={c.player}>
                  <Group opacity={armed ? ringOpacity : 1}>
                    <Circle cx={c.cx} cy={c.cy} r={tripleTapRadius} style='stroke' strokeWidth={1.5} color={c.color} />
                  </Group>
                  <Circle cx={c.cx} cy={c.cy} r={dotRadius} color={c.color} />
                  {rippleActive && (
                    <Group opacity={rippleO}>
                      <Circle cx={c.cx} cy={c.cy} r={rippleR} style='stroke' strokeWidth={2.5} color={c.color} />
                    </Group>
                  )}
                  {flashAngle !== null && (
                    <Group opacity={flashO}>
                      <Line p1={vec(c.cx, c.cy)} p2={vec(c.cx + Math.cos(flashAngle) * tripleTapFlashLength, c.cy + Math.sin(flashAngle) * tripleTapFlashLength)} color={c.color} style='stroke' strokeWidth={3} strokeCap='round' />
                    </Group>
                  )}
                </Group>
              )
            })}

          {/* Zone lines — see the comment above. Shared @tastic/sprites/hockey ZoneLine (confirmed
            identical zoneLineFraction=0.72 geometry, same default 4px strokeWidth/0.5 opacity — two
            calls, one per player's own line, rather than one shared wrapper Group, but the same
            0.5-opacity result per line either way). */}
          <ZoneLine x={x} width={width} y={p1ZoneLineY} color={p1Color} />
          <ZoneLine x={x} width={width} y={p2ZoneLineY} color={p2Color} />

          {/* Goal lines — full board width like a real rink's goal line, broken across the actual
            goal opening (matching the perimeter walls' own gap below) so the line itself marks
            exactly where the goal's edges are, staying at y/y+height always so it lines up with
            the posts exactly like before. Color is the only thing that changes: each player's own
            color when Settings.rink is on (a painted line in front of an open pocket — see
            rinkPerimeterPath's own comment on why nothing else is drawn there), or plain wallColor
            when rink is off (board.behindGoalDepth is exactly 0 then — see computeBoardLayout),
            since with no pocket behind it this line IS the solid boundary a puck stops dead at,
            and should read like the neutral perimeter walls elsewhere rather than a permeable
            painted stripe. */}
          <Line p1={vec(x, y)} p2={vec(goalAbsLeft, y)} color={board.behindGoalDepth === 0 ? wallColor : p2Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
          <Line p1={vec(goalAbsRight, y)} p2={vec(x + width, y)} color={board.behindGoalDepth === 0 ? wallColor : p2Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
          <Line p1={vec(x, y + height)} p2={vec(goalAbsLeft, y + height)} color={board.behindGoalDepth === 0 ? wallColor : p1Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
          <Line p1={vec(goalAbsRight, y + height)} p2={vec(x + width, y + height)} color={board.behindGoalDepth === 0 ? wallColor : p1Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />

          {/* Goal door flash — fills in exactly the gap the two goal-line <Line>s above deliberately
            leave open (goalAbsLeft..goalAbsRight), same y/strokeWidth as those lines so the crisp
            core layer reads as "the goal line, right here" rather than a new element. Invisible at
            rest until a real door hit snaps both layers on (see that effect above) — this is the
            ONLY visual cue that the gap isn't actually open; without rink on there's no door to
            hit (it's gated the same way stepPhysics gates the collision itself:
            board.behindGoalDepth > 0). Glow layer (wide, low-opacity, burns off fast) renders
            BEHIND the core layer (normal width, lingers much longer) so the bright burst reads as
            sitting on top of the settling colored line, not the other way around. */}
          {/* Shared @tastic/sprites/hockey GoalDoorFlash — confirmed byte-for-byte identical logic
            (same COLOR_DECAY_MS=120/OPACITY_DECAY_MS=1200/GLOW_WIDTH_RATIO=4/GLOW_PEAK_OPACITY=0.55
            internal constants as this app's own GOAL_DOOR_FLASH_* constants, same hot-white decay
            peak color); the two-layer glow+core animation state (topGoalDoorColorT etc. above) now
            lives inside the component itself. */}
          {board.behindGoalDepth > 0 && <GoalDoorFlash leftX={goalAbsLeft} rightX={goalAbsRight} topY={y} bottomY={y + height} topColor={p2Color} bottomColor={p1Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} hitCount={goalDoorHitCount} hitSide={lastGoalDoorSide} />}

          {/* Perimeter walls — same solid, neutral wallColor style as the center divider below (not
            a themed/player color — the box itself is scaffolding, not a gameplay signal), so the
            whole structure reads as one piece built from the same material. They sit flush
            against the play field's boundary but extend outward from it (not inward, which would
            eat into gameplay space).
            The square-corner version (plain Rect, not RoundedRect — independently-rounded
            segments left a small rounded notch where two walls met at a boundary corner instead
            of a clean square joint) stays desktop-web only — see BoardProps' showWalls doc: on
            every other platform the device's own physical screen edge already reads as that
            boundary with zero gap, so drawing it again would be redundant.
            'rink's curved boundary used to render on every platform unconditionally, but per
            explicit feedback the pocket reads better with nothing drawn there at all — the puck
            should just be able to go there, all the way to the device's own physical screen edge,
            the same "no gap, no drawn line" treatment every other variant's straight boundary
            already gets (see this comment's own note on showWalls above). SHOW_RINK_DEBUG_PERIMETER
            flips the curve back on for anyone tuning cornerRadius/behindGoalDepth by eye. */}
          {SHOW_RINK_DEBUG_PERIMETER && rinkPerimeterPath && <Path path={rinkPerimeterPath} style='stroke' strokeWidth={wallThickness} strokeCap='round' color={wallColor} />}
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

          {/* Obstacles — shared @tastic/sprites/shapes ObstacleRect (plain opaque Rect, confirmed
            identical to this app's own prior inline render; strokeColor/opacity are LightCycles-only
            options this app never sets). */}
          {obstacles.map((obs, i) => (
            <ObstacleRect key={i} x={obs.x} y={obs.y} width={obs.width} height={obs.height} color={wallColor} />
          ))}

          {/* Wall posts (rink-off only — see WallPost's own comment in types/index.ts) — small round
            pegs capping each divider/gauntlet-wall gap's edges, same neutral wallColor as the
            obstacles they cap (unlike goalPosts just below, which use a per-goal accent color). */}
          {wallPosts.map((post, i) => (
            <Circle key={i} cx={post.x} cy={post.y} r={post.radius} color={wallColor} />
          ))}

          {/* Goal posts (built for every variant now — see buildGoalPosts in utils/board.ts) — small
            round pegs colored per-goal (see GoalPost's own comment in types/index.ts), not the
            neutral wallColor every obstacle above gets. Shared @tastic/sprites/shapes GoalPost
            component (confirmed byte-identical single filled Circle) — the goal-celebration flash's
            own re-render of these same posts (below, in an animated SharedValue<string> color) stays
            a plain Circle, since GoalPost's color prop is a plain string only. */}
          {goalPosts.map((post, i) => (
            <GoalPost key={i} x={post.x} y={post.y} radius={post.radius} color={post.player === 1 ? p1Color : p2Color} />
          ))}

          {/* Gravity wells */}
          {gravityWells.map((well, i) => (
            <GravityWellMarker key={i} x={well.x} y={well.y} holeRadius={well.radius} attracting={well.strength >= 0} progress={wellParticleProgress} foreground={well.strength >= 0 ? COLORS.wellAttract : COLORS.wellRepel} />
          ))}

          {/* Aim direction chevrons — dashed trail (base color + a brighter sweeping highlight per
            chevron, see ChevronMark above) bending to follow a bank shot's post-bounce direction
            wherever previewLengthPx reaches far enough to reveal it. */}
          {chevronPlacements.map((path, i) => path && <ChevronMark key={i} path={path} index={i} sweepPhase={chevronSweepPhase} color={activePlayerColor} fade={chevronFade(i, chevronPlacements.length)} />)}

          {/* Phantom puck — a drag-distance indicator anchored at the exact point you first touched
            down (aim.startX/Y), distinct from the real puck below. Releasing back near it is
            releasing near your own start point, which already cancels the shot via MIN_SHOOT_DRAG
            in useGameState's shoot() — this is a pure visual for that existing rule, no
            gameplay-logic changes needed. Not player-colored — it's a position marker, not a turn
            indicator. Deliberately gated on phase === 'aiming' alone, NOT isAimingSized: during a
            normal shot the puck sits still, so this anchor and the live puck stay coincident the
            whole time, but during an intercept the puck keeps sliding out from under a fixed
            anchor — showing this then would read as a static ghost drifting away from the real
            puck rather than a cancel-zone cue, so it's simply hidden for the isIntercepting case
            (the paddle/chevrons below still track the drag either way). */}
          {phase === 'aiming' && aim && (
            <Group opacity={0.3}>
              <Circle cx={aim.startX} cy={aim.startY} r={puckRadius} color='#000000' />
              <Circle cx={aim.startX} cy={aim.startY} r={puckRadius} style='stroke' strokeWidth={2} color='#FFFFFF' />
            </Group>
          )}

          {/* Paddle — a solid rotated mallet head (see paddlePath above), not a ring: sits at the
            pulled-back finger position facing the puck while aiming, then swings in to strike the
            puck's edge (see contactX/Y above) once released. Mounted whenever there's a live
            drag/intercept (isAimingSized/aim) at any tier ABOVE 'off' (see shotPreviewLength's own
            doc comment — 'off' is a deliberate blind "just feel it" mode with no stick during the
            draw either), cross-faded via cancelZoneFadeOpacity — a release still inside the cancel
            zone doesn't fire a shot at all (see useGameState's shoot), so the stick reads as "not
            there yet" through a fade rather than a hard pop, same treatment as the front arrow
            below. The 'striking' branch is unaffected by BOTH gates: once a shot is actually
            committed (past STRIKE, at any preview tier) the swing itself is ordinary game feedback,
            not an aiming aid, so it always shows. Neither branch renders at all for 'flick' — see
            ControlScheme's own doc comment: there's nothing to visually "pull back" when power
            comes from swipe speed, not distance, so a stick here would show a pulled-back position
            that has no bearing on the actual shot. The front arrow/chevron trail below are NOT
            gated the same way — that preview stays meaningful for 'flick' too. */}
          {!isFlick && isAimingSized && aim && shotPreviewLength !== 'off' && <Path path={aimingPaddlePath} color={activePlayerColor} opacity={cancelZoneFadeOpacity} />}
          {!isFlick && phase === 'striking' && <Path path={strikingPaddlePath} color={activePlayerColor} />}

          {/* Front power arrow — see the frontArrowPath comment above. Mirrors the paddle onto the
            puck's opposite side at the identical pulled-back distance, so the two always read as
            one matched pair: stick behind, arrow ahead — including fading in/out together via the
            same cancelZoneFadeOpacity. */}
          {frontArrowPath && <Path path={frontArrowPath} color={activePlayerColor} opacity={cancelZoneFadeOpacity} />}

          {/* Puck (+ glow, ring) — never clipped, rink pocket setting on or off. An earlier version
            clipped this to the front-line rectangle whenever the puck sat within the goal's own
            x-range, to visually "swallow" it the instant it crossed into the scoring slot. But
            the moment a puck's whole body actually clears the line, stepPhysics returns 'scored'
            and the reducer moves phase off 'simulating' right away — so any frame that's STILL
            'simulating' with the puck fully behind the line and in that x-range is, definitionally,
            a puck that did NOT score: held there by the one-way door (see stepPhysics' own
            comment) or drifted in from behind without a fresh crossing. Per explicit correction,
            that puck should stay visible — same as it already was everywhere else behind the
            line — not vanish as if it scored when it didn't. */}
          {/* Skipped entirely during 'coinFlip' — the coin-flip ceremony below stands in for the
            puck until it lands exactly where this would have rendered anyway (see its own
            comment), so drawing both at once would just double up two discs in different spots. */}
          {phase !== 'coinFlip' && (
            // opacity={puckVisibleO} is a no-op (1) outside the goal-celebration window — see that
            // effect above — so this doesn't touch normal puck visibility at all.
            <Group opacity={puckVisibleO}>
              {/* Puck glow — real game-phase-driven halo (isAimingSized/idle/interceptable), stays
                app-local; not part of the shared Disc fill+ring below (see its own comment). */}
              {(phase === 'idle' || isAimingSized || puckInterceptable) && <Circle cx={puck.x} cy={puck.y} r={glowR} color={glowColor} />}

              {/* Puck — always a flat black fill, in every phase and regardless of theme. The ring
                recolors to activePlayerColor and pulses only while waiting for a shot (idle); every
                other phase it's a plain, literal white — see idlePulseT/ringColor/ringOpacity above.
                Shared @tastic/sprites/shapes Disc (confirmed identical fill+ring shape, same 2px
                default ring strokeWidth). */}
              <Disc x={puck.x} y={puck.y} radius={puckRadius} color='#000000' ringColor={ringColor} ringWidth={2} ringOpacity={ringOpacity} />
            </Group>
          )}

          {/* Goal celebration: board flash → goal line/post flash → expanding rings (unchanged) →
            scorer's crease sweep. Placed after the puck/paddle so nothing else buries them. */}
          {lastScoredGoal !== null && (
            <>
              <Group opacity={boardFlashO}>
                <Rect x={x} y={y} width={width} height={height} color={celebColor} />
              </Group>

              <Group opacity={goalEdgeFlashT}>
                {/* Crease half-circle light-up — the whole goalie box, not just the line/posts, per
                  explicit request. Same path the resting ambient tint uses (p1CreaseFill/
                  p2CreaseFill below) at the scored-on side — celebColor already picks that same
                  side's defender color (see celebColor's own comment), so this just reuses it. A
                  fresh overlay copy, not a change to the always-present dim tint underneath. */}
                <Path path={lastScoredGoal === 'top' ? p2CreaseFill : p1CreaseFill} color={goalEdgeFlashColor} opacity={GOAL_CREASE_FLASH_PEAK_OPACITY} />
                {lastScoredGoal === 'top' ? (
                  <>
                    <Line p1={vec(x, y)} p2={vec(goalAbsLeft, y)} color={goalEdgeFlashColor} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
                    <Line p1={vec(goalAbsRight, y)} p2={vec(x + width, y)} color={goalEdgeFlashColor} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
                  </>
                ) : (
                  <>
                    <Line p1={vec(x, y + height)} p2={vec(goalAbsLeft, y + height)} color={goalEdgeFlashColor} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
                    <Line p1={vec(goalAbsRight, y + height)} p2={vec(x + width, y + height)} color={goalEdgeFlashColor} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
                  </>
                )}
                {goalPosts
                  .filter((post) => post.player === (lastScoredGoal === 'top' ? 2 : 1))
                  .map((post, i) => (
                    <Circle key={i} cx={post.x} cy={post.y} r={post.radius} color={goalEdgeFlashColor} />
                  ))}
              </Group>

              <CelebrationRings x={goalCX} y={celebCY} color={celebColor} baseRadius={puckRadius} maxExpansionRadius={board.goalWidth * 0.85} triggerKey={lastScoredGoal} />

              {wedgeFlashScorer !== null &&
                wedgeFlashNewIndex >= 0 &&
                Array.from({ length: wedgeFlashNewIndex + 1 }, (_, i) => {
                  const isFinal = i === wedgeFlashNewIndex
                  return <WedgeFlashOverlay key={i} path={wedgeFlashScorer === 1 ? p1Wedges[i] : p2Wedges[i]} clockMs={wedgeFlashClockMs} startMs={i * wedgeFlashStepMs} durationMs={isFinal ? GOAL_WEDGE_FLASH_FINAL_MS : GOAL_WEDGE_FLASH_SEG_MS} peakOpacity={isFinal ? 1 : 0.65} color={wedgeFlashScorer === 1 ? p1Color : p2Color} blinkCount={isFinal ? GOAL_WEDGE_FLASH_FINAL_BLINKS : undefined} />
                })}

              {/* Puck departure burst — see the puckBurstProgress effect above. Shards fan out evenly
                around the puck's own resting (x, y) at the moment it scored, in celebColor to tie
                into the rest of the celebration's color language. */}
              {Array.from({ length: PUCK_BURST_SHARD_COUNT }, (_, i) => (
                <PuckShard key={i} cx={puck.x} cy={puck.y} angleRad={(i / PUCK_BURST_SHARD_COUNT) * Math.PI * 2} maxDist={puckBurstMaxDist} radius={puckBurstShardR} color={celebColor} progress={puckBurstProgress} />
              ))}
            </>
          )}

          {/* Coin flip invite — the plain neutral pulse inviting the tap, before anything spins.
            Same coinFlipCX/CY/R the flip disc below uses (both rest at board-center/big whenever
            coinFlipCenteredT is 1 — see its own comment), so this hands off to the spin with zero
            visual jump the instant the tap lands. Solid black fill underneath, same as the real
            puck's own look (see its render further down) — a stroke ring alone would leave the
            board's own lines/dividers visible straight through its middle instead of reading as a
            solid disc. Only the ring's opacity breathes; the fill stays fully opaque throughout. */}
          {coinFlipAwaitingTap && (
            <Group>
              <Circle cx={coinFlipCX} cy={coinFlipCY} r={coinFlipR} color='#000000' />
              <Group opacity={coinFlipInvitePulse}>
                <Circle cx={coinFlipCX} cy={coinFlipCY} r={coinFlipR} style='stroke' strokeWidth={2} color={wallColor} />
              </Group>
            </Group>
          )}

          {/* Coin flip ceremony — see the comment above. Waits on coinFlipStarted (the tap) before
            rendering at all. Topmost/last so it always draws over everything else on the board
            while it plays. */}
          {phase === 'coinFlip' && coinFlipStarted && (
            <Group origin={coinFlipOrigin} transform={coinFlipTransform}>
              <Circle cx={coinFlipCX} cy={coinFlipCY} r={coinFlipR} color={coinFlipFillColor} />
              <Circle cx={coinFlipCX} cy={coinFlipCY} r={coinFlipR} style='stroke' strokeWidth={2} color='#FFFFFF' />
            </Group>
          )}
        </Group>
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { bottom: 0, flex: 1, left: 0, position: 'absolute', right: 0 }
})
