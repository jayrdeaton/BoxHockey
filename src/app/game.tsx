import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Icon, Text } from 'react-native-paper'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Board from '@/components/BoardHost'
import { SettingsDialog } from '@/components/SettingsDialog'
import { DESKTOP_WEB_MIN_WIDTH, FRICTION_LEVELS, SHOT_PREVIEW_LENGTH_RATIOS, STRIKE_DURATION_MS } from '@/constants/game'
import { useAIOpponent } from '@/hooks/useAIOpponent'
import { useFaceoff } from '@/hooks/useFaceoff'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useGameSound } from '@/hooks/useGameSound'
import { useGameState } from '@/hooks/useGameState'
import { useOrientationLock } from '@/hooks/useOrientationLock'
import { Player } from '@/types'
import { computeBoardLayout, faceoffZoneCenter, faceoffZoneCenters, faceoffZoneRadius } from '@/utils/board'
import { DEFAULT_SETTINGS } from '@/utils/gameSettingsValidation'
import { safeBack } from '@/utils/navigation'

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

// Web has no second pointer for a two-person race, so A/D and ←/→ stand in for P1/P2's
// left/right zone — the classic "two players share one keyboard" split (left-hand keys vs. the
// arrow cluster). Native/mobile web keeps the touch zones as the only input; these are additive.
const FACEOFF_KEY_HINTS: { player: Player; zoneIndex: 0 | 1; label: string }[] = [
  { player: 1, zoneIndex: 0, label: 'A' },
  { player: 1, zoneIndex: 1, label: 'D' },
  { player: 2, zoneIndex: 0, label: '←' },
  { player: 2, zoneIndex: 1, label: '→' }
]

