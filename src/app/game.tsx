import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { runOnJS } from 'react-native-reanimated'
import { Button, IconButton, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Board from '@/components/Board'
import { COLORS } from '@/constants/game'
import { useGameState } from '@/hooks/useGameState'
import { BoardVariant, GamePhase, Player, PuckState } from '@/types'
import { computeBoardLayout } from '@/utils/board'

export default function GameScreen() {
  const { scoreTo: scoreToParam, layout: layoutParam } = useLocalSearchParams<{ scoreTo: string; layout: string }>()
  const scoreToWin = Math.max(1, parseInt(scoreToParam ?? '5', 10))
  const layout = (layoutParam ?? 'classic') as BoardVariant

  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const board = useMemo(() => computeBoardLayout(width, height, insets, layout), [width, height, insets, layout])

  const { state, tryAimStart, aimUpdate, aimCancel, shoot, nextRound, resetGame } = useGameState(board, scoreToWin)
  const { phase, puck, aim, currentPlayer, scores, bounceCount, lastScoredGoal } = state

  // ─── Turn handoff overlay ─────────────────────────────────────────────────
  const [showHandoff, setShowHandoff] = useState(false)
  const handoffPlayerRef = useRef<Player>(1)
  const prevPhaseRef = useRef<GamePhase>('idle')

  useEffect(() => {
    const prev = prevPhaseRef.current
    prevPhaseRef.current = phase
    if (phase === 'idle' && (prev === 'simulating' || prev === 'scored')) {
      handoffPlayerRef.current = currentPlayer
      setShowHandoff(true)
    }
  }, [phase, currentPlayer])

  // ─── Auto-advance from 'scored' ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'scored') return
    const t = setTimeout(() => nextRound(board), 1200)
    return () => clearTimeout(t)
  }, [phase, board, nextRound])

  // ─── Haptics ──────────────────────────────────────────────────────────────
  const firstBounceRender = useRef(true)
  useEffect(() => {
    if (firstBounceRender.current) { firstBounceRender.current = false; return }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [bounceCount])

  const prevScoresRef = useRef(scores)
  useEffect(() => {
    const [prevP1, prevP2] = prevScoresRef.current
    prevScoresRef.current = scores
    if (scores[0] !== prevP1 || scores[1] !== prevP2) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
  }, [scores])

  // ─── Gesture bridge ───────────────────────────────────────────────────────
  const puckRef = useRef<PuckState>(puck)
  puckRef.current = puck
  const puckRadiusRef = useRef(board.puckRadius)
  puckRadiusRef.current = board.puckRadius

  const stableAimStart = useCallback((x: number, y: number) => {
    const started = tryAimStart(x, y, puckRef.current, puckRadiusRef.current)
    if (started) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [tryAimStart])

  const stableAimUpdate = useCallback((x: number, y: number) => { aimUpdate(x, y) }, [aimUpdate])
  const stableShoot = useCallback((tx: number, ty: number) => { shoot(tx, ty) }, [shoot])
  const stableAimCancel = useCallback(() => { aimCancel() }, [aimCancel])

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart((e) => { runOnJS(stableAimStart)(e.x, e.y) })
        .onChange((e) => { runOnJS(stableAimUpdate)(e.x, e.y) })
        .onEnd((e) => { runOnJS(stableShoot)(e.translationX, e.translationY) })
        .onFinalize(() => { runOnJS(stableAimCancel)() })
        .minDistance(0),
    [stableAimStart, stableAimUpdate, stableShoot, stableAimCancel]
  )

  // ─── Derived display values ───────────────────────────────────────────────
  const gestureEnabled = (phase === 'idle' || phase === 'aiming') && !showHandoff
  const handoffColor = handoffPlayerRef.current === 1 ? COLORS.p1 : COLORS.p2
  const p1Active = currentPlayer === 1 && (phase === 'idle' || phase === 'aiming')
  const p2Active = currentPlayer === 2 && (phase === 'idle' || phase === 'aiming')
  const turnDotColor = currentPlayer === 1 ? COLORS.p1 : COLORS.p2

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={[styles.root, styles.bg]}>

        {/* Score bar */}
        <View style={[styles.scoreBar, { marginTop: insets.top }]}>
          <View style={styles.playerScore}>
            <Text variant='labelSmall' style={[styles.playerLabel, { color: p1Active ? COLORS.p1 : 'rgba(255,255,255,0.4)' }]}>P1</Text>
            <Text variant='headlineMedium' style={[styles.scoreText, { color: COLORS.p1 }]}>{scores[0]}</Text>
          </View>

          <View style={styles.centerInfo}>
            {phase === 'gameOver' ? (
              <Text variant='labelMedium' style={styles.statusText}>GAME OVER</Text>
            ) : phase === 'scored' ? (
              <Text variant='labelMedium' style={[styles.statusText, { color: turnDotColor }]}>GOAL!</Text>
            ) : (
              <View style={[styles.turnDot, { backgroundColor: turnDotColor }]} />
            )}
            <Text variant='labelSmall' style={styles.targetText}>First to {scoreToWin}</Text>
          </View>

          <View style={[styles.playerScore, styles.playerScoreRight]}>
            <Text variant='labelSmall' style={[styles.playerLabel, { color: p2Active ? COLORS.p2 : 'rgba(255,255,255,0.4)' }]}>P2</Text>
            <Text variant='headlineMedium' style={[styles.scoreText, { color: COLORS.p2 }]}>{scores[1]}</Text>
          </View>
        </View>

        {/* Board + gesture layer */}
        <GestureDetector gesture={gestureEnabled ? panGesture : Gesture.Pan().enabled(false)}>
          <View style={styles.boardArea}>
            <Board board={board} puck={puck} aim={aim} phase={phase} currentPlayer={currentPlayer} lastScoredGoal={lastScoredGoal} />
          </View>
        </GestureDetector>

        {/* Turn handoff overlay */}
        {showHandoff && (
          <TouchableOpacity activeOpacity={1} style={styles.handoffOverlay} onPress={() => setShowHandoff(false)}>
            <View style={[styles.handoffCard, { borderColor: handoffColor }]}>
              <Text variant='headlineMedium' style={[styles.handoffTitle, { color: handoffColor }]}>
                P{handoffPlayerRef.current}'s Turn
              </Text>
              <Text variant='bodySmall' style={styles.handoffHint}>Tap to shoot</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Game Over overlay */}
        {phase === 'gameOver' && (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              <Text variant='headlineLarge' style={styles.overlayTitle}>
                {scores[0] >= scoreToWin ? 'P1 Wins!' : 'P2 Wins!'}
              </Text>
              <Text variant='bodyLarge' style={styles.overlayScore}>{scores[0]} – {scores[1]}</Text>
              <Button mode='contained' onPress={() => resetGame(board)} style={styles.overlayButton}>Play Again</Button>
              <Button mode='outlined' onPress={() => router.back()} style={styles.overlayButton}>Menu</Button>
            </View>
          </View>
        )}

        <IconButton icon='arrow-left' iconColor='rgba(255,255,255,0.5)' size={22} style={[styles.backButton, { top: insets.top + 4 }]} onPress={() => router.back()} />
      </View>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  backButton: { left: 4, position: 'absolute' },
  bg: { backgroundColor: '#0A1628' },
  boardArea: { flex: 1 },
  centerInfo: { alignItems: 'center', flex: 1, gap: 2 },
  handoffCard: {
    alignItems: 'center',
    backgroundColor: '#0D1F3C',
    borderRadius: 20,
    borderWidth: 1.5,
    gap: 8,
    paddingHorizontal: 40,
    paddingVertical: 28
  },
  handoffHint: { color: 'rgba(255,255,255,0.4)' },
  handoffOverlay: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  handoffTitle: { fontWeight: 'bold' },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  overlayButton: { width: 160 },
  overlayCard: {
    alignItems: 'center',
    backgroundColor: '#0D1F3C',
    borderColor: 'rgba(200,216,240,0.2)',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    padding: 32
  },
  overlayScore: { color: 'rgba(255,255,255,0.7)' },
  overlayTitle: { color: '#FFFFFF', fontWeight: 'bold' },
  playerLabel: { fontWeight: 'bold', letterSpacing: 1 },
  playerScore: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, width: 80 },
  playerScoreRight: { justifyContent: 'flex-end' },
  root: { flex: 1 },
  scoreBar: { alignItems: 'center', flexDirection: 'row', height: 76, justifyContent: 'space-between', paddingHorizontal: 24 },
  scoreText: { color: '#FFFFFF', fontWeight: 'bold', lineHeight: 32, marginTop: 2 },
  statusText: { color: '#FFFFFF', fontWeight: 'bold', letterSpacing: 1 },
  targetText: { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  turnDot: { borderRadius: 5, height: 10, width: 10 }
})
