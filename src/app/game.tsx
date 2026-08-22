import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, FAB, useVibration } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Text } from 'react-native-paper'
import Animated, { runOnJS, useAnimatedReaction } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Board from '@/components/BoardHost'
import { BOARD_DEFAULT_ZOOM, STRIKE_DURATION_MS } from '@/constants/game'
import { useAIOpponent } from '@/hooks/useAIOpponent'
import { useBoardCamera } from '@/hooks/useBoardCamera'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useGameState } from '@/hooks/useGameState'
import { Player, PuckState } from '@/types'
import { computeBoardLayout, computeViewportSize } from '@/utils/board'
import { screenDeltaToBoard, screenToBoard } from '@/utils/camera'
import { DEFAULT_SETTINGS } from '@/utils/gameSettingsValidation'

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

export default function GameScreen() {
  // Committed once by /loadout when every human player readied up (see commitRoundSettings) —
  // falls back to defaults for a direct/deep link to this screen, which never went through
  // /loadout to commit anything. orientationMode is a /loadout-only layout setting (see
  // types/index.ts) and never reaches here — the device stays fixed-portrait (see app.json).
  const { activeRoundSettings } = useGameSettings()
  const roundSettings = activeRoundSettings ?? DEFAULT_SETTINGS
  const scoreToWin = roundSettings.scoreToWin
  const layout = roundSettings.boardVariant
  // Only P2 can be CPU-controlled for now — pass-and-play stays the default, single-player just
  // swaps who takes P2's turns (see useAIOpponent, which plays the exact same gesture contract).
  const aiPlayer: Player | null = roundSettings.gameMode === 'vsCpu' ? 2 : null
  const aiDifficulty = roundSettings.aiDifficulty

  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const board = useMemo(() => computeBoardLayout(width, height, insets, layout), [width, height, insets, layout])
  const viewport = useMemo(() => computeViewportSize(width, height, insets), [width, height, insets])
  const camera = useBoardCamera(viewport.width, viewport.height)

  const { state, tryAimStart, aimUpdate, aimCancel, shoot, applyStrike, nextRound, resetGame } = useGameState(board, scoreToWin)
  const { phase, puck, aim, currentPlayer, scores, bounceCount, lastScoredGoal, wellEnterCount, lastWellPolarity } = state

  useAIOpponent(state, board, aiPlayer, aiDifficulty, { tryAimStart, aimUpdate, shoot })

  const playerLabel = useCallback((p: Player) => (aiPlayer === p ? 'CPU' : `P${p}`), [aiPlayer])

  const vibration = useVibration()
  const vibrationRef = useRef(vibration)
  vibrationRef.current = vibration

  const { success: toastSuccess } = useToast()

  const { dark } = useAutoPaperTheme()

  // High-contrast retro look, matching the home screen: literal black/white by appearance, not
  // auto-paper's own (slightly tinted) background role.
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
  const fabBg = dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)'

  // ─── Corner FABs (back, fit-to-view) ──────────────────────────────────────
  // Both hide while aiming — nothing to declutter a shot lining up in the corners for — and the
  // fit button additionally only shows once there's actually something to reset (camera.scale/
  // translateX/translateY live on the UI thread as SharedValues, so bridging "am I at the default
  // view" to a plain JS boolean FAB can read needs useAnimatedReaction rather than a direct read).
  const [isDefaultZoom, setIsDefaultZoom] = useState(true)
  useAnimatedReaction(
    () => camera.scale.value === BOARD_DEFAULT_ZOOM && camera.translateX.value === 0 && camera.translateY.value === 0,
    (atDefault, prevAtDefault) => {
      if (atDefault !== prevAtDefault) runOnJS(setIsDefaultZoom)(atDefault)
    }
  )

  // ─── Auto-advance from 'scored' ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'scored') return
    const t = setTimeout(() => nextRound(board), 1200)
    return () => clearTimeout(t)
  }, [phase, board, nextRound])

  // ─── Strike swing: pull-back released, stick rushes the puck ─────────────
  // The puck's velocity is already computed (see useGameState's shoot) but held in
  // `pendingShot` until this fires — Board.tsx spends this window animating the stick from the
  // pulled-back finger position to the puck, then APPLY_STRIKE sets it moving.
  useEffect(() => {
    if (phase !== 'striking') return
    const t = setTimeout(() => applyStrike(), STRIKE_DURATION_MS)
    return () => clearTimeout(t)
  }, [phase, applyStrike])

  // ─── Haptics ──────────────────────────────────────────────────────────────
  const firstBounceRender = useRef(true)
  useEffect(() => {
    if (firstBounceRender.current) {
      firstBounceRender.current = false
      return
    }
    vibrationRef.current.short()
  }, [bounceCount])

  const firstWellRender = useRef(true)
  useEffect(() => {
    if (firstWellRender.current) {
      firstWellRender.current = false
      return
    }
    if (lastWellPolarity === 'repel') vibrationRef.current.long()
    else vibrationRef.current.medium()
  }, [wellEnterCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevScoresRef = useRef(scores)
  useEffect(() => {
    const [prevP1, prevP2] = prevScoresRef.current
    prevScoresRef.current = scores
    if (scores[0] !== prevP1 || scores[1] !== prevP2) {
      vibrationRef.current.notification()
    }
  }, [scores])

  // ─── Game over toast ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'gameOver') return
    const winner: Player = scores[0] >= scoreToWin ? 1 : 2
    toastSuccess(`${playerLabel(winner)} Wins!`, `${scores[0]} – ${scores[1]}`)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Gesture bridge ───────────────────────────────────────────────────────
  const puckRef = useRef<PuckState>(puck)
  puckRef.current = puck
  const puckRadiusRef = useRef(board.puckRadius)
  puckRadiusRef.current = board.puckRadius

  const stableAimStart = useCallback(
    (x: number, y: number) => {
      const started = tryAimStart(x, y, puckRef.current, puckRadiusRef.current)
      if (started) vibrationRef.current.short()
    },
    [tryAimStart]
  )

  const stableAimUpdate = useCallback(
    (x: number, y: number) => {
      aimUpdate(x, y)
    },
    [aimUpdate]
  )
  const stableShoot = useCallback(
    (tx: number, ty: number) => {
      shoot(tx, ty)
    },
    [shoot]
  )
  const stableAimCancel = useCallback(() => {
    aimCancel()
  }, [aimCancel])

  // Restricted to a single pointer so that a second finger touching down mid-drag makes this
  // gesture fail (RNGH's maxPointers behavior) rather than fight the board's pinch/pan camera —
  // see useBoardCamera.ts. Touches arrive in the outer, untransformed container's own coordinate
  // space (unaffected by the camera's transform on its inner wrapper), so they're converted back
  // to board space here before reaching game state, which never sees the camera at all.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onStart((e) => {
          const p = screenToBoard(e.x, e.y, { scale: camera.scale.value, translateX: camera.translateX.value, translateY: camera.translateY.value })
          runOnJS(stableAimStart)(p.x, p.y)
        })
        .onChange((e) => {
          const p = screenToBoard(e.x, e.y, { scale: camera.scale.value, translateX: camera.translateX.value, translateY: camera.translateY.value })
          runOnJS(stableAimUpdate)(p.x, p.y)
        })
        .onEnd((e) => {
          const d = screenDeltaToBoard(e.translationX, e.translationY, camera.scale.value)
          runOnJS(stableShoot)(d.x, d.y)
        })
        .onFinalize(() => {
          runOnJS(stableAimCancel)()
        })
        .minDistance(0),
    [stableAimStart, stableAimUpdate, stableShoot, stableAimCancel, camera.scale, camera.translateX, camera.translateY]
  )

  // ─── Derived display values ───────────────────────────────────────────────
  // Also gated on it not being the CPU's turn, so a stray touch during single-player can't hijack
  // its shot — pass-and-play (aiPlayer === null) keeps its original "whoever touches goes" rule.
  const gestureEnabled = (phase === 'idle' || phase === 'aiming') && currentPlayer !== aiPlayer

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Board + gesture layer, starting right at the safe area (marginTop: insets.top) — no
          score bar or turn indicator above it: the puck's own color already says whose turn it
          is, and the score lives on the board itself as pips at each goal (see Board.tsx).
          camera.cameraGesture (pinch to zoom + a separate two-finger pan, see useBoardCamera)
          always runs; the one-finger aim gesture only races it during idle/aiming — both are
          attached to the untransformed View below, while only the inner Animated.View gets the
          camera's transform (`overflow: hidden` on the outermost View keeps a zoomed-in board
          from bleeding past this container). camera.boardAreaRef sits on this outer View rather
          than GestureDetector's own child, which manages that child's ref internally — a web-only
          wheel listener (trackpad pinch/scroll, see useBoardCamera.ts) attaches there instead. */}
      <View ref={camera.boardAreaRef} style={[styles.boardArea, { marginTop: insets.top }]}>
        <GestureDetector gesture={Gesture.Race(camera.cameraGesture, panGesture.enabled(gestureEnabled))}>
          <View style={styles.boardAreaTouchable}>
            <Animated.View style={[styles.boardInner, camera.animatedStyle]}>
              <Board board={board} puck={puck} aim={aim} phase={phase} currentPlayer={currentPlayer} lastScoredGoal={lastScoredGoal} scores={scores} scoreToWin={scoreToWin} camera={{ scale: camera.scale, translateX: camera.translateX, translateY: camera.translateY }} />
            </Animated.View>
          </View>
        </GestureDetector>
      </View>

      {/* Game Over overlay */}
      {phase === 'gameOver' && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: fg, fontFamily: MONO_FONT }]}>
              {playerLabel(scores[0] >= scoreToWin ? 1 : 2)} Wins!
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { color: fgMuted, fontFamily: MONO_FONT }]}>
              {scores[0]} – {scores[1]}
            </Text>
            <Button mode='contained' onPress={() => resetGame(board)} style={styles.overlayButton}>
              Play Again
            </Button>
            <Button mode='outlined' onPress={() => router.back()} style={styles.overlayButton}>
              Loadout
            </Button>
          </View>
        </View>
      )}

      <FAB icon='arrow-left' color={fgMuted} customSize={36} mode='flat' visible={phase !== 'aiming'} style={[styles.backButton, { top: insets.top + 4, backgroundColor: fabBg }]} onPress={() => router.back()} />
      <FAB icon='crop-free' color={fgMuted} customSize={36} mode='flat' visible={!isDefaultZoom && phase !== 'aiming'} style={[styles.resetZoomButton, { top: insets.top + 4, backgroundColor: fabBg }]} onPress={() => camera.reset()} />
    </View>
  )
}

const styles = StyleSheet.create({
  backButton: { left: 4, position: 'absolute' },
  // overflow: 'hidden' clips the inner board once it's zoomed past this container's own bounds —
  // without it a zoomed-in board would bleed off the screen edges.
  boardArea: { flex: 1, overflow: 'hidden' },
  boardAreaTouchable: { flex: 1 },
  // transformOrigin pins the camera's scale to the top-left corner (see useBoardCamera.ts) so its
  // `transform: [{translateX},{translateY},{scale}]` matches camera.ts's own screen = translate +
  // board*scale convention exactly, with no center-pivot compensation needed.
  boardInner: { flex: 1, transformOrigin: 'left top' },
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
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    padding: 32
  },
  overlayScore: {},
  overlayTitle: { fontWeight: 'bold' },
  resetZoomButton: { position: 'absolute', right: 4 },
  root: { flex: 1 }
})