export default function GameScreen() {
  // Always locked portrait, regardless of the Lock Orientation setting or how the phone is
  // actually held — the board's fixed top/bottom goal geometry (see Board.tsx/computeBoardLayout)
  // assumes a tall aspect ratio, unlike /loadout's panel arrangement, which reads fine either way.
  // Native orientation is no longer fixed at the app.json level (see /loadout and /index, which do
  // rotate), so this screen has to pin it explicitly rather than relying on that global lock.
  useOrientationLock(true, 'portrait')

  // Committed once by /loadout when every human player readied up (see commitRoundSettings) —
  // falls back to defaults for a direct/deep link to this screen, which never went through
  // /loadout to commit anything. orientationMode is a /loadout-only layout setting (see
  // types/index.ts) and never reaches here.
  const { activeRoundSettings } = useGameSettings()
  const roundSettings = activeRoundSettings ?? DEFAULT_SETTINGS
  const scoreToWin = roundSettings.scoreToWin
  const layout = roundSettings.boardVariant
  const tipoffMode = roundSettings.tipoffMode
  const friction = FRICTION_LEVELS[roundSettings.friction]
  const puckSize = roundSettings.puckSize
  // Only P2 can be CPU-controlled for now — pass-and-play stays the default, single-player just
  // swaps who takes P2's turns (see useAIOpponent, which plays the exact same gesture contract).
  const aiPlayer: Player | null = roundSettings.gameMode === 'vsCpu' ? 2 : null
  const aiDifficulty = roundSettings.aiDifficulty

  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const board = useMemo(() => computeBoardLayout(width, height, insets, layout, puckSize), [width, height, insets, layout, puckSize])
  // Resolved to pixels here (not inside Board.tsx) for the same reason `friction` is resolved
  // above — the enum→number mapping is a settings concern, board.width isn't known until here.
  const shotPreviewLengthPx = board.width * SHOT_PREVIEW_LENGTH_RATIOS[roundSettings.shotPreviewLength]

  const { state, tryAimStart, aimUpdate, aimCancel, shoot, applyStrike, nextRound, resetGame, faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart } = useGameState(board, scoreToWin, tipoffMode, friction)
  const { phase, puck, aim, currentPlayer, scores, bounceCount, lastScoredGoal, wellEnterCount, lastWellPolarity, faceoff } = state

  useAIOpponent(state, board, aiPlayer, aiDifficulty, friction, { tryAimStart, aimUpdate, shoot })
  useFaceoff(state, board, aiPlayer, aiDifficulty, { faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart })

  const vibration = useVibration()
  const vibrationRef = useRef(vibration)
  vibrationRef.current = vibration

  // Gameplay SFX — mirrors the haptics below one-for-one (see useGameSound): each event fires its
  // soundRef.current.playX() beside the matching vibrationRef.current.x(), so sound and haptic
  // feedback for a given event always stay co-located and in sync. Ref-mirrored the same way
  // vibration is above, not called directly, so the memoized gesture callbacks further down don't
  // need these in their dependency arrays.
  const playSelect = useGameSound(require('../../assets/sounds/select.wav'), { poolSize: 8 })
  const playBounce = useGameSound(require('../../assets/sounds/bounce.wav'))
  const playWellAttract = useGameSound(require('../../assets/sounds/wellAttract.wav'))
  const playWellRepel = useGameSound(require('../../assets/sounds/wellRepel.wav'))
  const playFaceoffTick = useGameSound(require('../../assets/sounds/faceoffTick.wav'))
  const playFaceoffGo = useGameSound(require('../../assets/sounds/faceoffGo.wav'))
  const playFaceoffResolved = useGameSound(require('../../assets/sounds/faceoffResolved.wav'))
  const playGoal = useGameSound(require('../../assets/sounds/goal.wav'))
  const playWin = useGameSound(require('../../assets/sounds/win.wav'))
  const soundRef = useRef({ playSelect, playBounce, playWellAttract, playWellRepel, playFaceoffTick, playFaceoffGo, playFaceoffResolved, playGoal, playWin })
  soundRef.current = { playSelect, playBounce, playWellAttract, playWellRepel, playFaceoffTick, playFaceoffGo, playFaceoffResolved, playGoal, playWin }

  const [settingsOpen, setSettingsOpen] = useState(false)
  // Only asked once there's a real score to lose — 0-0 exits immediately, since there's nothing
  // yet for a confirmation to protect (mirrors LightCycles' identical quit-confirmation gate).
  const [confirmBackVisible, setConfirmBackVisible] = useState(false)
  const onBackPress = useCallback(() => {
    if (scores[0] > 0 || scores[1] > 0) setConfirmBackVisible(true)
    else safeBack()
  }, [scores])

  // colors needed here (not just Board.tsx, which derives its own copy) for the web key hints'
  // text color — see FACEOFF_KEY_HINTS rendering below.
  const { dark, colors: themeColors } = useAutoPaperTheme()

  // High-contrast retro look, matching the home screen: literal black/white by appearance, not
  // auto-paper's own (slightly tinted) background role.
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'

  // Per-player color pair, shared by the Game Over and quit-confirmation overlays below so a
  // given player's number/name reads in their own color everywhere on this screen, not just on
  // the board itself.
  const playerColor: Record<Player, string> = { 1: themeColors.primary, 2: themeColors.secondary }
  const playerOnColor: Record<Player, string> = { 1: themeColors.onPrimary, 2: themeColors.onSecondary }
  const winner: Player = scores[0] >= scoreToWin ? 1 : 2
  const loser: Player = winner === 1 ? 2 : 1

  // Corner buttons (back/settings) fade out during an active drag rather than just disappearing —
  // FAB's own `visible` prop used to provide this for free, but the plain IconButton used here now
  // (matching index.tsx/loadout.tsx's bare-icon style) has no equivalent, so it's rebuilt directly.
  const cornerButtonsOpacity = useSharedValue(1)
  useEffect(() => {
    cornerButtonsOpacity.value = withTiming(phase === 'aiming' ? 0 : 1, { duration: 150 })
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const cornerButtonsStyle = useAnimatedStyle(() => ({ opacity: cornerButtonsOpacity.value }))

  // On a phone (native or mobile web), the device's own physical edges already read as "the
  // wall" — no drawn perimeter needed. Desktop web has no such edge (the board just floats in an
  // arbitrarily-sized browser window), so it's the one place Board.tsx still draws the perimeter
  // walls (see showWalls below).
  const isDesktopWeb = Platform.OS === 'web' && width >= DESKTOP_WEB_MIN_WIDTH

  // ─── Auto-advance from 'scored' ───────────────────────────────────────────
  // Also held while the quit confirmation is up — otherwise this timer keeps running underneath
  // the dialog and silently advances the very score the player is deciding whether to walk away
  // from. Cancelling restarts the full 1200ms wait rather than resuming mid-count, same tradeoff
  // LightCycles' onboarding countdown makes for its own settings/quit dialogs.
  useEffect(() => {
    if (phase !== 'scored' || confirmBackVisible) return
    const t = setTimeout(() => nextRound(board), 1200)
    return () => clearTimeout(t)
  }, [phase, board, nextRound, confirmBackVisible])

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
    soundRef.current.playBounce()
  }, [bounceCount])

  const firstWellRender = useRef(true)
  useEffect(() => {
    if (firstWellRender.current) {
      firstWellRender.current = false
      return
    }
    if (lastWellPolarity === 'repel') {
      vibrationRef.current.long()
      soundRef.current.playWellRepel()
    } else {
      vibrationRef.current.medium()
      soundRef.current.playWellAttract()
    }
  }, [wellEnterCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tick on each countdown number after the first (3 is already on screen at the start of a
  // round, so it doesn't itself need a tick) and a stronger pulse once the live window opens and
  // again once the draw resolves.
  const firstFaceoffCountRender = useRef(true)
  useEffect(() => {
    if (firstFaceoffCountRender.current) {
      firstFaceoffCountRender.current = false
      return
    }
    vibrationRef.current.short()
    soundRef.current.playFaceoffTick()
  }, [faceoff?.count])

  const prevFaceoffStageRef = useRef(faceoff?.stage)
  useEffect(() => {
    const prevStage = prevFaceoffStageRef.current
    prevFaceoffStageRef.current = faceoff?.stage
    if (faceoff?.stage === 'live' && prevStage !== 'live') {
      vibrationRef.current.medium()
      soundRef.current.playFaceoffGo()
    }
    if (faceoff?.stage === 'resolved' && prevStage !== 'resolved') {
      vibrationRef.current.notification()
      soundRef.current.playFaceoffResolved()
    }
  }, [faceoff?.stage])

  const prevScoresRef = useRef(scores)
  useEffect(() => {
    const [prevP1, prevP2] = prevScoresRef.current
    prevScoresRef.current = scores
    if (scores[0] !== prevP1 || scores[1] !== prevP2) {
      vibrationRef.current.notification()
      soundRef.current.playGoal()
    }
  }, [scores])

  // Victory fanfare — fires once, the instant the game actually ends, distinct from the goal sound
  // above which fires on every score including the winning one.
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== 'gameOver' && phase === 'gameOver') {
      soundRef.current.playWin()
    }
    prevPhaseRef.current = phase
  }, [phase])

  // ─── Gesture bridge ───────────────────────────────────────────────────────
  const stableAimStart = useCallback(
    (x: number, y: number) => {
      const started = tryAimStart(x, y)
      if (started) {
        vibrationRef.current.short()
        soundRef.current.playSelect()
      }
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

  // Mirrors vibrationRef/soundRef above — read live faceoff state through a ref instead of
  // closing over `faceoff` directly. `faceoff` is a new object on every single sub-action
  // (each countdown tick, hold, live flip), and these callbacks feed p1TapGesture/p2TapGesture
  // below; closing over `faceoff` would recreate those Gesture.Tap() objects on every tick,
  // tearing down and remounting the native/web gesture handler at the exact instant FACEOFF_LIVE
  // fires — the moment a real tap is most likely to land — silently dropping it. Keeping these
  // callbacks stable across a draw is what keeps the gesture handler itself stable.
  const faceoffRef = useRef(faceoff)
  faceoffRef.current = faceoff

  // Ready-check (game's first draw only — see FaceoffState's doc comment): any touch/key on a
  // player's own side counts, no need to hit a specific circle — there's nothing to aim at yet,
  // the countdown itself hasn't started. Idempotent/stage-guarded by the reducer itself.
  const stableFaceoffReady = useCallback(
    (player: Player) => {
      if (!faceoffRef.current || faceoffRef.current.stage !== 'ready') return
      faceoffReady(player)
      vibrationRef.current.short()
      soundRef.current.playSelect()
    },
    [faceoffReady]
  )

  // The actual dispatch: both of a player's two zones are watchable and pressable (see Board.tsx
  // — both pulse, only one flashes color), so this takes a zoneIndex directly rather than
  // resolving one from a touch position itself (see stableFaceoffTouch below for the touch path,
  // and the keyboard effect further down for the other). Deliberately dispatches even a WRONG
  // zone rather than swallowing it client-side — useGameState's FACEOFF_TAP treats pressing the
  // one that never colored as an instant disqualification (though not an instant *resolution* —
  // the draw still waits on the other player's own real press), specifically so pressing (or
  // tapping) both zones "to be safe" is a real gamble rather than a free guaranteed win. Letting
  // the reducer, not this callback, decide right-vs-wrong is what makes that enforceable.
  const stableFaceoffZoneTap = useCallback(
    (player: Player, zoneIndex: 0 | 1) => {
      const fo = faceoffRef.current
      if (!fo || fo.stage === 'resolved' || fo.stage === 'ready') return
      faceoffTap(player, Date.now(), zoneIndex)
      vibrationRef.current.short()
      soundRef.current.playSelect()
    },
    [faceoffTap]
  )

  // Touch path: during the ready-check, any touch on the player's own side signals ready (see
  // stableFaceoffReady above) — otherwise resolve which of the player's two zones (if either) a
  // raw (x, y) actually landed in, hit-tested against the exact same geometry Board.tsx draws
  // them at (see faceoffZoneCenters/faceoffZoneRadius in utils/board.ts), then defer to the
  // dispatcher above. A tap outside BOTH circles is a true no-op (nothing to attribute it to) —
  // that's the only case that stays silent; landing in either circle now always reaches the
  // reducer.
  const stableFaceoffTouch = useCallback(
    (player: Player, x: number, y: number) => {
      const fo = faceoffRef.current
      if (!fo) return
      if (fo.stage === 'ready') {
        stableFaceoffReady(player)
        return
      }
      const r = faceoffZoneRadius(board)
      const zoneIndex = faceoffZoneCenters(board, player).findIndex((c) => Math.hypot(x - c.x, y - c.y) <= r)
      if (zoneIndex === -1) return
      stableFaceoffZoneTap(player, zoneIndex as 0 | 1)
    },
    [board, stableFaceoffZoneTap, stableFaceoffReady]
  )

  // Keyboard path (web only) — a shared touchscreen lets two people press two different spots at
  // once; a shared mouse can't. A/D drive P1's left/right zone, ←/→ drive P2's (see
  // FACEOFF_KEY_HINTS above, which labels these on screen — shown throughout 'faceoff', ready
  // check included). e.repeat guards against a held key auto-firing. During the ready-check
  // either of a player's own two keys signals ready; afterward every keypress reaches the reducer
  // (no "off target" case for a key the way there is for a touch), so pressing the wrong key
  // forfeits exactly like tapping the wrong circle.
  useEffect(() => {
    if (Platform.OS !== 'web' || phase !== 'faceoff') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const ready = faceoff?.stage === 'ready'
      if (e.key === 'a' || e.key === 'A') ready ? stableFaceoffReady(1) : stableFaceoffZoneTap(1, 0)
      else if (e.key === 'd' || e.key === 'D') ready ? stableFaceoffReady(1) : stableFaceoffZoneTap(1, 1)
      else if (e.key === 'ArrowLeft') ready ? stableFaceoffReady(2) : stableFaceoffZoneTap(2, 0)
      else if (e.key === 'ArrowRight') ready ? stableFaceoffReady(2) : stableFaceoffZoneTap(2, 1)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [stableFaceoffZoneTap, stableFaceoffReady, faceoff?.stage, phase])

  // Restricted to a single pointer so that a second finger touching down mid-drag makes this
  // gesture fail (RNGH's maxPointers behavior) rather than register as a second, conflicting
  // drag. Touches arrive in the board's own untransformed container, whose coordinate space
  // already matches board space 1:1 (no camera transform sits between them), so e.x/e.y and
  // e.translationX/Y are used directly — can start anywhere on the board, not just on the puck
  // (see useGameState's tryAimStart).
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onStart((e) => {
          runOnJS(stableAimStart)(e.x, e.y)
        })
        .onChange((e) => {
          runOnJS(stableAimUpdate)(e.x, e.y)
        })
        .onEnd((e) => {
          runOnJS(stableShoot)(e.translationX, e.translationY)
        })
        .onFinalize(() => {
          runOnJS(stableAimCancel)()
        })
        .minDistance(0),
    [stableAimStart, stableAimUpdate, stableShoot, stableAimCancel]
  )

  // ─── Tip-off tap zones ─────────────────────────────────────────────────────
  // Two independently-bounded single-pointer recognizers, one per half of the screen — P1 =
  // bottom, P2 = top, matching where their circles actually render (faceoffZoneCenters puts
  // player 1's pair near board.y + board.height, the same "P1's half" convention the goal crease/
  // score pips/zone lines already use throughout Board.tsx). Getting this backwards would put a
  // player's own gesture zone and their actual on-screen circles in different halves entirely, so
  // a tap could never land close enough to register — worth stating explicitly since it's not
  // necessarily the seating order /loadout uses for its panels, which is a display-only layout
  // choice, not a gameplay contract (though as of the P1-always-bottom change, both now agree:
  // /loadout already treats P1 as the device owner in the near/bottom zone).
  // Split into two recognizers (rather than one spanning the whole screen with the player inferred
  // from touch position) because a tap recognizer is built around tracking a single pointer's
  // lifecycle, and two near-simultaneous touches in different regions isn't a reliably-specified
  // multitouch race for one recognizer to arbitrate. .onBegin fires on initial contact, before
  // RNGH's own tap-recognition (duration/distance) resolves — the correct low-latency instant to
  // timestamp a reaction, rather than waiting for .onEnd. Only enabled during 'faceoff' —
  // pointerEvents is toggled the same way below so these transparent zones don't intercept the
  // normal puck-drag gesture underneath them the rest of the time, even though they're mounted as
  // later (and so visually topmost) siblings of the board.
  const p1TapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin((e) => runOnJS(stableFaceoffTouch)(1, e.x, e.y))
        .enabled(phase === 'faceoff'),
    [stableFaceoffTouch, phase]
  )
  const p2TapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin((e) => runOnJS(stableFaceoffTouch)(2, e.x, e.y))
        .enabled(phase === 'faceoff'),
    [stableFaceoffTouch, phase]
  )

  // ─── Derived display values ───────────────────────────────────────────────
  // Also gated on it not being the CPU's turn, so a stray touch during single-player can't hijack
  // its shot — pass-and-play (aiPlayer === null) keeps its original "whoever touches goes" rule.
  const gestureEnabled = (phase === 'idle' || phase === 'aiming') && currentPlayer !== aiPlayer

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Board + gesture layer, starting right at the safe area (marginTop: insets.top) — no
          score bar or turn indicator above it: the puck's own color already says whose turn it
          is, and the score lives on the board itself as pips at each goal (see Board.tsx). The
          one-finger aim gesture only runs during idle/aiming (see gestureEnabled below). */}
      <View style={[styles.boardArea, { marginTop: insets.top }]}>
        <GestureDetector gesture={panGesture.enabled(gestureEnabled)}>
          <View style={styles.boardAreaTouchable}>
            <Board board={board} puck={puck} aim={aim} phase={phase} currentPlayer={currentPlayer} lastScoredGoal={lastScoredGoal} scores={scores} scoreToWin={scoreToWin} faceoff={faceoff} showWalls={isDesktopWeb} previewLengthPx={shotPreviewLengthPx} />
          </View>
        </GestureDetector>

        {/* Tip-off tap zones — later siblings of the board's own gesture layer so they sit on top
            in z-order, but transparent and pointerEvents='none' outside 'faceoff' so they never
            intercept the normal puck-drag gesture underneath. P1 = bottom half, P2 = top half —
            see the p1TapGesture/p2TapGesture comment above for why this specific pairing (matching
            where their circles render, per board.ts's faceoffZoneCenters — P1 always bottom) is
            load-bearing, not arbitrary. Nested INSIDE boardArea (not siblings of it at the screen
            root) specifically so their own e.x/e.y share boardArea's local origin — the same
            origin board.x/board.y and faceoffZoneCenter() already assume (see utils/board.ts's
            comment on why board.y is *not* offset by insets.top itself: this marginTop already
            accounts for it once). A sibling-of-root placement would double an inset.top>0 into
            every tap's y before stableFaceoffTouch's circular hit-test compares it against
            faceoffZoneCenters' board-local coordinates, silently mis-hitting on any device with a
            notch/status bar. */}
        <GestureDetector gesture={p1TapGesture}>
          <View style={styles.faceoffZoneBottom} pointerEvents={phase === 'faceoff' ? 'auto' : 'none'} />
        </GestureDetector>
        <GestureDetector gesture={p2TapGesture}>
          <View style={styles.faceoffZoneTop} pointerEvents={phase === 'faceoff' ? 'auto' : 'none'} />
        </GestureDetector>

        {/* Key hints (desktop web only) — see FACEOFF_KEY_HINTS above for why desktop needs a
            keyboard path at all: a shared mouse can't do a two-person tap race. Gated on
            isDesktopWeb, not bare `Platform.OS === 'web'` — mobile web is still `Platform.OS ===
            'web'` but has touch, not a keyboard, so showing key labels there is just wrong/
            confusing chrome over what's actually a tap input (the p1TapGesture/p2TapGesture zones
            above already work there identically to native). Positioned at the same board-local
            coordinates as the circles themselves (faceoffZoneCenter), inside boardArea for the
            same coordinate-origin reason as the tap zones above. pointerEvents='none' so the
            label never steals the tap/click underneath. Text color is that player's own
            onPrimary/onSecondary — auto-paper's MD3 theme already defines these as the
            intentional contrast pair for primary/secondary (see AutoPaperTheme's colors type),
            tailored to whatever color the player actually picked in loadout, rather than reaching
            for a generic contrast-computation helper — a fixed white label would wash out against
            a light player color like yellow. */}
        {isDesktopWeb &&
          phase === 'faceoff' &&
          FACEOFF_KEY_HINTS.map((h) => {
            const c = faceoffZoneCenter(board, h.player, h.zoneIndex)
            return (
              <Text key={`${h.player}-${h.zoneIndex}`} pointerEvents='none' style={[styles.keyHint, { left: c.x - 12, top: c.y - 12, color: h.player === 1 ? themeColors.onPrimary : themeColors.onSecondary, fontFamily: MONO_FONT }]}>
                {h.label}
              </Text>
            )
          })}
      </View>

      {/* Game Over overlay — identifies the winner by their own puck color (see Board.tsx's
          p1Color/p2Color) rather than a "P1"/"P2"/"CPU" label, so it reads the same regardless of
          game mode. Icon stacked above the title (not an inline row) and both actions contained,
          colored by loser/winner — same shell and button treatment as the quit confirmation below
          and as LightCycles' own round-over dialog, rather than a one-off layout of its own. */}
      {phase === 'gameOver' && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Icon source='trophy' size={64} color={playerColor[winner]} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: playerColor[winner], fontFamily: MONO_FONT }]}>
              Wins!
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { fontFamily: MONO_FONT }]}>
              <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
              <Text style={{ color: fgMuted }}> – </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            <Button mode='contained' onPress={() => resetGame(board)} style={styles.overlayButton} buttonColor={playerColor[loser]} textColor={playerOnColor[loser]}>
              Play Again
            </Button>
            <Button mode='contained' onPress={() => router.back()} style={styles.overlayButton} buttonColor={playerColor[winner]} textColor={playerOnColor[winner]}>
              Loadout
            </Button>
          </View>
        </View>
      )}

      {/* Quit confirmation — same overlay/card shell as the Game Over dialog above and as
          LightCycles' own quit-confirmation: icon stacked above the title, the score spelled out
          in each player's own color so it's clear who has what, and two contained buttons — Cancel
          in primary (the "keep playing" default) and Quit in secondary, the same pairing
          LightCycles uses, not tied to who's ahead since there's no winner mid-game. */}
      {confirmBackVisible && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Icon source='alert-circle-outline' size={64} color={themeColors.secondary} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: themeColors.secondary, fontFamily: MONO_FONT }]}>
              Quit Match?
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { fontFamily: MONO_FONT }]}>
              <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
              <Text style={{ color: fgMuted }}> – </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            <Button mode='contained' onPress={() => setConfirmBackVisible(false)} style={styles.overlayButton} buttonColor={themeColors.primary} textColor={themeColors.onPrimary}>
              Cancel
            </Button>
            <Button mode='contained' onPress={safeBack} style={styles.overlayButton} buttonColor={themeColors.secondary} textColor={themeColors.onSecondary}>
              Quit
            </Button>
          </View>
        </View>
      )}

      {/* Back + settings — plain IconButton (bare icon, no filled background), matching
          index.tsx/loadout.tsx exactly rather than the filled-chip FAB this used previously. Both
          fade out together during an active drag (cornerButtonsStyle above) instead of just
          disappearing; pointerEvents follows the same condition so a faded-out button can't still
          be tapped underneath the puck gesture layer. */}
      <Animated.View pointerEvents={phase !== 'aiming' ? 'auto' : 'none'} style={[styles.backButton, { top: 8 + insets.top, left: 8 + insets.left }, cornerButtonsStyle]}>
        <IconButton icon='arrow-left' iconColor={fg} size={24} onPress={onBackPress} />
      </Animated.View>

      {/* Settings — same top corner slot as every other screen's cog (index.tsx, loadout.tsx). */}
      <Animated.View pointerEvents={phase !== 'aiming' ? 'auto' : 'none'} style={[styles.settingsButton, { top: 8 + insets.top, right: 8 + insets.right }, cornerButtonsStyle]}>
        <IconButton icon='cog' iconColor={fg} size={24} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />
      </Animated.View>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  backButton: { position: 'absolute' },
  boardArea: { flex: 1 },
  boardAreaTouchable: { flex: 1 },
  faceoffZoneBottom: { bottom: 0, height: '50%', left: 0, position: 'absolute', right: 0 },
  faceoffZoneTop: { height: '50%', left: 0, position: 'absolute', right: 0, top: 0 },
  // lineHeight matching height is what actually centers the glyph vertically — RN Text doesn't
  // auto-center a single line within a taller box on its own, textAlign only handles horizontal.
  keyHint: { fontSize: 15, fontWeight: 'bold', height: 24, lineHeight: 24, position: 'absolute', textAlign: 'center', width: 24 },
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
  root: { flex: 1 },
  settingsButton: { position: 'absolute' }
})
