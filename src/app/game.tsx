import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { broadcastDeviceUnlocks } from '@tastic/achievements'
import { useBackgroundPause, useOrientationState, useRotation, useSettledWindowDimensions } from '@tastic/core'
import { AchievementUnlockList, type AchievementUnlockOwner, ConfirmDialog, useQuitConfirmation } from '@tastic/hud'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { Icon, Text } from 'react-native-paper'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { type EdgeInsets, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch, useSelector } from 'react-redux'

import Board from '@/components/BoardHost'
import { SettingsDialog } from '@/components/SettingsDialog'
import { ACHIEVEMENT_TIER_COLORS } from '@/constants/achievements'
import { COIN_FLIP_TOTAL_MS, DESKTOP_WEB_MIN_WIDTH, FRICTION_LEVELS, GOAL_LINE_STROKE_WIDTH, INTERCEPT_SPEED_THRESHOLDS, MAX_FLICK_GESTURE_MS, MIN_SHOOT_DRAG, SHOT_PREVIEW_LENGTH_RATIOS, STRIKE_DURATION_MS } from '@/constants/game'
import { useAIOpponent } from '@/hooks/useAIOpponent'
import { useFaceoff } from '@/hooks/useFaceoff'
import { useGameSound } from '@/hooks/useGameSound'
import { passesFlickShotGate, useGameState } from '@/hooks/useGameState'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { useSettings } from '@/hooks/useSettings'
import { useTripleTap } from '@/hooks/useTripleTap'
import { liveplayActions } from '@/redux/liveplaySlice'
import { DEFAULT_SETTINGS } from '@/redux/settingsSlice'
import type { AppDispatch, RootState } from '@/redux/store'
import { AchievementDefinition, BoardLayout, GamePhase, Player, Settings } from '@/types'
import { computeBoardLayout, faceoffZoneCenter, faceoffZoneCenters, faceoffZoneRadius } from '@/utils/board'
import { safeBack } from '@/utils/navigation'

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

// Web has no second pointer for a two-person race, so A/D and ←/→ stand in for P1/P2's
// left/right zone - the classic "two players share one keyboard" split (left-hand keys vs. the
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

const SEATS: readonly Player[] = [1, 2]

