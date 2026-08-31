import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { getFixedZoneRotation, useAccelerometerOrientation } from '@tastic/split-screen'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Icon, Text } from 'react-native-paper'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Board from '@/components/BoardHost'
import { SettingsDialog } from '@/components/SettingsDialog'
import { COIN_FLIP_TOTAL_MS, DESKTOP_WEB_MIN_WIDTH, FRICTION_LEVELS, INTERCEPT_SPEED_THRESHOLDS, MIN_SHOOT_DRAG, SHOT_PREVIEW_LENGTH_RATIOS, STRIKE_DURATION_MS } from '@/constants/game'
import { useAIOpponent } from '@/hooks/useAIOpponent'
import { useFaceoff } from '@/hooks/useFaceoff'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useGameSound } from '@/hooks/useGameSound'
import { useGameState } from '@/hooks/useGameState'
import { GamePhase, Player } from '@/types'
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

function otherPlayer(p: Player): Player {
  return p === 1 ? 2 : 1
}

export default function GameScreen() {
  // The board itself always stays visually fixed 'faceToFace' — never wrapped in
  // @tastic/split-screen's FakeLandscapeView the way /index and /loadout are, regardless of the
  // Lock Orientation setting or how the phone is actually held. Its fixed top/bottom goal geometry
  // (see Board.tsx/computeBoardLayout) assumes a tall aspect ratio, and reflowing it would also
  // rotate TouchInputLayer's own hit-zones out from under the swipe-to-turn gesture. Live physical
  // tilt is still tracked (see MatchOverlays below), just isolated to a sibling of the board/gesture
  // tree so a live accelerometer reading never cascades a re-render into it — that rotation only
  // ever reaches the dialogs floating on top, so they stay legible however the phone is held.
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
  const interceptThreshold = INTERCEPT_SPEED_THRESHOLDS[roundSettings.interceptSpeed]
  const puckSize = roundSettings.puckSize
  const controlScheme = roundSettings.controlScheme
  // Only P2 can be CPU-controlled for now — pass-and-play stays the default, single-player just
  // swaps who takes P2's turns (see useAIOpponent, which plays the exact same gesture contract).
  const aiPlayer: Player | null = roundSettings.gameMode === 'vsCpu' ? 2 : null
  const aiDifficulty = roundSettings.aiDifficulty

  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const rink = roundSettings.rink
  const board = useMemo(() => computeBoardLayout(width, height, insets, layout, puckSize, rink), [width, height, insets, layout, puckSize, rink])
  // Resolved to pixels here (not inside Board.tsx) for the same reason `friction` is resolved
  // above — the enum→number mapping is a settings concern, board.width isn't known until here.
  const shotPreviewLengthPx = board.width * SHOT_PREVIEW_LENGTH_RATIOS[roundSettings.shotPreviewLength]

  // Settings/quit-confirm dialogs pause gameplay while open — declared up here, ahead of
  // useGameState/useAIOpponent/useFaceoff below, so `paused` exists in time to thread into all
  // three (each halts its own timers/RAF loop while true — see their own comments).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Only asked once there's a real score to lose — 0-0 exits immediately, since there's nothing
  // yet for a confirmation to protect (mirrors LightCycles' identical quit-confirmation gate).
  const [confirmBackVisible, setConfirmBackVisible] = useState(false)
  const paused = settingsOpen || confirmBackVisible

  const { state, tryAimStart, aimUpdate, aimCancel, shoot, applyStrike, nextRound, resetGame, coinFlipDone, faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart, setInterceptTouch } = useGameState(board, scoreToWin, tipoffMode, friction, controlScheme, paused, interceptThreshold)
  const { phase, puck, aim, interceptAim, currentPlayer, scores, bounceCount, lastScoredGoal, wellEnterCount, lastWellPolarity, goalDoorHitCount, lastGoalDoorSide, faceoff } = state

  useAIOpponent(state, board, aiPlayer, aiDifficulty, friction, controlScheme, paused, interceptThreshold, { tryAimStart, aimUpdate, shoot })
  useFaceoff(state, board, aiPlayer, aiDifficulty, paused, { faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart })

  // Mid-slide intercept derived values — computed early since several things below (the cancel-
  // zone haptic, gestureEnabled, Board's own props) all need them. `interceptAim` is only ever
  // non-null while phase==='simulating' (see its own doc comment in types/index.ts), so
  // aimingPlayer/displayAim/puckInterceptable all key off that rather than `phase` directly.
  // aimingPlayer: whichever player's paddle/chevrons/ControlScheme should currently apply —
  // normally state.currentPlayer, but during an in-progress intercept it's the RECEIVER
  // (otherPlayer(currentPlayer)), since currentPlayer itself doesn't flip to them until STRIKE
  // actually lands (see useGameState.ts's STRIKE case for why that flip is deferred that far).
  const puckSpeed = Math.hypot(puck.vx, puck.vy)
  const isIntercepting = interceptAim !== null
  const puckInterceptable = phase === 'simulating' && puckSpeed < interceptThreshold
  // Previews the receiver's color for the WHOLE interceptable window, not just once a drag has
  // actually started — this is the discoverability cue (Board.tsx's ring/glow) that tells a human
  // "you can grab this" before they've touched anything, not only mid-drag.
  const aimingPlayer: Player = phase === 'simulating' && (isIntercepting || puckInterceptable) ? otherPlayer(currentPlayer) : currentPlayer
  const displayAim = aim ?? interceptAim

  // 'coinFlip' mode's ceremony (Board.tsx) doesn't play on its own — it waits on this, which only a
  // tap (see stableCoinFlipTap below) ever flips true. Reset back to false the instant a fresh
  // draw begins (see the prevPhaseRef effect further down), so "Play Again" gets its own tap too,
  // not a free ride on the previous game's.
  const [coinFlipStarted, setCoinFlipStarted] = useState(false)

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
  // Back/settings chip background — semi-opaque bg (not solid, and not fg-inverted like the rest
  // of this screen's chips) now that the walls/goal line they used to sit on read much thinner
  // (see WALL_THICKNESS/GOAL_LINE_STROKE_WIDTH in constants/game.ts): a solid opaque fg chip stood
  // out fine against the old thick wall right at the board edge, but against the thin line it now
  // reads as a heavier, disconnected UI slab. Semi-opaque bg lets the board show through at the
  // edges so the chip melds with the board instead of sitting on top of it.
  const cornerButtonBg = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)'

  // Per-player color pair, shared by the Game Over and quit-confirmation overlays below so a
  // given player's number/name reads in their own color everywhere on this screen, not just on
  // the board itself.
  const playerColor: Record<Player, string> = { 1: themeColors.primary, 2: themeColors.secondary }
  const playerOnColor: Record<Player, string> = { 1: themeColors.onPrimary, 2: themeColors.onSecondary }
  const winner: Player = scores[0] >= scoreToWin ? 1 : 2
  const loser: Player = winner === 1 ? 2 : 1

  // Corner buttons (back/settings) fade out during an active drag or swing rather than just
  // disappearing — FAB's own `visible` prop used to provide this for free, but the plain
  // IconButton used here now (matching index.tsx/loadout.tsx's bare-icon style) has no
  // equivalent, so it's rebuilt directly. Covers 'striking' and 'simulating' as well as 'aiming':
  // not just gameplay polish — it closes the window where a CPU turn's own windup/shoot/settle
  // timer chain (see useAIOpponent.ts) could otherwise get interrupted mid-flight by a
  // just-opened dialog. With all three phases covered, `paused` can only ever turn true while
  // nothing in that chain is pending. 'simulating' is also just the puck actually moving — per
  // explicit feedback, the chips should stay out of the way for that whole stretch, not reappear
  // the instant a shot is struck while the puck is still in motion.
  const cornerButtonsVisible = phase !== 'aiming' && phase !== 'striking' && phase !== 'simulating'
  const cornerButtonsOpacity = useSharedValue(1)
  useEffect(() => {
    cornerButtonsOpacity.value = withTiming(cornerButtonsVisible ? 1 : 0, { duration: 150 })
  }, [cornerButtonsVisible]) // eslint-disable-line react-hooks/exhaustive-deps
  const cornerButtonsStyle = useAnimatedStyle(() => ({ opacity: cornerButtonsOpacity.value }))

  // Coin flip's tap-target is live until this flips false — the invite itself (a plain pulsing
  // ring at board center) is Board.tsx's job, same visual language as 'faceoff' mode's own
  // ready-check pulse, no separate prompt chrome needed here.
  const coinFlipAwaitingTap = phase === 'coinFlip' && !coinFlipStarted

  // On a phone (native or mobile web), the device's own physical edges already read as "the
  // wall" — no drawn perimeter needed. Desktop web has no such edge (the board just floats in an
  // arbitrarily-sized browser window), so it's the one place Board.tsx still draws the perimeter
  // walls (see showWalls below).
  const isDesktopWeb = Platform.OS === 'web' && width >= DESKTOP_WEB_MIN_WIDTH

  // ─── Auto-advance from 'scored' ───────────────────────────────────────────
  // Also held while paused (settings or quit-confirm dialog up) — otherwise this timer keeps
  // running underneath the dialog and silently advances the very score the player is deciding
  // whether to walk away from, or opened settings during. Cancelling restarts the full 1200ms
  // wait rather than resuming mid-count, same tradeoff LightCycles' onboarding countdown makes for
  // its own settings/quit dialogs.
  useEffect(() => {
    if (phase !== 'scored' || paused) return
    const t = setTimeout(() => nextRound(board), 1200)
    return () => clearTimeout(t)
  }, [phase, board, nextRound, paused])

  // ─── Auto-advance from 'coinFlip' ──────────────────────────────────────────
  // Gated on coinFlipStarted (the tap that kicks off Board.tsx's ceremony — see stableCoinFlipTap
  // below) in addition to phase/paused: the winner/puck placement are already decided
  // (useGameState.ts's makeInitialState), but nothing should count down toward handing over
  // control until a player has actually tapped to flip. Otherwise mirrors the 'scored' auto-advance
  // above one-for-one, including the `paused` gate (restarting the full wait rather than resuming
  // mid-ceremony if a dialog opens mid-flip).
  useEffect(() => {
    if (phase !== 'coinFlip' || !coinFlipStarted || paused) return
    const t = setTimeout(() => coinFlipDone(), COIN_FLIP_TOTAL_MS)
    return () => clearTimeout(t)
  }, [phase, coinFlipStarted, coinFlipDone, paused])

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

  // Ticks once whenever a live drag crosses the MIN_SHOOT_DRAG cancel-zone boundary in either
  // direction (back inside it, or out past it) — the phantom-puck circle (Board.tsx) is the only
  // visual cue for that boundary today, so this gives it a tactile confirmation too. Deliberately
  // does NOT fire for the trivial "just touched down at distance 0" state (aimActive flips
  // false→true) or the drag ending (aimActive flips true→false) — both `wasAimActive` and
  // `aimActive` have to be true for a crossing to count, so only a real mid-drag boundary cross
  // qualifies; the touch-down moment already gets its own haptic via stableAimStart.
  // displayAim (computed above) merges in an in-progress mid-slide intercept (see interceptAim in
  // types/index.ts) — phase stays 'simulating' for the whole intercept drag, so checking
  // phase==='aiming' alone would miss that case entirely and this haptic would simply never fire
  // during an intercept.
  const aimActive = !!displayAim
  const aimDragDist = displayAim ? Math.hypot(displayAim.currentX - displayAim.startX, displayAim.currentY - displayAim.startY) : 0
  const inCancelZone = aimActive && aimDragDist < MIN_SHOOT_DRAG
  const prevAimActiveRef = useRef(aimActive)
  const prevInCancelZoneRef = useRef(inCancelZone)
  useEffect(() => {
    const wasAimActive = prevAimActiveRef.current
    const wasInCancelZone = prevInCancelZoneRef.current
    prevAimActiveRef.current = aimActive
    prevInCancelZoneRef.current = inCancelZone
    if (!wasAimActive || !aimActive) return
    if (wasInCancelZone !== inCancelZone) {
      vibrationRef.current.short()
    }
  }, [aimActive, inCancelZone])

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
    // Reset the tap-to-flip gate the instant a fresh coin-flip draw begins (game start, or a new
    // game via Game Over's "Play Again") — see coinFlipStarted/stableCoinFlipTap below. This is the
    // only thing that ever flips it back to false; stableCoinFlipTap is the only thing that ever
    // flips it back to true.
    if (prevPhaseRef.current !== 'coinFlip' && phase === 'coinFlip') {
      setCoinFlipStarted(false)
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

  // While intercepting (phase === 'simulating'), skip the AIM_UPDATE dispatch path entirely and
  // just write the latest finger position into useGameState's own ref instead (see
  // setInterceptTouch's doc comment in useGameState.ts) — that ref gets folded into the SAME
  // dispatch the physics rAF loop already fires every frame, rather than firing a second,
  // independent dispatch (and re-render) at the gesture's own uncorrelated rate. An earlier fix
  // just throttled the direct dispatch instead, which only traded one artifact for another: two
  // still-independent update streams at two different frequencies beat against each other,
  // producing the reported jitter rather than a clean stall. A normal aim (phase === 'aiming')
  // keeps dispatching AIM_UPDATE directly as before — the puck is stationary and the physics loop
  // is off then, so there's nothing for it to compete with.
  const stableAimUpdate = useCallback(
    (x: number, y: number) => {
      if (phase === 'simulating') {
        setInterceptTouch(x, y)
        return
      }
      aimUpdate(x, y)
    },
    [aimUpdate, setInterceptTouch, phase]
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

  // The coin-flip ceremony's own "go" tap (see Board.tsx and coinFlipStarted above) — anyone's tap
  // anywhere on the board counts, same "no specific target" spirit as stableFaceoffReady below,
  // just for a ceremony with only one beat instead of two players' worth. Idempotent via the
  // `coinFlipStarted` check itself (the tap gesture below is also disabled the instant it flips
  // true, but a second stray delivery landing before that teardown finishes shouldn't double-fire
  // the haptic/sound either).
  const stableCoinFlipTap = useCallback(() => {
    if (coinFlipStarted) return
    setCoinFlipStarted(true)
    vibrationRef.current.short()
    soundRef.current.playSelect()
  }, [coinFlipStarted])

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
      if (e.key === 'a' || e.key === 'A') {
        if (ready) stableFaceoffReady(1)
        else stableFaceoffZoneTap(1, 0)
      } else if (e.key === 'd' || e.key === 'D') {
        if (ready) stableFaceoffReady(1)
        else stableFaceoffZoneTap(1, 1)
      } else if (e.key === 'ArrowLeft') {
        if (ready) stableFaceoffReady(2)
        else stableFaceoffZoneTap(2, 0)
      } else if (e.key === 'ArrowRight') {
        if (ready) stableFaceoffReady(2)
        else stableFaceoffZoneTap(2, 1)
      }
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
  //
  // MUST use e.absoluteX/e.absoluteY here, never the plain e.x/e.y — RNGH reports x/y relative to
  // whichever view the gesture is physically attached to, not to boardArea. p2TapGesture's own
  // view (faceoffZoneTop) happens to start at the same origin as boardArea (top: 0), so its e.y
  // was accidentally already boardArea-relative — but p1TapGesture's view (faceoffZoneBottom) is
  // offset halfway down boardArea, so its e.y was relative to THAT view's own top edge, off by
  // roughly half the screen height from what stableFaceoffTouch's hit-test (faceoffZoneCenters,
  // in board/boardArea-local coordinates) expects. That mismatch made every P1 live-window tap
  // silently miss the hit-test (zoneIndex resolves to -1, no dispatch at all — not even a
  // wrong-zone forfeit), while the 'ready' stage stayed unaffected since it skips the hit-test
  // entirely (see stableFaceoffTouch). absoluteX/Y are screen-relative regardless of which nested
  // view the gesture sits on, and boardArea itself starts at screen (0, board.boardMarginTop) — no
  // left margin, and marginTop: board.boardMarginTop is boardArea's only offset from the screen
  // origin — so subtracting board.boardMarginTop from absoluteY (and using absoluteX as-is)
  // converts back to exactly the same board-local space board.x/board.y and faceoffZoneCenters
  // already assume, for BOTH zones uniformly, rather than relying on one of them coincidentally
  // matching by construction. board.boardMarginTop, NOT the raw insets.top — the rink pocket
  // setting moves boardArea's actual origin up into the safe-area inset (see boardMarginTop's own doc comment on
  // BoardLayout), and this conversion has to track wherever the container's real origin is, same
  // as it already had to for the two zones' differing view origins.
  const p1TapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin((e) => runOnJS(stableFaceoffTouch)(1, e.absoluteX, e.absoluteY - board.boardMarginTop))
        .enabled(phase === 'faceoff'),
    [stableFaceoffTouch, phase, board.boardMarginTop]
  )
  const p2TapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin((e) => runOnJS(stableFaceoffTouch)(2, e.absoluteX, e.absoluteY - board.boardMarginTop))
        .enabled(phase === 'faceoff'),
    [stableFaceoffTouch, phase, board.boardMarginTop]
  )

  // Coin flip's own "go" tap — spans the whole board (no zones, no player-attribution, unlike the
  // faceoff pair above), and disables itself the instant it's used so this same tap can't
  // re-trigger anything later in the round.
  const coinFlipTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => runOnJS(stableCoinFlipTap)())
        .enabled(phase === 'coinFlip' && !coinFlipStarted),
    [stableCoinFlipTap, phase, coinFlipStarted]
  )

  // ─── Derived display values ───────────────────────────────────────────────
  // Also gated on it not being the CPU's turn, so a stray touch during single-player can't hijack
  // its shot — pass-and-play (aiPlayer === null) keeps its original "whoever touches goes" rule.
  // canIntercept covers BOTH "puck just became slow enough to grab" (interceptAim still null) and
  // "already mid-drag" (interceptAim set) — the OR is required so the gesture doesn't get disabled
  // out from under an in-progress drag if, say, a gravity well transiently pushes the puck's speed
  // back above interceptThreshold before release.
  const canIntercept = phase === 'simulating' && otherPlayer(currentPlayer) !== aiPlayer && (interceptAim !== null || puckInterceptable)
  const gestureEnabled = ((phase === 'idle' || phase === 'aiming') && currentPlayer !== aiPlayer) || canIntercept

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Hidden only here, not on /loadout or the home screen. Originally gated on the rink pocket
          setting alone (it borrows this real estate — see boardMarginTop's own doc comment), but
          the board's top/bottom edges sit flush against insets.top/insets.bottom either way (see
          board.y/board.y+height), so the OS status bar was always overlapping the first couple
          pixels of the goal line there — harmless while that line was thin and just decorative,
          but it started visibly eating into the rink-off wall line's own edge once that line
          needed to read as a solid boundary (see Board.tsx's goal-line color swap). Unconditional
          now. expo-router remounts this component fresh per screen, so leaving is enough to
          restore the bar elsewhere without an explicit cleanup call. */}
      <StatusBar hidden />
      {/* Board + gesture layer, starting right at the safe area unless the rink pocket setting is
          on (marginTop: board.boardMarginTop, which equals insets.top there — see its own doc
          comment on BoardLayout for why rink moves this up into the inset instead) — no score
          bar or turn indicator above it: the puck's own color already says whose turn it is, and
          the score lives on the board itself as pips at each goal (see Board.tsx). The one-finger
          aim gesture only runs during idle/aiming (see gestureEnabled below). */}
      <View style={[styles.boardArea, { marginTop: board.boardMarginTop }]}>
        <GestureDetector gesture={panGesture.enabled(gestureEnabled)}>
          <View style={styles.boardAreaTouchable}>
            <Board board={board} puck={puck} aim={displayAim} phase={phase} currentPlayer={currentPlayer} aimingPlayer={aimingPlayer} isIntercepting={isIntercepting} puckInterceptable={puckInterceptable} lastScoredGoal={lastScoredGoal} scores={scores} scoreToWin={scoreToWin} goalDoorHitCount={goalDoorHitCount} lastGoalDoorSide={lastGoalDoorSide} faceoff={faceoff} controlScheme={controlScheme[aimingPlayer]} coinFlipStarted={coinFlipStarted} showWalls={isDesktopWeb} previewLengthPx={shotPreviewLengthPx} shotPreviewLength={roundSettings.shotPreviewLength} friction={friction} />
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

        {/* Coin flip's "go" tap zone — the whole board, not split into halves like the faceoff
            pair above, since either player flipping it is the entire ceremony (see
            coinFlipTapGesture's own comment). The invite itself (a pulsing ring) is Board.tsx's
            own Skia canvas, not this zone — this is purely the hit target, transparent and
            pointerEvents='none' once coinFlipStarted flips true, same "don't intercept anything
            once its job is done" treatment as the faceoff zones. */}
        <GestureDetector gesture={coinFlipTapGesture}>
          <View style={StyleSheet.absoluteFill} pointerEvents={coinFlipAwaitingTap ? 'auto' : 'none'} />
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

      {/* Back + settings — vertically centered on the side edges at the dividing-wall centerline
          (board.boardMarginTop + board.centerY in root-relative coordinates), rather than the top
          corners used on every other screen. Unlike index.tsx/loadout.tsx, this screen is split
          face-to-face with P2's half rotated 180°, so a top corner sits inside P2's near zone; the
          wall centerline is the one strip of the board no puck can ever occupy, making it neutral
          ground for both players. Deliberately centered on the board's own field (top: board.y,
          height: board.height, both local to boardArea) rather than on root's full height the way
          the very first version of this did — boardMarginTop/insets.bottom aren't generally equal
          (see computeViewportSize/computeBoardLayout's own comments), so the screen's own vertical
          midpoint and the board's own vertical midpoint are two different points; centering on
          root would put these visibly off the wall on any device where those two insets differ.
          Same single-constraint top+height anchor faceoffZoneTop/Bottom below already use, for the
          same reason (see that comment) — mixing top+bottom here would still be exact today, but
          top+height is what stays exact if this view is ever nested somewhere its own height isn't
          implicitly root's. Filled circular chip (fg icon on a semi-opaque bg container — see
          cornerButtonBg's own comment) rather than a bare icon, so it reads as a fixture bolted to
          the wall instead of chrome floating over the ice; flush against the safe-area edge (no
          extra inset padding, default IconButton margin zeroed) to sit as close to the true screen
          edge as the notch/home-indicator allows. Both fade out together during an active drag,
          swing, or simulating shot (cornerButtonsStyle above); pointerEvents follows the same
          condition so a faded-out button can't still be tapped underneath the puck gesture layer. */}
      <Animated.View pointerEvents={cornerButtonsVisible ? 'auto' : 'none'} style={[styles.backButton, { top: board.boardMarginTop + board.y, height: board.height, left: insets.left }, cornerButtonsStyle]}>
        <IconButton icon='arrow-left' iconColor={fg} containerColor={cornerButtonBg} style={styles.chipButton} size={24} onPress={onBackPress} />
      </Animated.View>

      {/* Settings — mirrored on the opposite side edge, same centerline and chip treatment as the back button. */}
      <Animated.View pointerEvents={cornerButtonsVisible ? 'auto' : 'none'} style={[styles.settingsButton, { top: board.boardMarginTop + board.y, height: board.height, right: insets.right }, cornerButtonsStyle]}>
        <IconButton icon='cog' iconColor={fg} containerColor={cornerButtonBg} style={styles.chipButton} size={24} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />
      </Animated.View>

      <MatchOverlays phase={phase} scores={scores} winner={winner} loser={loser} playerColor={playerColor} playerOnColor={playerOnColor} cardBg={cardBg} cardBorder={cardBorder} fgMuted={fgMuted} secondaryColor={themeColors.secondary} onSecondaryColor={themeColors.onSecondary} primaryColor={themeColors.primary} onPrimaryColor={themeColors.onPrimary} onResetGame={() => resetGame(board)} confirmBackVisible={confirmBackVisible} onQuitCancel={() => setConfirmBackVisible(false)} settingsOpen={settingsOpen} onSettingsDismiss={() => setSettingsOpen(false)} />
    </View>
  )
}

