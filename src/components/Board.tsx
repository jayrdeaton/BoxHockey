import { getContrastColor, useAutoPaperTheme } from '@rific/auto-paper'
import { Canvas, Circle, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { cancelAnimation, Easing, SharedValue, useDerivedValue, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated'

import { BOARD_DEFAULT_ZOOM, COLORS, MIN_SHOOT_DRAG, STRIKE_DURATION_MS } from '@/constants/game'
import { AimIndicator, BoardLayout, GamePhase, Player, PuckState } from '@/types'
import { computeScorePipLayout } from '@/utils/scorePips'

import { GravityWellMarker } from './GravityWellMarker'

const AIM_CHEVRON_COUNT = 3

export interface BoardCamera {
  scale: SharedValue<number>
  translateX: SharedValue<number>
  translateY: SharedValue<number>
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
  camera: BoardCamera
}

export default function Board({ board, puck, aim, phase, currentPlayer, lastScoredGoal, scores, scoreToWin, camera }: BoardProps) {
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
  const aimIndicatorColor = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  const wellHoleColor = dark ? '#000000' : '#FFFFFF'

  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary
  const puckColor = currentPlayer === 1 ? p1Color : p2Color
  const puckStroke = getContrastColor(puckColor)

  // ─── Perimeter wall visibility ────────────────────────────────────────────
  // The walls (see the Rects below) are drawn outward from the play field, not inward — at the
  // camera's default fit-to-screen position they'd just add visual noise hugging the screen edge,
  // so they stay hidden there and only fade in once the camera actually departs from that resting
  // position (see useBoardCamera.ts), whether by zooming out or panning. Driven straight off the
  // camera's own shared values (not the JS-thread `isDefaultZoom` state game.tsx derives from the
  // same values for its reset FAB) so this tracks the live gesture with no bridge lag.
  const wallOpacity = useDerivedValue(() => {
    const zoomed = Math.abs(camera.scale.value - BOARD_DEFAULT_ZOOM) > 0.001
    const panned = Math.abs(camera.translateX.value) > 0.5 || Math.abs(camera.translateY.value) > 0.5
    return zoomed || panned ? 1 : 0
  })

  // ─── Score pips ───────────────────────────────────────────────────────────
  // One row per goal, filled in with that player's own color as they score — positioned at their
  // own goal (like foosball's scoring beads) rather than as a top-of-screen HUD readout. Sized to
  // fill a fixed fraction of the board's width regardless of scoreToWin, so "first to 3" isn't
  // three tiny dots and "first to 10" isn't ten overflowing ones.
  const pipLayout = useMemo(() => computeScorePipLayout(width * 0.6, scoreToWin), [width, scoreToWin])
  const pipInset = width * 0.055
  const p1PipY = y + pipInset
  const p2PipY = y + height - pipInset

  // ─── Pulsing glow (idle) / static glow (aiming) ──────────────────────────
  const glowR = useSharedValue(puckRadius * 1.3)

  useEffect(() => {
    if (phase === 'idle') {
      glowR.value = puckRadius * 1.3
      glowR.value = withRepeat(withTiming(puckRadius * 1.65, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(glowR)
      glowR.value = phase === 'aiming' ? puckRadius * 1.45 : puckRadius * 1.3
    }
  }, [phase, puckRadius]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Gravity well particle clock ──────────────────────────────────────────
  // Decorative, independent of the physics loop — runs continuously regardless
  // of game phase, same "clock owned once by Board.tsx" idea as glowR above.
  const wellParticleProgress = useSharedValue(0)

  useEffect(() => {
    wellParticleProgress.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.linear }), -1, false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Goal celebration rings ───────────────────────────────────────────────
  // Keep puckRadius and maxRingR as shared values so derived values stay current
  // even if the board is resized (screen rotation, etc.).
  const puckRadiusSV = useSharedValue(puckRadius)
  puckRadiusSV.value = puckRadius
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
  const celebColor = lastScoredGoal === 'top' ? p1Color : p2Color

  // ─── Aim direction chevrons ────────────────────────────────────────────────
  // Deliberately NOT a simulated trajectory: showing the full bounced-off-everything path told
  // the player exactly where the puck would end up before they even shot, which left no guessing
  // (and no skill) in banking a shot off a wall/obstacle. A few short chevrons just past the stick
  // convey "this is the direction you're about to fire" without previewing the outcome.
  // Pull-back aiming: the puck fires in the OPPOSITE direction from the drag (like a slingshot
  // or pool cue), so the chevrons point from the puck toward -drag, not toward the drag itself.
  const aimChevronsPath = useMemo(() => {
    if (!aim || phase !== 'aiming') return null
    const dx = aim.startX - aim.currentX
    const dy = aim.startY - aim.currentY
    const dragDist = Math.sqrt(dx * dx + dy * dy)
    if (dragDist < MIN_SHOOT_DRAG) return null

    const ux = dx / dragDist
    const uy = dy / dragDist
    const px = -uy
    const py = ux

    const chevronWidth = puckRadius * 0.5
    const chevronDepth = puckRadius * 0.45
    const spacing = puckRadius * 0.75
    const startOffset = puckRadius * 1.7 // clears the stick circle (r = puckRadius * 1.15)

    const path = Skia.Path.Make()
    for (let i = 0; i < AIM_CHEVRON_COUNT; i++) {
      const tipDist = startOffset + i * spacing
      const tipX = puck.x + ux * tipDist
      const tipY = puck.y + uy * tipDist
      const backX = tipX - ux * chevronDepth
      const backY = tipY - uy * chevronDepth
      path.moveTo(backX + px * chevronWidth, backY + py * chevronWidth)
      path.lineTo(tipX, tipY)
      path.lineTo(backX - px * chevronWidth, backY - py * chevronWidth)
    }
    return path
  }, [aim, puck.x, puck.y, puckRadius, phase])

  // ─── Stick/paddle ─────────────────────────────────────────────────────────
  // While aiming, the stick sits right where the player's finger is (pulled back from the
  // puck). It tracks the finger 1:1, so no animation is needed here — that's reserved for the
  // strike swing below.
  const stickRadius = puckRadius * 1.15

  // On release, the stick swings from that pulled-back spot to the puck over STRIKE_DURATION_MS
  // (see useGameState/game.tsx) — captured once per swing, not re-triggered by later renders.
  const strikeX = useSharedValue(0)
  const strikeY = useSharedValue(0)

  useEffect(() => {
    if (phase !== 'striking' || !aim) return
    strikeX.value = aim.currentX
    strikeY.value = aim.currentY
    strikeX.value = withTiming(puck.x, { duration: STRIKE_DURATION_MS, easing: Easing.in(Easing.cubic) })
    strikeY.value = withTiming(puck.y, { duration: STRIKE_DURATION_MS, easing: Easing.in(Easing.cubic) })
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Center line */}
        <Line p1={vec(x, y + height / 2)} p2={vec(x + width, y + height / 2)} color={lineColor} strokeWidth={1} />

        {/* Goal lines */}
        <Line p1={vec(goalAbsLeft, y)} p2={vec(goalAbsRight, y)} color={lineColor} strokeWidth={2} />
        <Line p1={vec(goalAbsLeft, y + height)} p2={vec(goalAbsRight, y + height)} color={lineColor} strokeWidth={2} />

        {/* Perimeter walls — filled bars the same thickness and color as the center divider
            (below), so the whole structure reads as one piece built from the same material,
            rather than a thin outline around solid obstacles. They sit flush against the play
            field's boundary but extend outward from it (not inward, which would eat into
            gameplay space) and fade in only once the camera leaves its default resting position
            (see wallOpacity above) — hidden at rest so they don't add visual noise hugging the
            screen edge, but there to find once the player zooms out or pans. */}
        <Group opacity={wallOpacity}>
          <Rect x={x - wallThickness} y={y - wallThickness} width={wallThickness} height={height + wallThickness * 2} color={wallColor} />
          <Rect x={x + width} y={y - wallThickness} width={wallThickness} height={height + wallThickness * 2} color={wallColor} />
          <Rect x={x} y={y - wallThickness} width={goalAbsLeft - x} height={wallThickness} color={wallColor} />
          <Rect x={goalAbsRight} y={y - wallThickness} width={x + width - goalAbsRight} height={wallThickness} color={wallColor} />
          <Rect x={x} y={y + height} width={goalAbsLeft - x} height={wallThickness} color={wallColor} />
          <Rect x={goalAbsRight} y={y + height} width={x + width - goalAbsRight} height={wallThickness} color={wallColor} />
        </Group>

        {/* Obstacles */}
        {obstacles.map((obs, i) => (
          <Rect key={i} x={obs.x} y={obs.y} width={obs.width} height={obs.height} color={wallColor} />
        ))}

        {/* Gravity wells */}
        {gravityWells.map((well, i) => (
          <GravityWellMarker key={i} x={well.x} y={well.y} holeRadius={well.radius} attracting={well.strength >= 0} progress={wellParticleProgress} foreground={well.strength >= 0 ? COLORS.wellAttract : COLORS.wellRepel} background={wellHoleColor} />
        ))}

        {/* Aim direction chevrons */}
        {aimChevronsPath && <Path path={aimChevronsPath} style='stroke' strokeWidth={2.5} color={aimIndicatorColor} strokeCap='round' strokeJoin='round' />}

        {/* Stick/paddle — sits at the pulled-back finger position while aiming, then swings in
            to strike the puck once released */}
        {phase === 'aiming' && aim && <Circle cx={aim.currentX} cy={aim.currentY} r={stickRadius} style='stroke' strokeWidth={3} color={puckColor} />}
        {phase === 'striking' && <Circle cx={strikeX} cy={strikeY} r={stickRadius} style='stroke' strokeWidth={3} color={puckColor} />}

        {/* Puck glow */}
        {(phase === 'idle' || phase === 'aiming') && <Circle cx={puck.x} cy={puck.y} r={glowR} color={glowColor} />}

        {/* Puck — flat fill + bold contrasting outline, no gradient */}
        <Circle cx={puck.x} cy={puck.y} r={puckRadius} color={puckColor} />
        <Circle cx={puck.x} cy={puck.y} r={puckRadius} style='stroke' strokeWidth={2} color={puckStroke} />

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

        {/* Score pips — one row per goal, filled with that player's color as they score */}
        <Group>
          {pipLayout.centerXs.map((dx, i) => (i < scores[0] ? <Circle key={`p1-pip-${i}`} cx={goalCX + dx} cy={p1PipY} r={pipLayout.radius} color={p1Color} /> : <Circle key={`p1-pip-${i}`} cx={goalCX + dx} cy={p1PipY} r={pipLayout.radius} style='stroke' strokeWidth={1.5} color={lineColor} />))}
          {pipLayout.centerXs.map((dx, i) => (i < scores[1] ? <Circle key={`p2-pip-${i}`} cx={goalCX + dx} cy={p2PipY} r={pipLayout.radius} color={p2Color} /> : <Circle key={`p2-pip-${i}`} cx={goalCX + dx} cy={p2PipY} r={pipLayout.radius} style='stroke' strokeWidth={1.5} color={lineColor} />))}
        </Group>
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
