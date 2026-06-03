import { Canvas, Circle, DashPathEffect, Group, Line, Path, RadialGradient, Rect, Skia, vec } from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { cancelAnimation, Easing, useDerivedValue, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated'

import { COLORS, MAX_DRAG_PIXELS, MAX_SPEED, MIN_SHOOT_DRAG, WALL_THICKNESS } from '@/constants/game'
import { AimIndicator, BoardLayout, GamePhase, Player, PuckState } from '@/types'
import { computeTrajectory } from '@/utils/physics'

interface Props {
  board: BoardLayout
  puck: PuckState
  aim: AimIndicator | null
  phase: GamePhase
  currentPlayer: Player
  lastScoredGoal: 'top' | 'bottom' | null
}

export default function Board({ board, puck, aim, phase, currentPlayer, lastScoredGoal }: Props) {
  const { x, y, width, height, goalLeft, goalRight, puckRadius, obstacles } = board
  const wt = WALL_THICKNESS

  const goalAbsLeft = x + goalLeft
  const goalAbsRight = x + goalRight
  const goalCX = x + width / 2

  const puckColor = currentPlayer === 1 ? COLORS.p1 : COLORS.p2
  const puckLight = currentPlayer === 1 ? COLORS.p1Light : COLORS.p2Light
  const puckDark = currentPlayer === 1 ? COLORS.p1Dark : COLORS.p2Dark

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
  const celebColor = lastScoredGoal === 'top' ? COLORS.p1 : COLORS.p2

  // ─── Trajectory preview ───────────────────────────────────────────────────
  const trajectoryPath = useMemo(() => {
    if (!aim || phase !== 'aiming') return null
    const dx = aim.currentX - aim.startX
    const dy = aim.currentY - aim.startY
    if (Math.sqrt(dx * dx + dy * dy) < MIN_SHOOT_DRAG) return null
    const points = computeTrajectory(puck.x, puck.y, dx, dy, board, MAX_DRAG_PIXELS, MAX_SPEED)
    if (points.length < 2) return null
    const path = Skia.Path.Make()
    path.moveTo(points[0].x, points[0].y)
    for (const pt of points.slice(1)) path.lineTo(pt.x, pt.y)
    return path
  }, [aim, puck.x, puck.y, board, phase])

  // ─── Aim arrow ────────────────────────────────────────────────────────────
  const aimData = (() => {
    if (!aim || phase !== 'aiming') return null
    const dx = aim.currentX - aim.startX
    const dy = aim.currentY - aim.startY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 4) return null
    const power = Math.min(dist / MAX_DRAG_PIXELS, 1)
    const nx = dx / dist
    const ny = dy / dist
    const len = power * 90
    const toX = puck.x + nx * len
    const toY = puck.y + ny * len
    const aw = 8
    const al = 14
    return { fromX: puck.x, fromY: puck.y, toX, toY, ax1: toX - nx * al + ny * aw, ay1: toY - ny * al - nx * aw, ax2: toX - nx * al - ny * aw, ay2: toY - ny * al + nx * aw }
  })()

  const aimLinePath = useMemo(() => {
    if (!aimData) return null
    const path = Skia.Path.Make()
    path.moveTo(aimData.fromX, aimData.fromY)
    path.lineTo(aimData.toX, aimData.toY)
    return path
  }, [aimData])

  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Board surface */}
        <Rect x={x} y={y} width={width} height={height} color={COLORS.boardSurface} />

        {/* Center line */}
        <Line p1={vec(x + wt, y + height / 2)} p2={vec(x + width - wt, y + height / 2)} color={COLORS.centerLine} strokeWidth={1} />

        {/* Goal zones */}
        <Rect x={goalAbsLeft} y={y} width={goalAbsRight - goalAbsLeft} height={puckRadius * 2.2} color={COLORS.goalOpening} />
        <Rect x={goalAbsLeft} y={y + height - puckRadius * 2.2} width={goalAbsRight - goalAbsLeft} height={puckRadius * 2.2} color={COLORS.goalOpening} />

        {/* Goal lines */}
        <Line p1={vec(goalAbsLeft, y)} p2={vec(goalAbsRight, y)} color={COLORS.goalLine} strokeWidth={2} />
        <Line p1={vec(goalAbsLeft, y + height)} p2={vec(goalAbsRight, y + height)} color={COLORS.goalLine} strokeWidth={2} />

        {/* Walls */}
        <Rect x={x} y={y} width={goalLeft} height={wt} color={COLORS.wall} />
        <Rect x={goalAbsRight} y={y} width={width - goalRight} height={wt} color={COLORS.wall} />
        <Rect x={x} y={y + height - wt} width={goalLeft} height={wt} color={COLORS.wall} />
        <Rect x={goalAbsRight} y={y + height - wt} width={width - goalRight} height={wt} color={COLORS.wall} />
        <Rect x={x} y={y} width={wt} height={height} color={COLORS.wall} />
        <Rect x={x + width - wt} y={y} width={wt} height={height} color={COLORS.wall} />

        {/* Obstacles */}
        {obstacles.map((obs, i) => (
          <Rect key={i} x={obs.x} y={obs.y} width={obs.width} height={obs.height} color={COLORS.wall} />
        ))}

        {/* Trajectory preview */}
        {trajectoryPath && (
          <Path path={trajectoryPath} style='stroke' strokeWidth={1.5} color='rgba(255,255,255,0.2)' strokeCap='round' strokeJoin='round'>
            <DashPathEffect intervals={[4, 7]} />
          </Path>
        )}

        {/* Aim arrow */}
        {aimData && aimLinePath && (
          <Group>
            <Path path={aimLinePath} style='stroke' strokeWidth={2} color={COLORS.aimLine} strokeCap='round'>
              <DashPathEffect intervals={[8, 6]} />
            </Path>
            <Line p1={vec(aimData.toX, aimData.toY)} p2={vec(aimData.ax1, aimData.ay1)} color={COLORS.aimArrow} strokeWidth={2.5} strokeCap='round' />
            <Line p1={vec(aimData.toX, aimData.toY)} p2={vec(aimData.ax2, aimData.ay2)} color={COLORS.aimArrow} strokeWidth={2.5} strokeCap='round' />
          </Group>
        )}

        {/* Puck glow */}
        {(phase === 'idle' || phase === 'aiming') && (
          <Circle cx={puck.x} cy={puck.y} r={glowR} color='rgba(255,255,255,0.13)' />
        )}

        {/* Puck */}
        <Circle cx={puck.x} cy={puck.y} r={puckRadius}>
          <RadialGradient
            c={vec(puck.x - puckRadius * 0.25, puck.y - puckRadius * 0.3)}
            r={puckRadius * 1.5}
            colors={['#FFFFFF', puckLight, puckColor, puckDark, '#000000']}
            positions={[0, 0.1, 0.45, 0.75, 1]}
          />
        </Circle>

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

      {/* Goal direction labels */}
      <View style={[styles.goalLabel, { top: y + 2, left: goalAbsLeft, width: goalAbsRight - goalAbsLeft }]}>
        <Text style={[styles.goalLabelText, { color: COLORS.p1 }]}>P1 ▲</Text>
      </View>
      <View style={[styles.goalLabel, { top: y + height - 14, left: goalAbsLeft, width: goalAbsRight - goalAbsLeft }]}>
        <Text style={[styles.goalLabelText, { color: COLORS.p2 }]}>▼ P2</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  goalLabel: { alignItems: 'center', position: 'absolute' },
  goalLabelText: { fontSize: 9, fontWeight: 'bold', letterSpacing: 1, opacity: 0.7 }
})