export default function GameScreen() {
  // The board itself always stays visually fixed 'faceToFace' - never wrapped in
  // @tastic/split-screen's FakeLandscapeView the way /index and /loadout are, regardless of the
  // Lock Orientation setting or how the phone is actually held. Its fixed top/bottom goal geometry
  // (see Board.tsx/computeBoardLayout) assumes a tall aspect ratio, and reflowing it would also
  // rotate TouchInputLayer's own hit-zones out from under the swipe-to-turn gesture. Live physical
  // tilt is still tracked (see MatchOverlays below), just isolated to a sibling of the board/gesture
  // tree so a live accelerometer reading never cascades a re-render into it - that rotation only
  // ever reaches the dialogs floating on top, so they stay legible however the phone is held.
  // Committed once by /loadout when every human player readied up (liveplay.activeRoundSettings, see liveplaySlice.ts) -
  // falls back to defaults for a direct/deep link to this screen, which never went through
  // /loadout to commit anything. orientationMode is a /loadout-only layout setting (see
  // types/index.ts) and never reaches here.
  // settings/setSettings (the persisted "next round" defaults, not this round's own locked-in
  // activeRoundSettings above) are only needed to hand off to MatchOverlays' own SettingsDialog
  // below - its Lock Orientation/Edge Guard toggles edit the persisted defaults, not this
  // already-underway round's own snapshot.
  const { settings, setSettings } = useSettings()
  const activeRoundSettings = useSelector((state: RootState) => state.liveplay.activeRoundSettings)
  const dispatch = useDispatch<AppDispatch>()
  const { recordMatchOutcome } = useGameStats()
  const { lastSelected, profiles } = useProfiles()
  const { clear: clearToasts, success: showAchievementToast } = useToast()
  const roundSettings = activeRoundSettings ?? DEFAULT_SETTINGS
  const scoreToWin = roundSettings.scoreToWin
  const layout = roundSettings.boardVariant
  const tipoffMode = roundSettings.tipoffMode
  const friction = FRICTION_LEVELS[roundSettings.friction]
  const interceptThreshold = INTERCEPT_SPEED_THRESHOLDS[roundSettings.interceptSpeed]
  const puckSize = roundSettings.puckSize
  const controlScheme = roundSettings.controlScheme
  // Only P2 can be CPU-controlled for now - pass-and-play stays the default, single-player just
  // swaps who takes P2's turns (see useAIOpponent, which plays the exact same gesture contract).
  const aiPlayer: Player | null = roundSettings.gameMode === 'vsCpu' ? 2 : null
  const aiDifficulty = roundSettings.aiDifficulty

  const { width, height } = useSettledWindowDimensions()
  const insets = useSafeAreaInsets()

  const rink = roundSettings.rink

  // Whole-board 180° flip for a physically upside-down faceToFace hold - deliberately narrower than
  // MatchOverlays' own `rotation` (which also covers sideBySide's ±90°, still handled there):
  // rotating the board a quarter turn would need a genuinely different feature (swapped
  // width/height, a new goal axis, the works - see AirHockey's own goalAxis for how big that is).
  // A half turn is the one case cheap enough to support here, since it doesn't change the board's
  // own aspect ratio at all - it only needs every raw touch coordinate this screen reads converted
  // back to the board's own canonical (never-rotated) space before it reaches useGameState, since
  // that reducer, Board.tsx's own drawing, and faceoffZoneCenters all still assume the board's
  // original, un-rotated frame. Read directly here (not just in MatchOverlays) specifically so the
  // touch handlers below can close over it - the tradeoff called out in MatchOverlays' own comment
  // (this board/gesture tree now re-renders on a live tilt change too) is accepted deliberately for
  // this feature; tilt changes are debounced at the source (see useOrientationState) so this is an
  // occasional re-render, not a per-frame one. Lock Orientation applies here too, like everywhere
  // else: _layout.tsx's OrientationProvider (freezeWhileLocked) freezes this shared reading itself
  // while it's on, so a locked board neither flips nor re-maps touches when the phone is turned
  // over mid-match (it stays at whichever way up it was when the lock went on).
  const orientation = useOrientationState()
  const isUpsideDown = orientation.orientationMode === 'faceToFace' && orientation.upsideDown

  // computeBoardLayout's own insets.top/bottom handling is asymmetric BY DESIGN for the normal,
  // never-rotated case: the top inset is reserved externally (boardArea's own marginTop below,
  // outside anything that ever rotates) while the bottom inset is reserved internally (fieldHeight
  // shrinks, leaving empty canvas at the container's own bottom edge, wherever that physically is).
  // That asymmetry is exactly what breaks under a 180° flip: rotating boardAreaTouchable spins its
  // OWN internal bottom-gap up to become its own top, but the external marginTop reservation is
  // OUTSIDE that rotation and never moves - so post-rotation, the two reservations stack at the
  // physical top (leaving none at the bottom) instead of one relocating to each end. There's no
  // value of boardMarginTop that fixes this while keeping one end external/one end internal, since
  // rotation can only ever flip the internal one. The fix is to stop asking computeBoardLayout to
  // reserve either end at all when upside-down (feed it a shrunk container + zeroed top/bottom
  // insets, so it fills edge-to-edge with no internal gap to mis-flip) and instead reserve BOTH
  // insets externally and symmetrically, via marginTop AND marginBottom on boardArea below - neither
  // of which ever rotates, so both stay pinned to their own real physical edge regardless.
  // One accepted narrower side effect: Settings.rink's own "pocket reaches all the way to the
  // screen edge" enhancement (see computeBoardLayout's behindGoalDepth/topBorrow/bottomBorrow) reads
  // its own reach from these SAME insets - zeroing them for this case also disables that reach,
  // falling back to the plain physics-minimum pocket depth instead. Narrow and cosmetic (rink AND
  // upside-down AND rink's own pocket-reach specifically), not a correctness bug like the one this
  // whole comment is about, so left as a known tradeoff rather than solved here too.
  // Memoized in its own right (not just inlined into the board useMemo below) since a fresh object
  // literal on every render would otherwise bust that memo every single time regardless of whether
  // any of its actual inputs changed.
  const boardInsets: EdgeInsets = useMemo(() => (isUpsideDown ? { top: 0, right: insets.right, bottom: 0, left: insets.left } : insets), [isUpsideDown, insets])
  // A goal line's own stroke is centered ON board.y/board.y+board.height, so it needs half its own
  // width of clear canvas beyond whichever edge it sits on to render un-clipped. Board.tsx's own
  // topBleed already reserves (more than) this much above board.y=0, unconditionally, for a
  // different reason (room for the strike-swing animation) - nothing has ever reserved the matching
  // half-stroke below board.y+board.height, because it never needed it: outside this upside-down
  // case, fieldHeight is always already smaller than the real container by insets.bottom (see the
  // big comment above), which was always by itself far more slack than half a 4px stroke needs. This
  // case is the one place that natural slack is gone (fieldHeight now fills the container exactly),
  // so it's the one place a deliberate bottomBleed has to stand in for it.
  const bottomBleed = isUpsideDown ? GOAL_LINE_STROKE_WIDTH / 2 : 0
  const boardScreenHeight = isUpsideDown ? height - insets.top - insets.bottom - bottomBleed : height
  const board = useMemo(() => computeBoardLayout(width, boardScreenHeight, boardInsets, layout, puckSize, rink), [width, boardScreenHeight, boardInsets, layout, puckSize, rink])
  // Resolved to pixels here (not inside Board.tsx) for the same reason `friction` is resolved
  // above - the enum→number mapping is a settings concern, board.width isn't known until here.
  const shotPreviewLengthPx = board.width * SHOT_PREVIEW_LENGTH_RATIOS[roundSettings.shotPreviewLength]

  // The REAL, physical Y-offset of boardArea's own origin (see the big comment above) - NOT simply
  // board.boardMarginTop once upside-down, since that now reflects the zeroed boardInsets.top (0),
  // not the real inset boardArea's own marginTop below actually has to reserve.
  const boardAreaMarginTop = isUpsideDown ? insets.top : board.boardMarginTop
  // The real on-screen size of boardAreaTouchable below - what e.x/e.y and
  // e.absoluteY - boardAreaMarginTop are actually measured against, and so the correct extent to
  // reflect a raw coordinate around. Normal case fills to the screen's own bottom edge (height -
  // boardAreaMarginTop, insets.bottom handled internally instead - see the big comment above);
  // upside-down instead stops boardAreaHeight/insets.bottom short of it, since boardArea now also
  // carries an explicit marginBottom reserving that same space externally.
  const boardAreaHeight = isUpsideDown ? height - insets.top - insets.bottom : height - boardAreaMarginTop

  // Settings/quit-confirm dialogs pause gameplay while open - declared up here, ahead of
  // useGameState/useAIOpponent/useFaceoff below, so `paused` exists in time to thread into all
  // three (each halts its own timers/RAF loop while true - see their own comments).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // useQuitConfirmation reads hasProgress lazily (only inside a real requestBack() call, via its
  // own ref-mirrored getter - see that hook's own doc) rather than taking a plain boolean, which is
  // exactly what makes this safe to call before `scores` exists yet: `scores` comes from
  // useGameState's returned state, which itself needs `paused` (derived from confirmVisible) as an
  // INPUT, so a plain-boolean argument computed from `scores` here would be a real circular render
  // dependency. Only asked once there's a real score to lose - 0-0 exits immediately, since there's
  // nothing yet for a confirmation to protect (mirrors LightCycles' identical quit-confirmation gate).
  const { confirmVisible, requestBack, cancelBack } = useQuitConfirmation(() => scores[0] > 0 || scores[1] > 0, safeBack)
  // Leaving the app mid-match (home, app switch, a phone call, Control Center) latches a pause that
  // only the Paused dialog's Resume clears - see @tastic/core's useBackgroundPause. Skipped once the
  // match is over, or while a dialog already holds the pause by itself.
  const { backgroundPaused, resume } = useBackgroundPause(() => phase !== 'gameOver' && !settingsOpen && !confirmVisible)
  const paused = settingsOpen || confirmVisible || backgroundPaused

  const { state, tryAimStart, aimUpdate, aimCancel, shoot, applyStrike, nextRound, resetGame, coinFlipDone, faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart, tripleTapPress, tripleTapSwipeStart, tripleTapSwipeEnd, tripleTapLaunch, setInterceptTouch } = useGameState(board, scoreToWin, tipoffMode, friction, controlScheme, paused, interceptThreshold)
  const { phase, puck, aim, interceptAim, currentPlayer, scores, bounceCount, lastScoredGoal, wellEnterCount, lastWellPolarity, goalDoorHitCount, lastGoalDoorSide, faceoff, tripleTap } = state

  // Mirrors "an actual live shot attempt (aiming/striking/simulating), not paused" up to
  // liveplay.activelyPlaying for Providers.tsx's EdgeGuardBridge rather than calling
  // useEdgeGestureGuard directly here: it stays mounted once for the app's lifetime, and this is
  // just the one signal it has no other way to read. Unlocked between shots
  // (idle/scored/faceoff/coinFlip/gameOver) and whenever a dialog is open (paused) - back/settings
  // stay unconditionally visible here (unlike Snake/LightCycles; see this screen's own back/
  // settings chips below), so there's no button-visibility signal to key off instead. Reset to
  // false on unmount too, so leaving this screen mid-shot by any path can't leave Edge Guard stuck on.
  const isLiveShot = phase === 'aiming' || phase === 'striking' || phase === 'simulating'
  useEffect(() => {
    dispatch(liveplayActions.setActivelyPlaying(isLiveShot && !paused))
    return () => {
      dispatch(liveplayActions.setActivelyPlaying(false))
    }
  }, [isLiveShot, paused, dispatch])

  // No toast may stay on screen during live play - only between rounds or at game over. Unlock
  // toasts fire at game over and last 7s, so a quick restart would otherwise carry them into the
  // next shot.
  useEffect(() => {
    if (isLiveShot) clearToasts()
  }, [isLiveShot, clearToasts])

  useAIOpponent(state, board, aiPlayer, aiDifficulty, friction, controlScheme, paused, interceptThreshold, { tryAimStart, aimUpdate, shoot })
  useFaceoff(state, board, aiPlayer, aiDifficulty, paused, { faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart })
  useTripleTap(state, board, aiPlayer, aiDifficulty, paused, { tripleTapPress, tripleTapSwipeStart, tripleTapSwipeEnd, tripleTapLaunch })

  // A background pause can land mid-way through a CPU windup or intercept (a dialog can't: the corner
  // buttons are hidden for that whole window, see cornerButtonsVisible), and useAIOpponent's timer chain
  // can't pick a half-finished windup back up. Dropping the aim returns the turn to 'idle', so the CPU
  // plans a fresh shot once play resumes; a human's own drag already ended when the app left.
  useEffect(() => {
    if (backgroundPaused) aimCancel()
  }, [backgroundPaused, aimCancel])

  // Mid-slide intercept derived values - computed early since several things below (the cancel-
  // zone haptic, gestureEnabled, Board's own props) all need them. `interceptAim` is only ever
  // non-null while phase==='simulating' (see its own doc comment in types/index.ts), so
  // aimingPlayer/displayAim/puckInterceptable all key off that rather than `phase` directly.
  // aimingPlayer: whichever player's paddle/chevrons/ControlScheme should currently apply -
  // normally state.currentPlayer, but during an in-progress intercept it's the RECEIVER
  // (otherPlayer(currentPlayer)), since currentPlayer itself doesn't flip to them until STRIKE
  // actually lands (see useGameState.ts's STRIKE case for why that flip is deferred that far).
  const puckSpeed = Math.hypot(puck.vx, puck.vy)
  const isIntercepting = interceptAim !== null
  const puckInterceptable = phase === 'simulating' && puckSpeed < interceptThreshold
  // Previews the receiver's color for the WHOLE interceptable window, not just once a drag has
  // actually started - this is the discoverability cue (Board.tsx's ring/glow) that tells a human
  // "you can grab this" before they've touched anything, not only mid-drag.
  const aimingPlayer: Player = phase === 'simulating' && (isIntercepting || puckInterceptable) ? otherPlayer(currentPlayer) : currentPlayer
  const displayAim = aim ?? interceptAim

  // 'coinFlip' mode's ceremony (Board.tsx) doesn't play on its own - it waits on this, which only a
  // tap (see stableCoinFlipTap below) ever flips true. Reset back to false the instant a fresh
  // draw begins (see the prevPhaseRef effect further down), so "Play Again" gets its own tap too,
  // not a free ride on the previous game's.
  const [coinFlipStarted, setCoinFlipStarted] = useState(false)

  const vibration = useVibration()
  const vibrationRef = useRef(vibration)
  useEffect(() => {
    vibrationRef.current = vibration
  })

  // Gameplay SFX - mirrors the haptics below one-for-one (see useGameSound): each event fires its
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
  useEffect(() => {
    soundRef.current = { playSelect, playBounce, playWellAttract, playWellRepel, playFaceoffTick, playFaceoffGo, playFaceoffResolved, playGoal, playWin }
  })

  // colors needed here (not just Board.tsx, which derives its own copy) for the web key hints'
  // text color - see FACEOFF_KEY_HINTS rendering below.
  const { dark, colors: themeColors } = useAutoPaperTheme()

  // High-contrast retro look, matching the home screen: literal black/white by appearance, not
  // auto-paper's own (slightly tinted) background role.
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
  // Back/settings chip background - semi-opaque bg (not solid, and not fg-inverted like the rest
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
  // Marks each seat's rows in the Game Over card's achievement list: the seat's profile if one is
  // selected, else a plain avatar in that player's color.
  const achievementOwners: Record<Player, AchievementUnlockOwner> = {
    1: { profile: profiles.find((p) => p.id === lastSelected[1]), color: playerColor[1] },
    2: { profile: profiles.find((p) => p.id === lastSelected[2]), color: playerColor[2] }
  }
  const playerOnColor: Record<Player, string> = { 1: themeColors.onPrimary, 2: themeColors.onSecondary }
  const winner: Player = scores[0] >= scoreToWin ? 1 : 2
  const loser: Player = winner === 1 ? 2 : 1

  // Coin flip's tap-target is live until this flips false - the invite itself (a plain pulsing
  // ring at board center) is Board.tsx's job, same visual language as 'faceoff' mode's own
  // ready-check pulse, no separate prompt chrome needed here.
  const coinFlipAwaitingTap = phase === 'coinFlip' && !coinFlipStarted

  // On a phone (native or mobile web), the device's own physical edges already read as "the
  // wall" - no drawn perimeter needed. Desktop web has no such edge (the board just floats in an
  // arbitrarily-sized browser window), so it's the one place Board.tsx still draws the perimeter
  // walls (see showWalls below).
  const isDesktopWeb = Platform.OS === 'web' && width >= DESKTOP_WEB_MIN_WIDTH

  // ─── Auto-advance from 'scored' ───────────────────────────────────────────
  // Also held while paused (settings or quit-confirm dialog up) - otherwise this timer keeps
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
  // Gated on coinFlipStarted (the tap that kicks off Board.tsx's ceremony - see stableCoinFlipTap
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
  // `pendingShot` until this fires - Board.tsx spends this window animating the stick from the
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
  // direction (back inside it, or out past it) - the phantom-puck circle (Board.tsx) is the only
  // visual cue for that boundary today, so this gives it a tactile confirmation too. Deliberately
  // does NOT fire for the trivial "just touched down at distance 0" state (aimActive flips
  // false→true) or the drag ending (aimActive flips true→false) - both `wasAimActive` and
  // `aimActive` have to be true for a crossing to count, so only a real mid-drag boundary cross
  // qualifies; the touch-down moment already gets its own haptic via stableAimStart.
  // displayAim (computed above) merges in an in-progress mid-slide intercept (see interceptAim in
  // types/index.ts) - phase stays 'simulating' for the whole intercept drag, so checking
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

  // ─── Flick auto-commit: a swipe has to be a short, decisive gesture ────────
  // Written by stableAimStart/stableAimUpdate below on every raw gesture event (never the
  // reducer's own EMA-smoothed display velocity), cleared by stableShoot/stableAimCancel the
  // instant a real release/cancel resolves the gesture. A plain ref, not reducer state - deliberately
  // outside useGameState, since useAIOpponent drives CPU shots by calling useGameState's own
  // callbacks directly, bypassing these stable* wrappers entirely; putting the tracking here means a
  // CPU-controlled flick seat never populates this ref, so the cap below can never apply to CPU
  // pacing without needing its own extra guard.
  const flickGestureRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number; peakVx: number; peakVy: number } | null>(null)

  // If a flick drag (fresh aim OR a mid-slide intercept - either can be flick) is still live this
  // long after touch-down, its own already-captured peak energy commits as the shot right now,
  // rather than waiting on a release that may never come "in time" - see MAX_FLICK_GESTURE_MS's own
  // comment in constants/game.ts. A real release before this always wins: stableShoot/
  // stableAimCancel clear flickGestureRef the instant either fires, so this timer's own callback
  // just no-ops if it does. Keyed on aimActive (not phase directly) so it arms once per gesture and
  // covers both cases the same way.
  useEffect(() => {
    if (!aimActive || controlScheme[aimingPlayer] !== 'flick') return
    const t = setTimeout(() => {
      const g = flickGestureRef.current
      if (!g) return // a real release/cancel already resolved this gesture
      const dx = g.currentX - g.startX
      const dy = g.currentY - g.startY
      if (!passesFlickShotGate(Math.hypot(dx, dy), Math.hypot(g.peakVx, g.peakVy))) return // too weak - the drag just keeps going, untouched
      shoot(dx, dy, g.peakVx, g.peakVy) // raw `shoot`, not `stableShoot` - these are already canonical-space values
    }, MAX_FLICK_GESTURE_MS)
    return () => clearTimeout(t)
  }, [aimActive, aimingPlayer, controlScheme, shoot])

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

  // Two-player (pass-and-play) only - seat -> that seat's own newly-unlocked achievements this
  // match, read by MatchOverlays' Game Over card below to badge each seat correctly (see the
  // gameOver effect below for why this replaces showAchievementToast for that mode specifically).
  const [seatUnlocks, setSeatUnlocks] = useState<Partial<Record<Player, AchievementDefinition[]>>>({})

  // Victory fanfare - fires once, the instant the game actually ends, distinct from the goal sound
  // above which fires on every score including the winning one.
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== 'gameOver' && phase === 'gameOver') {
      soundRef.current.playWin()
      // Recorded here rather than in the reducer so it fires exactly once per match, on the
      // transition - the reducer runs on every physics step and has no notion of "this is new".
      // prevPhaseRef guards against a re-run from any other dep changing identity.
      const matchWinner: Player = scores[0] >= scoreToWin ? 1 : 2
      const profileIds = { 1: lastSelected[1] ?? undefined, 2: aiPlayer === null ? (lastSelected[2] ?? undefined) : undefined }
      const result = recordMatchOutcome({ winner: matchWinner, scores: [scores[0], scores[1]] }, { gameMode: roundSettings.gameMode, aiDifficulty, boardVariant: layout, profileIds })
      if (aiPlayer === null) {
        // Genuine two-seat pass-and-play - showAchievementToast below is a single, screen-fixed
        // @rific/toaster call with no rotation of its own, so it only ever reads right-side-up for
        // whichever seat happens to be physically upside-up right now. A player seated opposite
        // (seat 2 sits rotated 180° from seat 1 - see isUpsideDown above) would see it upside-down
        // even though it's their own achievement. Broadcasting into seatUnlocks instead lets the
        // Game Over card below (which already carries its own cardRotationStyle) show each seat's
        // own unlocks once the match settles. Device-wide achievements have no per-seat owner, but
        // both seats are human here, so they're broadcast into both seats' own entries rather than
        // dropped or arbitrarily attributed to one side.
        const broadcast = broadcastDeviceUnlocks([1, 2] as Player[], result.profiles, result.device)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- a real one-shot transition guarded by prevPhaseRef above, not a render loop; the sibling vsCpu branch below fires showAchievementToast (which does the same thing inside @rific/toaster) unconditionally in this same effect
        setSeatUnlocks(broadcast)
      } else {
        // vsCpu only ever has one human perspective (seat 1; seat 2 is the CPU) to address, so the
        // shared, screen-fixed toast is fine here - one per newly-unlocked achievement, in its own
        // tier color and icon, its own profile unlocks joining the device-wide ones as before.
        ;[...result.device, ...(result.profiles[1] ?? [])].forEach((achievement) => {
          showAchievementToast(achievement.title, 'Achievement unlocked', undefined, { color: ACHIEVEMENT_TIER_COLORS[achievement.tier], icon: achievement.icon })
        })
      }
    }
    // Reset the tap-to-flip gate the instant a fresh coin-flip draw begins (game start, or a new
    // game via Game Over's "Play Again") - see coinFlipStarted/stableCoinFlipTap below. This is the
    // only thing that ever flips it back to false; stableCoinFlipTap is the only thing that ever
    // flips it back to true.
    if (prevPhaseRef.current !== 'coinFlip' && phase === 'coinFlip') {
      setCoinFlipStarted(false)
    }
    prevPhaseRef.current = phase
  }, [phase, scores, scoreToWin, aiPlayer, aiDifficulty, layout, lastSelected, roundSettings.gameMode, recordMatchOutcome, showAchievementToast])

  // ─── Gesture bridge ───────────────────────────────────────────────────────
  // isUpsideDown-conditional reflection lives in these stable JS callbacks, not in the Gesture.*
  // worklets that feed them (panGesture below still passes raw e.x/e.y/e.translationX/Y straight
  // through, unchanged) - keeping the worklet definitions untouched avoids adding
  // isUpsideDown/width/boardAreaHeight to their own dependency arrays, where any risk of a
  // less-than-stable reference would recreate (and re-mount) the native gesture recognizer itself.
  // A point (absolute position) reflects around the real container extent; see stableAimUpdate/
  // stableShoot below for why a vector (translation/velocity) instead just negates.
  const toCanonicalPoint = (x: number, y: number): [number, number] => (isUpsideDown ? [width - x, boardAreaHeight - y] : [x, y])
  const stableAimStart = useCallback(
    (x: number, y: number) => {
      const [px, py] = toCanonicalPoint(x, y)
      const started = tryAimStart(px, py)
      if (started) {
        flickGestureRef.current = { startX: px, startY: py, currentX: px, currentY: py, peakVx: 0, peakVy: 0 }
        vibrationRef.current.short()
        soundRef.current.playSelect()
      }
    },
    [tryAimStart, isUpsideDown, width, boardAreaHeight] // eslint-disable-line react-hooks/exhaustive-deps -- toCanonicalPoint is derived from these same primitives every render, not an independent dep
  )

  // While intercepting (phase === 'simulating'), skip the AIM_UPDATE dispatch path entirely and
  // just write the latest finger position into useGameState's own ref instead (see
  // setInterceptTouch's doc comment in useGameState.ts) - that ref gets folded into the SAME
  // dispatch the physics rAF loop already fires every frame, rather than firing a second,
  // independent dispatch (and re-render) at the gesture's own uncorrelated rate. An earlier fix
  // just throttled the direct dispatch instead, which only traded one artifact for another: two
  // still-independent update streams at two different frequencies beat against each other,
  // producing the reported jitter rather than a clean stall. A normal aim (phase === 'aiming')
  // keeps dispatching AIM_UPDATE directly as before - the puck is stationary and the physics loop
  // is off then, so there's nothing for it to compete with.
  const stableAimUpdate = useCallback(
    (x: number, y: number, vx: number, vy: number) => {
      const [px, py] = toCanonicalPoint(x, y)
      // vx/vy is a velocity VECTOR, not a position - reflecting it around the container extent the
      // way px/py above does would be wrong (a vector has no origin to reflect around); rotating a
      // vector 180° instead just negates both components, so upside-down only flips its sign.
      const [pvx, pvy] = isUpsideDown ? [-vx, -vy] : [vx, vy]
      // Tracks the live drag and its peak instantaneous speed for the flick auto-commit timer above
      // (flickGestureRef) - raw, canonical-space values, same ones a real release would use. Runs
      // for both a fresh aim and a mid-slide intercept alike; a no-op once flickGestureRef has
      // already been cleared by a real release/cancel.
      if (flickGestureRef.current) {
        const g = flickGestureRef.current
        g.currentX = px
        g.currentY = py
        if (Math.hypot(pvx, pvy) > Math.hypot(g.peakVx, g.peakVy)) {
          g.peakVx = pvx
          g.peakVy = pvy
        }
      }
      if (phase === 'simulating') {
        setInterceptTouch(px, py, pvx, pvy)
        return
      }
      aimUpdate(px, py, pvx, pvy)
    },
    [aimUpdate, setInterceptTouch, phase, isUpsideDown, width, boardAreaHeight] // eslint-disable-line react-hooks/exhaustive-deps -- toCanonicalPoint derives from these same primitives every render
  )
  const stableShoot = useCallback(
    (tx: number, ty: number, vx: number, vy: number) => {
      // tx/ty here is e.translationX/Y (a displacement VECTOR from the drag's own start point, not
      // an absolute position) - same negate-not-reflect treatment as vx/vy, see stableAimUpdate above.
      const [ptx, pty, pvx, pvy] = isUpsideDown ? [-tx, -ty, -vx, -vy] : [tx, ty, vx, vy]
      flickGestureRef.current = null // a real release always wins over the auto-commit timer above
      shoot(ptx, pty, pvx, pvy)
    },
    [shoot, isUpsideDown]
  )
  const stableAimCancel = useCallback(() => {
    flickGestureRef.current = null
    aimCancel()
  }, [aimCancel])

  // The coin-flip ceremony's own "go" tap (see Board.tsx and coinFlipStarted above) - anyone's tap
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

  // Mirrors vibrationRef/soundRef above - read live faceoff state through a ref instead of
  // closing over `faceoff` directly. `faceoff` is a new object on every single sub-action
  // (each countdown tick, hold, live flip), and these callbacks feed p1TapGesture/p2TapGesture
  // below; closing over `faceoff` would recreate those Gesture.Tap() objects on every tick,
  // tearing down and remounting the native/web gesture handler at the exact instant FACEOFF_LIVE
  // fires - the moment a real tap is most likely to land - silently dropping it. Keeping these
  // callbacks stable across a draw is what keeps the gesture handler itself stable.
  const faceoffRef = useRef(faceoff)
  useEffect(() => {
    faceoffRef.current = faceoff
  })

  // Ready-check (game's first draw only - see FaceoffState's doc comment): any touch/key on a
  // player's own side counts, no need to hit a specific circle - there's nothing to aim at yet,
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
  // - both pulse, only one flashes color), so this takes a zoneIndex directly rather than
  // resolving one from a touch position itself (see stableFaceoffTouch below for the touch path,
  // and the keyboard effect further down for the other). Deliberately dispatches even a WRONG
  // zone rather than swallowing it client-side - useGameState's FACEOFF_TAP treats pressing the
  // one that never colored as an instant disqualification (though not an instant *resolution* -
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
  // stableFaceoffReady above) - otherwise resolve which of the player's two zones (if either) a
  // raw (x, y) actually landed in, hit-tested against the exact same geometry Board.tsx draws
  // them at (see faceoffZoneCenters/faceoffZoneRadius in utils/board.ts), then defer to the
  // dispatcher above. A tap outside BOTH circles is a true no-op (nothing to attribute it to) -
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
      // (x, y) arrives in real, physical boardArea-local space; faceoffZoneCenters returns the
      // board's own canonical (never-rotated) circle positions, so reflect back to that space first
      // when upside-down - same treatment as stableAimStart/Update's own px/py above, and load-
      // bearing together with the faceoffZoneBottom/Top swap in the JSX below (that swap gets the
      // right PLAYER for whichever physical zone was actually touched; this reflection is what then
      // makes that player's own true zone positions hit-test correctly against it).
      const [px, py] = toCanonicalPoint(x, y)
      const r = faceoffZoneRadius(board)
      const zoneIndex = faceoffZoneCenters(board, player).findIndex((c) => Math.hypot(px - c.x, py - c.y) <= r)
      if (zoneIndex === -1) return
      stableFaceoffZoneTap(player, zoneIndex as 0 | 1)
    },
    [board, stableFaceoffZoneTap, stableFaceoffReady, isUpsideDown, width, boardAreaHeight] // eslint-disable-line react-hooks/exhaustive-deps -- toCanonicalPoint derives from these same primitives every render
  )

  // Mirrors faceoffRef above - read live tripleTap state through a ref instead of closing over
  // `tripleTap` directly, for the same reason: it's a new object on every sub-action (each press,
  // each swipe), and closing over it would tear down/remount p1TripleTapGesture/p2TripleTapGesture
  // below on every one of them.
  const tripleTapRef = useRef(tripleTap)
  useEffect(() => {
    tripleTapRef.current = tripleTap
  })

  // The third press's touch-down - only meaningful once that player's own 2 taps are already in
  // and they haven't already started this draw's swipe (both re-checked against live state, not
  // assumed from the gesture's own call site). Fires TRIPLE_TAP_SWIPE_START, which is what supplies
  // the "who went first" timestamp - see TripleTapState's own doc comment in types/index.ts.
  const stableTripleTapSwipeStart = useCallback(
    (player: Player) => {
      const tt = tripleTapRef.current
      if (!tt || tt.tapCount[player - 1] !== 2 || tt.swipeStartedAt[player - 1] !== null) return
      tripleTapSwipeStart(player, Date.now())
      vibrationRef.current.short()
    },
    [tripleTapSwipeStart]
  )

  // The third press's release - or, for either of the first two presses, just a plain tap. Which
  // one this is is decided entirely by that player's own live tapCount, not by how far the touch
  // actually moved (see TipoffMode's own doc comment: any press-release counts toward the first 2,
  // regardless of movement - only the 3rd press's real drag vector matters). tx/ty is
  // e.translationX/Y (a displacement VECTOR from this drag's own start point) - same negate-not-
  // reflect treatment under isUpsideDown as stableShoot's own tx/ty above, not the reflect-around-
  // extent treatment a position gets.
  const stableTripleTapPressOrSwipeEnd = useCallback(
    (player: Player, tx: number, ty: number) => {
      const tt = tripleTapRef.current
      if (!tt) return
      const [ptx, pty] = isUpsideDown ? [-tx, -ty] : [tx, ty]
      if (tt.tapCount[player - 1] < 2) {
        tripleTapPress(player, Date.now())
      } else {
        tripleTapSwipeEnd(player, ptx, pty)
      }
      vibrationRef.current.short()
      soundRef.current.playSelect()
    },
    [tripleTapPress, tripleTapSwipeEnd, isUpsideDown]
  )

  // Keyboard path (web only) - a shared touchscreen lets two people press two different spots at
  // once; a shared mouse can't. A/D drive P1's left/right zone, ←/→ drive P2's (see
  // FACEOFF_KEY_HINTS above, which labels these on screen - shown throughout 'faceoff', ready
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
  // e.translationX/Y are used directly - can start anywhere on the board, not just on the puck
  // (see useGameState's tryAimStart).
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        // eslint-disable-next-line react-hooks/refs -- stableAimStart reads a ref; this is a gesture event handler, never invoked during render
        .onStart((e) => {
          runOnJS(stableAimStart)(e.x, e.y)
        })
        // eslint-disable-next-line react-hooks/refs -- stableAimUpdate reads/writes flickGestureRef; this is a gesture event handler, never invoked during render
        .onChange((e) => {
          runOnJS(stableAimUpdate)(e.x, e.y, e.velocityX, e.velocityY)
        })
        // eslint-disable-next-line react-hooks/refs -- stableShoot writes flickGestureRef; this is a gesture event handler, never invoked during render
        .onEnd((e) => {
          runOnJS(stableShoot)(e.translationX, e.translationY, e.velocityX, e.velocityY)
        })
        // eslint-disable-next-line react-hooks/refs -- stableAimCancel writes flickGestureRef; this is a gesture event handler, never invoked during render
        .onFinalize(() => {
          runOnJS(stableAimCancel)()
        })
        .minDistance(0),
    [stableAimStart, stableAimUpdate, stableShoot, stableAimCancel]
  )

  // ─── Tip-off tap zones ─────────────────────────────────────────────────────
  // Two independently-bounded single-pointer recognizers, one per half of the screen - P1 =
  // bottom, P2 = top, matching where their circles actually render (faceoffZoneCenters puts
  // player 1's pair near board.y + board.height, the same "P1's half" convention the goal crease/
  // score pips/zone lines already use throughout Board.tsx). Getting this backwards would put a
  // player's own gesture zone and their actual on-screen circles in different halves entirely, so
  // a tap could never land close enough to register - worth stating explicitly since it's not
  // necessarily the seating order /loadout uses for its panels, which is a display-only layout
  // choice, not a gameplay contract (though as of the P1-always-bottom change, both now agree:
  // /loadout already treats P1 as the device owner in the near/bottom zone).
  // Split into two recognizers (rather than one spanning the whole screen with the player inferred
  // from touch position) because a tap recognizer is built around tracking a single pointer's
  // lifecycle, and two near-simultaneous touches in different regions isn't a reliably-specified
  // multitouch race for one recognizer to arbitrate. .onBegin fires on initial contact, before
  // RNGH's own tap-recognition (duration/distance) resolves - the correct low-latency instant to
  // timestamp a reaction, rather than waiting for .onEnd. Only enabled during 'faceoff' -
  // pointerEvents is toggled the same way below so these transparent zones don't intercept the
  // normal puck-drag gesture underneath them the rest of the time, even though they're mounted as
  // later (and so visually topmost) siblings of the board.
  //
  // MUST use e.absoluteX/e.absoluteY here, never the plain e.x/e.y - RNGH reports x/y relative to
  // whichever view the gesture is physically attached to, not to boardArea. p2TapGesture's own
  // view (faceoffZoneTop) happens to start at the same origin as boardArea (top: 0), so its e.y
  // was accidentally already boardArea-relative - but p1TapGesture's view (faceoffZoneBottom) is
  // offset halfway down boardArea, so its e.y was relative to THAT view's own top edge, off by
  // roughly half the screen height from what stableFaceoffTouch's hit-test (faceoffZoneCenters,
  // in board/boardArea-local coordinates) expects. That mismatch made every P1 live-window tap
  // silently miss the hit-test (zoneIndex resolves to -1, no dispatch at all - not even a
  // wrong-zone forfeit), while the 'ready' stage stayed unaffected since it skips the hit-test
  // entirely (see stableFaceoffTouch). absoluteX/Y are screen-relative regardless of which nested
  // view the gesture sits on, and boardArea itself starts at screen (0, board.boardMarginTop) - no
  // left margin, and marginTop: board.boardMarginTop is boardArea's only offset from the screen
  // origin - so subtracting board.boardMarginTop from absoluteY (and using absoluteX as-is)
  // converts back to exactly the same board-local space board.x/board.y and faceoffZoneCenters
  // already assume, for BOTH zones uniformly, rather than relying on one of them coincidentally
  // matching by construction. board.boardMarginTop, NOT the raw insets.top - the rink pocket
  // setting moves boardArea's actual origin up into the safe-area inset (see boardMarginTop's own doc comment on
  // BoardLayout), and this conversion has to track wherever the container's real origin is, same
  // as it already had to for the two zones' differing view origins.
  const p1TapGesture = useMemo(
    () =>
      Gesture.Tap()
        // eslint-disable-next-line react-hooks/refs -- stableFaceoffTouch reads a ref; see panGesture's .onStart comment above
        .onBegin((e) => runOnJS(stableFaceoffTouch)(1, e.absoluteX, e.absoluteY - boardAreaMarginTop))
        .enabled(phase === 'faceoff'),
    [stableFaceoffTouch, phase, boardAreaMarginTop]
  )
  const p2TapGesture = useMemo(
    () =>
      Gesture.Tap()
        // eslint-disable-next-line react-hooks/refs -- see p1TapGesture's own comment above
        .onBegin((e) => runOnJS(stableFaceoffTouch)(2, e.absoluteX, e.absoluteY - boardAreaMarginTop))
        .enabled(phase === 'faceoff'),
    [stableFaceoffTouch, phase, boardAreaMarginTop]
  )

  // ─── Triple-tap zones ────────────────────────────────────────────────────
  // Same disjoint bottom/top-half split as p1TapGesture/p2TapGesture above (P1 = bottom, P2 = top -
  // see that pair's own comment), rendered on separate views at the identical position rather than
  // composed onto the same gesture object, since only one of the two tip-off modes is ever
  // 'enabled' at once. There's only one zone per player (no hidden target, so no position hit-test
  // is needed at all: unlike stableFaceoffTouch, these never read e.absoluteX/Y).
  //
  // Gesture.Race(Tap, Pan), not a bare Pan - a genuine UIPanGestureRecognizer (what Gesture.Pan()
  // wraps) fundamentally detects MOVEMENT; a true near-zero-movement tap doesn't reliably activate
  // it at all (confirmed empirically: onEnd simply never fired for a stationary touch, .minDistance
  // (0) notwithstanding - that only lowers how much movement is REQUIRED to activate, it doesn't
  // make a movement-detecting recognizer fire for NO movement). Presses 1-2 are ordinary taps, so
  // they need a real Gesture.Tap() to catch them; the 3rd press is a real drag, which Pan still
  // handles. Racing the two lets whichever one actually matches the physical gesture win: a quick,
  // near-stationary touch resolves as Tap (Pan's own distance requirement never activates in time to
  // preempt it), a real drag resolves as Pan (Tap fails once movement/duration exceeds its own
  // thresholds). Both gestures' onBegin call stableTripleTapSwipeStart unconditionally - safe (and
  // necessary) since that callback's own tapCount===2 guard makes it a no-op for presses 1-2
  // regardless of which recognizer's onBegin fires first, and it's what guarantees swipeStartedAt is
  // set before EITHER recognizer's onEnd can dispatch a TRIPLE_TAP_SWIPE_END for the 3rd press, even
  // on the rare case where a fast/short 3rd press resolves via Tap rather than Pan.
  //
  // p1TripleTapKey/p2TripleTapKey: a player's own tapCount, threaded onto the GestureDetector's own
  // JSX `key` below - forces React to fully unmount and remount the detector (tearing down and
  // recreating the underlying native recognizers from scratch) after every press, rather than
  // reusing the same long-lived recognizer instance across multiple, separate, discrete touch
  // sequences. Confirmed empirically necessary: without this, only a zone's FIRST tap of a draw
  // ever registered - the second (and any later) tap on the same still-mounted recognizer was
  // silently dropped, on both the Tap and Pan sides of the race alike, and on both real taps and
  // real swipes. The faceoff mode's own zones never hit this, since each of THEIR zones only ever
  // needs exactly one successful tap per draw, never a second one on an already-used recognizer.
  const p1TripleTapKey = tripleTap?.tapCount[0] ?? 0
  const p2TripleTapKey = tripleTap?.tapCount[1] ?? 0
  const p1TripleTapGesture = useMemo(() => {
    const tripleTapEnabled = phase === 'tripleTap'
    const tap = Gesture.Tap()
      // eslint-disable-next-line react-hooks/refs -- stableTripleTapSwipeStart reads a ref; see panGesture's .onStart comment above
      .onBegin(() => runOnJS(stableTripleTapSwipeStart)(1))
      // eslint-disable-next-line react-hooks/refs -- stableTripleTapPressOrSwipeEnd reads a ref; see panGesture's .onStart comment above
      .onEnd(() => runOnJS(stableTripleTapPressOrSwipeEnd)(1, 0, 0))
      .enabled(tripleTapEnabled)
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(0)
      // eslint-disable-next-line react-hooks/refs -- see tap's own comment above
      .onBegin(() => runOnJS(stableTripleTapSwipeStart)(1))
      // eslint-disable-next-line react-hooks/refs -- see tap's own comment above
      .onEnd((e) => runOnJS(stableTripleTapPressOrSwipeEnd)(1, e.translationX, e.translationY))
      .enabled(tripleTapEnabled)
    return Gesture.Race(tap, pan)
  }, [stableTripleTapSwipeStart, stableTripleTapPressOrSwipeEnd, phase])
  const p2TripleTapGesture = useMemo(() => {
    const tripleTapEnabled = phase === 'tripleTap'
    const tap = Gesture.Tap()
      // eslint-disable-next-line react-hooks/refs -- see p1TripleTapGesture's own comment above
      .onBegin(() => runOnJS(stableTripleTapSwipeStart)(2))
      // eslint-disable-next-line react-hooks/refs -- see p1TripleTapGesture's own comment above
      .onEnd(() => runOnJS(stableTripleTapPressOrSwipeEnd)(2, 0, 0))
      .enabled(tripleTapEnabled)
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(0)
      // eslint-disable-next-line react-hooks/refs -- see p1TripleTapGesture's own comment above
      .onBegin(() => runOnJS(stableTripleTapSwipeStart)(2))
      // eslint-disable-next-line react-hooks/refs -- see p1TripleTapGesture's own comment above
      .onEnd((e) => runOnJS(stableTripleTapPressOrSwipeEnd)(2, e.translationX, e.translationY))
      .enabled(tripleTapEnabled)
    return Gesture.Race(tap, pan)
  }, [stableTripleTapSwipeStart, stableTripleTapPressOrSwipeEnd, phase])

  // Coin flip's own "go" tap - spans the whole board (no zones, no player-attribution, unlike the
  // faceoff pair above), and disables itself the instant it's used so this same tap can't
  // re-trigger anything later in the round.
  const coinFlipTapGesture = useMemo(
    () =>
      Gesture.Tap()
        // eslint-disable-next-line react-hooks/refs -- stableCoinFlipTap reads a ref; see panGesture's .onStart comment above
        .onBegin(() => runOnJS(stableCoinFlipTap)())
        .enabled(phase === 'coinFlip' && !coinFlipStarted),
    [stableCoinFlipTap, phase, coinFlipStarted]
  )

  // ─── Derived display values ───────────────────────────────────────────────
  // Also gated on it not being the CPU's turn, so a stray touch during single-player can't hijack
  // its shot - pass-and-play (aiPlayer === null) keeps its original "whoever touches goes" rule.
  // canIntercept covers BOTH "puck just became slow enough to grab" (interceptAim still null) and
  // "already mid-drag" (interceptAim set) - the OR is required so the gesture doesn't get disabled
  // out from under an in-progress drag if, say, a gravity well transiently pushes the puck's speed
  // back above interceptThreshold before release.
  const canIntercept = phase === 'simulating' && otherPlayer(currentPlayer) !== aiPlayer && (interceptAim !== null || puckInterceptable)
  const gestureEnabled = ((phase === 'idle' || phase === 'aiming') && currentPlayer !== aiPlayer) || canIntercept

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Hidden only here, not on /loadout or the home screen. Originally gated on the rink pocket
          setting alone (it borrows this real estate - see boardMarginTop's own doc comment), but
          the board's top/bottom edges sit flush against insets.top/insets.bottom either way (see
          board.y/board.y+height), so the OS status bar was always overlapping the first couple
          pixels of the goal line there - harmless while that line was thin and just decorative,
          but it started visibly eating into the rink-off wall line's own edge once that line
          needed to read as a solid boundary (see Board.tsx's goal-line color swap). Unconditional
          now. expo-router remounts this component fresh per screen, so leaving is enough to
          restore the bar elsewhere without an explicit cleanup call. */}
      <StatusBar hidden />
      {/* Board + gesture layer, starting right at the safe area unless the rink pocket setting is
          on (marginTop: board.boardMarginTop, which equals insets.top there - see its own doc
          comment on BoardLayout for why rink moves this up into the inset instead) - no score
          bar or turn indicator above it: the puck's own color already says whose turn it is, and
          the score lives on the board itself as pips at each goal (see Board.tsx). The one-finger
          aim gesture only runs during idle/aiming (see gestureEnabled below). */}
      <View style={[styles.boardArea, { marginTop: boardAreaMarginTop, ...(isUpsideDown && { marginBottom: insets.bottom }) }]}>
        <GestureDetector gesture={panGesture.enabled(gestureEnabled)}>
          <View style={[styles.boardAreaTouchable, isUpsideDown && styles.boardAreaUpsideDown]}>
            <Board board={board} puck={puck} aim={displayAim} phase={phase} currentPlayer={currentPlayer} aimingPlayer={aimingPlayer} isIntercepting={isIntercepting} puckInterceptable={puckInterceptable} lastScoredGoal={lastScoredGoal} scores={scores} scoreToWin={scoreToWin} goalDoorHitCount={goalDoorHitCount} lastGoalDoorSide={lastGoalDoorSide} faceoff={faceoff} tripleTap={tripleTap} controlScheme={controlScheme[aimingPlayer]} coinFlipStarted={coinFlipStarted} showWalls={isDesktopWeb} previewLengthPx={shotPreviewLengthPx} shotPreviewLength={roundSettings.shotPreviewLength} friction={friction} />
          </View>
        </GestureDetector>

        {/* Tip-off tap zones - later siblings of the board's own gesture layer so they sit on top
            in z-order, but transparent and pointerEvents='none' outside 'faceoff' so they never
            intercept the normal puck-drag gesture underneath. P1 = bottom half, P2 = top half -
            see the p1TapGesture/p2TapGesture comment above for why this specific pairing (matching
            where their circles render, per board.ts's faceoffZoneCenters - P1 always bottom) is
            load-bearing, not arbitrary. Nested INSIDE boardArea (not siblings of it at the screen
            root) specifically so their own e.x/e.y share boardArea's local origin - the same
            origin board.x/board.y and faceoffZoneCenter() already assume (see utils/board.ts's
            comment on why board.y is *not* offset by insets.top itself: this marginTop already
            accounts for it once). A sibling-of-root placement would double an inset.top>0 into
            every tap's y before stableFaceoffTouch's circular hit-test compares it against
            faceoffZoneCenters' board-local coordinates, silently mis-hitting on any device with a
            notch/status bar.

            Which physical zone (top half vs. bottom half of the real screen) maps to which
            gesture/player SWAPS when upside-down, rather than the Board's own P1/P2 assignment
            moving - Board.tsx keeps drawing P1 at canonical local-bottom always (see
            playerGoalSide), and the visual 180° flip above is what carries that to the screen's
            physical top. A real player's own circle is now physically up there, so the gesture
            that fires on a touch in that physical half has to be p1TapGesture for the two to agree
            - stableFaceoffTouch's own toCanonicalPoint reflection (see its own comment) is what
            then makes that touch's (x, y) hit-test correctly against P1's true canonical zone. */}
        <GestureDetector gesture={p1TapGesture}>
          <View style={isUpsideDown ? styles.faceoffZoneTop : styles.faceoffZoneBottom} pointerEvents={phase === 'faceoff' ? 'auto' : 'none'} />
        </GestureDetector>
        <GestureDetector gesture={p2TapGesture}>
          <View style={isUpsideDown ? styles.faceoffZoneBottom : styles.faceoffZoneTop} pointerEvents={phase === 'faceoff' ? 'auto' : 'none'} />
        </GestureDetector>

        {/* Triple-tap zones - same bottom/top-half positions as the faceoff pair above (see
            p1TripleTapGesture's own comment), only ever pointer-active during 'tripleTap'. `key`
            forces a full remount (see p1TripleTapKey's own comment) after every press. */}
        <GestureDetector key={`p1-${p1TripleTapKey}`} gesture={p1TripleTapGesture}>
          <View style={isUpsideDown ? styles.faceoffZoneTop : styles.faceoffZoneBottom} pointerEvents={phase === 'tripleTap' ? 'auto' : 'none'} />
        </GestureDetector>
        <GestureDetector key={`p2-${p2TripleTapKey}`} gesture={p2TripleTapGesture}>
          <View style={isUpsideDown ? styles.faceoffZoneBottom : styles.faceoffZoneTop} pointerEvents={phase === 'tripleTap' ? 'auto' : 'none'} />
        </GestureDetector>

        {/* Coin flip's "go" tap zone - the whole board, not split into halves like the faceoff
            pair above, since either player flipping it is the entire ceremony (see
            coinFlipTapGesture's own comment). The invite itself (a pulsing ring) is Board.tsx's
            own Skia canvas, not this zone - this is purely the hit target, transparent and
            pointerEvents='none' once coinFlipStarted flips true, same "don't intercept anything
            once its job is done" treatment as the faceoff zones. */}
        <GestureDetector gesture={coinFlipTapGesture}>
          <View style={StyleSheet.absoluteFill} pointerEvents={coinFlipAwaitingTap ? 'auto' : 'none'} />
        </GestureDetector>

        {/* Key hints (desktop web only) - see FACEOFF_KEY_HINTS above for why desktop needs a
            keyboard path at all: a shared mouse can't do a two-person tap race. Gated on
            isDesktopWeb, not bare `Platform.OS === 'web'` - mobile web is still `Platform.OS ===
            'web'` but has touch, not a keyboard, so showing key labels there is just wrong/
            confusing chrome over what's actually a tap input (the p1TapGesture/p2TapGesture zones
            above already work there identically to native). Positioned at the same board-local
            coordinates as the circles themselves (faceoffZoneCenter), inside boardArea for the
            same coordinate-origin reason as the tap zones above. pointerEvents='none' so the
            label never steals the tap/click underneath. Text color is that player's own
            onPrimary/onSecondary - auto-paper's MD3 theme already defines these as the
            intentional contrast pair for primary/secondary (see AutoPaperTheme's colors type),
            tailored to whatever color the player actually picked in loadout, rather than reaching
            for a generic contrast-computation helper - a fixed white label would wash out against
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

      {/* Back + settings chips moved into MatchOverlays below (see its own comment) - they need the
      same live rotation-in-place treatment as its dialogs, which only that component's isolated
      tilt subscription provides. */}
      <MatchOverlays phase={phase} scores={scores} winner={winner} loser={loser} playerColor={playerColor} playerOnColor={playerOnColor} cardBg={cardBg} cardBorder={cardBorder} fgMuted={fgMuted} seatUnlocks={seatUnlocks} achievementOwners={achievementOwners} onResetGame={() => resetGame(board)} confirmVisible={confirmVisible} cancelBack={cancelBack} settingsOpen={settingsOpen} onSettingsDismiss={() => setSettingsOpen(false)} onSettingsOpen={() => setSettingsOpen(true)} settings={settings} setSettings={setSettings} board={board} insets={insets} boardAreaMarginTop={boardAreaMarginTop} fg={fg} cornerButtonBg={cornerButtonBg} onBackPress={requestBack} backgroundPaused={backgroundPaused} onResume={resume} />
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
  // Pass-and-play's own achievement unlocks for the match that just ended (see GameScreen's own
  // seatUnlocks doc comment) - always {} for vsCpu, which keeps using showAchievementToast instead.
  // Rendered in the Game Over card below rather than a toast, since that card already rotates with
  // the device's own live physical hold.
  seatUnlocks: Partial<Record<Player, AchievementDefinition[]>>
  achievementOwners: Record<Player, AchievementUnlockOwner>
  onResetGame: () => void
  confirmVisible: boolean
  cancelBack: () => void
  settingsOpen: boolean
  onSettingsDismiss: () => void
  // Opens the settings dialog - lives here, not just onSettingsDismiss, now that the chip button
  // that triggers it (see the chip JSX below) is rendered here too, alongside the dialog itself.
  onSettingsOpen: () => void
  // The persisted "next round" defaults - passed through from GameScreen's own useSettings()
  // for its own SettingsDialog below (its Lock Orientation/Edge Guard toggles edit these, not the
  // round's own locked-in activeRoundSettings).
  settings: Settings
  setSettings: (update: Partial<Settings>) => void
  // GameScreen's own board layout/insets - needed here only for the back/settings chips' position
  // (see their own comment below), not for anything this component already renders.
  board: BoardLayout
  insets: EdgeInsets
  // GameScreen's own real physical Y-offset of boardArea (see its own doc comment there) - NOT
  // simply board.boardMarginTop once upside-down, since GameScreen feeds computeBoardLayout a
  // zeroed-out inset for that case (see the same comment), making board.boardMarginTop itself 0.
  boardAreaMarginTop: number
  fg: string
  cornerButtonBg: string
  onBackPress: () => void
  // GameScreen's useBackgroundPause latch and its resume, for the Paused dialog below.
  backgroundPaused: boolean
  onResume: () => void
}