interface MatchOverlaysProps {
  phase: GamePhase
  scores: [number, number]
  winner: Player
  loser: Player
  playerColor: Record<Player, string>
  playerOnColor: Record<Player, string>
  cardBg: string
  cardBorder: string
  fgMuted: string
  secondaryColor: string
  onSecondaryColor: string
  primaryColor: string
  onPrimaryColor: string
  onResetGame: () => void
  confirmBackVisible: boolean
  onQuitCancel: () => void
  settingsOpen: boolean
  onSettingsDismiss: () => void
}

// Kept as its own sibling of the board/gesture tree above, specifically so this live tilt
// subscription's re-renders never cascade into it — mirrors LightCycles' identically-shaped
// MatchOverlays. The board itself is permanently 'faceToFace' (see GameScreen's own comment above)
// and never rotates, but the dialogs this renders float on top of it and should still read
// right-side-up however the phone is actually being held, so they rotate their own card content in
// place via `rotation` rather than reflowing layout (unlike /index and /loadout's FakeLandscapeView)
// — the fixed zones have to keep the exact shape TouchInputLayer's unrotated hit-zones already use.
function MatchOverlays({ phase, scores, winner, loser, playerColor, playerOnColor, cardBg, cardBorder, fgMuted, secondaryColor, onSecondaryColor, primaryColor, onPrimaryColor, onResetGame, confirmBackVisible, onQuitCancel, settingsOpen, onSettingsDismiss }: MatchOverlaysProps) {
  const liveOrientation = useAccelerometerOrientation()
  const rotation = getFixedZoneRotation(liveOrientation.orientationMode, liveOrientation.p1OnRight, liveOrientation.upsideDown)
  const cardRotationStyle = rotation % 360 !== 0 && { transform: [{ rotate: `${rotation}deg` }] }

  return (
    <>
      {/* Game Over overlay — identifies the winner by their own puck color (see Board.tsx's
          p1Color/p2Color) rather than a "P1"/"P2"/"CPU" label, so it reads the same regardless of
          game mode. Icon stacked above the title (not an inline row) and both actions contained,
          colored by loser/winner — same shell and button treatment as the quit confirmation below
          and as LightCycles' own round-over dialog, rather than a one-off layout of its own. */}
      {phase === 'gameOver' && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardRotationStyle]}>
            <Icon source='trophy' size={64} color={playerColor[winner]} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: playerColor[winner], fontFamily: MONO_FONT }]}>
              Wins!
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { fontFamily: MONO_FONT }]}>
              <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
              <Text style={{ color: fgMuted }}> – </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            <Button mode='contained' onPress={onResetGame} style={styles.overlayButton} buttonColor={playerColor[loser]} textColor={playerOnColor[loser]}>
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
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardRotationStyle]}>
            <Icon source='alert-circle-outline' size={64} color={secondaryColor} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: secondaryColor, fontFamily: MONO_FONT }]}>
              Quit Match?
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { fontFamily: MONO_FONT }]}>
              <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
              <Text style={{ color: fgMuted }}> – </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            <Button mode='contained' onPress={onQuitCancel} style={styles.overlayButton} buttonColor={primaryColor} textColor={onPrimaryColor}>
              Cancel
            </Button>
            <Button mode='contained' onPress={safeBack} style={styles.overlayButton} buttonColor={secondaryColor} textColor={onSecondaryColor}>
              Quit
            </Button>
          </View>
        </View>
      )}

      <SettingsDialog visible={settingsOpen} onDismiss={onSettingsDismiss} rotation={rotation} />
    </>
  )
}

const styles = StyleSheet.create({
  // top/height come from the JSX (board.y/board.height, not a fixed value here) — see the render
  // comment above for why this has to be the board's own field span, not root's full height.
  backButton: { justifyContent: 'center', position: 'absolute' },
  boardArea: { flex: 1 },
  boardAreaTouchable: { flex: 1 },
  // Cancels IconButton's own built-in 6px margin (react-native-paper's default Surface spacing)
  // so nothing but the safe-area inset stands between the chip and the true screen edge.
  chipButton: { margin: 0 },
  // Both anchored from `top` (not `bottom`+height for the lower one) so they resolve through the
  // exact same single-constraint layout path — mixing `bottom: 0` with a percentage `height` on an
  // absolutely-positioned view is a real, known Yoga/RN quirk (two simultaneous constraints to
  // satisfy instead of one clean anchor) and was the only structural asymmetry found anywhere
  // between the P1 (bottom) and P2 (top) tap-zone code paths after an otherwise-exhaustive review.
  faceoffZoneBottom: { height: '50%', left: 0, position: 'absolute', right: 0, top: '50%' },
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
  settingsButton: { justifyContent: 'center', position: 'absolute' }
})