// Kept as its own sibling of the board/gesture tree above, specifically so this live tilt
// subscription's re-renders never cascade into it - mirrors LightCycles' identically-shaped
// MatchOverlays. The board itself is permanently 'faceToFace' (see GameScreen's own comment above)
// and never rotates, but the dialogs (and, below, the back/settings chips) this renders float on
// top of it and should still read right-side-up however the phone is actually being held, so they
// rotate their own content in place via `rotation` rather than reflowing layout (unlike /index and
// /loadout's FakeLandscapeView) - the fixed zones have to keep the exact shape TouchInputLayer's
// unrotated hit-zones already use. While Lock Orientation is on, this reading is frozen app-wide
// (see _layout.tsx's OrientationProvider), so the overlays hold the locked angle along with the
// board's own flip above.
function MatchOverlays({ phase, scores, winner, loser, playerColor, playerOnColor, cardBg, cardBorder, fgMuted, seatUnlocks, achievementOwners, onResetGame, confirmVisible, cancelBack, settingsOpen, onSettingsDismiss, onSettingsOpen, settings, setSettings, board, insets, boardAreaMarginTop, fg, cornerButtonBg, onBackPress, backgroundPaused, onResume }: MatchOverlaysProps) {
  const rotation = useRotation()
  const cardRotationStyle = rotation % 360 !== 0 && { transform: [{ rotate: `${rotation}deg` }] }
  // The 180° upsideDown case also swaps which edge each chip sits on - a pure in-place spin isn't
  // enough there: back is coded at the LEFT edge pointing left, and turning only the glyph 180°
  // leaves it pointing right while still sitting on the left, which reads backwards. Repositioning
  // it to the RIGHT edge (rotated glyph included) is what actually reads correctly regardless of
  // which way up the device is held. sideBySide's ±90° doesn't need this: the centerline pair's two
  // endpoints already land on each other under a quarter turn without knowing which JSX block is
  // which, so only the glyph needs to turn there.
  const swapSides = rotation === 180

  // Corner buttons (back/settings) fade out during an active drag or swing rather than just
  // disappearing - FAB's own `visible` prop used to provide this for free, but the plain IconButton
  // used here now (matching index.tsx/loadout.tsx's bare-icon style) has no equivalent, so it's
  // rebuilt directly. Covers 'striking' and 'simulating' as well as 'aiming': not just gameplay
  // polish - it closes the window where a CPU turn's own windup/shoot/settle timer chain (see
  // useAIOpponent.ts) could otherwise get interrupted mid-flight by a just-opened dialog. With all
  // three phases covered, a dialog can only ever open while nothing in that chain is pending; a
  // background pause can still land mid-chain, so it cancels the aim instead (see the aimCancel
  // effect in GameScreen).
  // 'simulating' is also just the puck actually moving - per explicit feedback, the chips should
  // stay out of the way for that whole stretch, not reappear the instant a shot is struck while the
  // puck is still in motion. Lives here (not GameScreen, where these buttons used to render) so the
  // fade and the `cardRotationStyle` rotation above can share the one live tilt subscription instead
  // of needing a second one back in GameScreen.
  const cornerButtonsVisible = phase !== 'aiming' && phase !== 'striking' && phase !== 'simulating'
  const cornerButtonsOpacity = useSharedValue(1)
  useEffect(() => {
    cornerButtonsOpacity.value = withTiming(cornerButtonsVisible ? 1 : 0, { duration: 150 })
  }, [cornerButtonsVisible]) // eslint-disable-line react-hooks/exhaustive-deps
  const cornerButtonsStyle = useAnimatedStyle(() => ({ opacity: cornerButtonsOpacity.value }))

  const progressMessage = (
    <>
      <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
      <Text style={{ color: fgMuted }}> - </Text>
      <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
    </>
  )

  return (
    <>
      {/* Game Over overlay - identifies the winner by their own puck color (see Board.tsx's
          p1Color/p2Color) rather than a "P1"/"P2"/"CPU" label, so it reads the same regardless of
          game mode. Icon stacked above the title (not an inline row) and both actions contained,
          colored by loser/winner - same shell and button treatment as the quit confirmation below
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
              <Text style={{ color: fgMuted }}> - </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            {/* Pass-and-play-only achievement rows - see seatUnlocks' own doc comment in GameScreen
                for why these land here instead of the shared showAchievementToast vsCpu still uses
                (seatUnlocks stays {} there, so this never renders for that mode). This card
                already carries a single shared cardRotationStyle, so each row's owner avatar is
                what tells the two seats' rows apart. */}
            {<AchievementUnlockList unlocks={seatUnlocks} seats={SEATS} owners={achievementOwners} tierColors={ACHIEVEMENT_TIER_COLORS} fg={fg} />}
            <Button mode='contained' onPress={onResetGame} style={styles.overlayButton} buttonColor={playerColor[loser]} textColor={playerOnColor[loser]}>
              Play Again
            </Button>
            <Button mode='contained' onPress={safeBack} style={styles.overlayButton} buttonColor={playerColor[winner]} textColor={playerOnColor[winner]}>
              Quit
            </Button>
          </View>
        </View>
      )}

      {/* Quit confirmation - now the fleet-shared @tastic/hud ConfirmDialog instead of a hand-rolled
          overlay, so this converges on the same component LightCycles' own quit-confirmation uses.
          The score is still spelled out in each player's own color so it's clear who has what
          (same colored-segment markup as before, just without the outer MONO_FONT-styled Text -
          ConfirmDialog supplies its own body Text, which these inherit). `rotation` is the same
          live physical-hold value already computed above for cardRotationStyle/the chip buttons,
          passed through as the raw number rather than re-derived. Trades away this dialog's old
          secondary-accent Quit button and MONO_FONT styling for the shared component's primary
          accent and default font - an approved trade-off, not an oversight. */}
      <ConfirmDialog visible={confirmVisible} title='Quit Match?' message={progressMessage} confirmLabel='Quit' cancelLabel='Cancel' icon='alert-circle-outline' destructive={false} onConfirm={safeBack} onCancel={cancelBack} rotation={rotation} />

      {/* Shown when the app comes back from the background mid-match (see useBackgroundPause above):
      play stays frozen until Resume, so a match never restarts before the player is back and ready. */}
      <ConfirmDialog visible={backgroundPaused} title='Paused' message={progressMessage} confirmLabel='Resume' cancelLabel='Quit' icon='pause-circle-outline' destructive={false} onConfirm={onResume} onCancel={safeBack} rotation={rotation} />

      {/* Back + settings - vertically centered on the side edges at the dividing-wall centerline
          (board.boardMarginTop + board.centerY in root-relative coordinates), rather than the top
          corners used on every other screen. Unlike index.tsx/loadout.tsx, this screen is split
          face-to-face with P2's half rotated 180°, so a top corner sits inside P2's near zone; the
          wall centerline is the one strip of the board no puck can ever occupy, making it neutral
          ground for both players. Deliberately centered on the board's own field (top: board.y,
          height: board.height, both local to boardArea) rather than on root's full height the way
          the very first version of this did - boardMarginTop/insets.bottom aren't generally equal
          (see computeViewportSize/computeBoardLayout's own comments), so the screen's own vertical
          midpoint and the board's own vertical midpoint are two different points; centering on
          root would put these visibly off the wall on any device where those two insets differ.
          Same single-constraint top+height anchor faceoffZoneTop/Bottom below already use, for the
          same reason (see that comment) - mixing top+bottom here would still be exact today, but
          top+height is what stays exact if this view is ever nested somewhere its own height isn't
          implicitly root's. Filled circular chip (fg icon on a semi-opaque bg container - see
          cornerButtonBg's own comment) rather than a bare icon, so it reads as a fixture bolted to
          the wall instead of chrome floating over the ice; flush against the safe-area edge (no
          extra inset padding, default IconButton margin zeroed) to sit as close to the true screen
          edge as the notch/home-indicator allows. Both fade out together during an active drag,
          swing, or simulating shot (cornerButtonsStyle above); pointerEvents follows the same
          condition so a faded-out button can't still be tapped underneath the puck gesture layer.
          Icon rotates in place via the same cardRotationStyle the dialogs above use, applied to the
          IconButton's own style rather than the outer Animated.View - the fade/position wrapper
          stays fixed to the true screen edge, only the glyph inside turns to stay legible however
          the phone is actually being held (previously missing here, unlike Snake's/LightCycles' own
          chip buttons). */}
      <Animated.View pointerEvents={cornerButtonsVisible ? 'auto' : 'none'} style={[styles.backButton, { top: boardAreaMarginTop + board.y, height: board.height, ...(swapSides ? { right: insets.right } : { left: insets.left }) }, cornerButtonsStyle]}>
        <IconButton icon='arrow-left' iconColor={fg} containerColor={cornerButtonBg} style={[styles.chipButton, cardRotationStyle]} size={24} onPress={onBackPress} />
      </Animated.View>

      {/* Settings - mirrored on the opposite side edge, same centerline and chip treatment as the back button. swapSides also mirrors which edge each sits on for the 180° upsideDown case - see its own comment above. */}
      <Animated.View pointerEvents={cornerButtonsVisible ? 'auto' : 'none'} style={[styles.settingsButton, { top: boardAreaMarginTop + board.y, height: board.height, ...(swapSides ? { left: insets.left } : { right: insets.right }) }, cornerButtonsStyle]}>
        <IconButton icon='cog' iconColor={fg} containerColor={cornerButtonBg} style={[styles.chipButton, cardRotationStyle]} size={24} onPress={onSettingsOpen} accessibilityLabel='Settings' />
      </Animated.View>

      <SettingsDialog visible={settingsOpen} onDismiss={onSettingsDismiss} rotation={rotation} settings={settings} setSettings={setSettings} />
    </>
  )
}

const styles = StyleSheet.create({
  // top/height come from the JSX (board.y/board.height, not a fixed value here) - see the render
  // comment above for why this has to be the board's own field span, not root's full height.
  backButton: { justifyContent: 'center', position: 'absolute' },
  boardArea: { flex: 1 },
  boardAreaTouchable: { flex: 1 },
  // Pure 180°, never ±90° - see isUpsideDown's own doc comment on why a quarter turn here is a much
  // bigger, unrequested feature (it'd change the board's own aspect ratio) that this doesn't attempt.
  boardAreaUpsideDown: { transform: [{ rotate: '180deg' }] },
  // Cancels IconButton's own built-in 6px margin (react-native-paper's default Surface spacing)
  // so nothing but the safe-area inset stands between the chip and the true screen edge.
  chipButton: { margin: 0 },
  // Both anchored from `top` (not `bottom`+height for the lower one) so they resolve through the
  // exact same single-constraint layout path - mixing `bottom: 0` with a percentage `height` on an
  // absolutely-positioned view is a real, known Yoga/RN quirk (two simultaneous constraints to
  // satisfy instead of one clean anchor) and was the only structural asymmetry found anywhere
  // between the P1 (bottom) and P2 (top) tap-zone code paths after an otherwise-exhaustive review.
  faceoffZoneBottom: { height: '50%', left: 0, position: 'absolute', right: 0, top: '50%' },
  faceoffZoneTop: { height: '50%', left: 0, position: 'absolute', right: 0, top: 0 },
  // lineHeight matching height is what actually centers the glyph vertically - RN Text doesn't
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
