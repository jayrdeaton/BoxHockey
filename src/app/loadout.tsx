import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { FakeLandscapeView, getViewRotation, rotateInsets, useOrientationState } from '@tastic/core'
import { CornerActionButtons, getColorPopoverId, getCpuDifficultyPopoverId, getInlineColorPickerContentSize, getLabeledDropdownContentHeight, LABELED_DROPDOWN_POPOVER_WIDTH, MenuOption, PlayerSetupPanel, PressAwayOverlay, ReadyButton, SectionedDropdown, SharedActionBand, usePopoverHost, useZoneClampedAlign } from '@tastic/hud'
import type { Profile as BaseProfile } from '@tastic/profile'
import { DualZoneLayout, needsSharedNeutralZone, useDualZoneLayout } from '@tastic/split-screen'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch, useSelector } from 'react-redux'

import { LOADOUT_SHARED_CONTROLS_IDS, LoadoutSharedControls } from '@/components/LoadoutSharedControls'
import { SettingsDialog } from '@/components/SettingsDialog'
import { LOADOUT_PANEL_SWAP_FADE_MS } from '@/constants/game'
import { useProfiles } from '@/hooks/useProfiles'
import { useSettings } from '@/hooks/useSettings'
import { liveplayActions } from '@/redux/liveplaySlice'
import { seatColorsActions } from '@/redux/seatColorsSlice'
import { DEFAULT_SETTINGS } from '@/redux/settingsSlice'
import type { AppDispatch, RootState } from '@/redux/store'
import { BoardVariant, ControlScheme, FrictionLevel, InterceptSpeed, Player, PuckSizeLevel, ShotPreviewLength, TipoffMode } from '@/types'
import { AI_DIFFICULTY_LABELS, AIDifficulty } from '@/utils/aiOpponent'
import { BOARD_VARIANT_LABELS } from '@/utils/board'
import { humanPlayersFor, parseGameMode } from '@/utils/gameMode'
import { safeBack } from '@/utils/navigation'

const BOARD_VARIANT_DESCRIPTIONS: Record<BoardVariant, string> = {
  classic: 'Off-center holes',
  gauntlet: 'Three alternating walls',
  gravity: 'Classic walls + corner pushes'
}
const BOARD_VARIANT_OPTIONS: MenuOption<BoardVariant>[] = (['classic', 'gauntlet', 'gravity'] as BoardVariant[]).map((value) => ({ value, label: BOARD_VARIANT_LABELS[value], description: BOARD_VARIANT_DESCRIPTIONS[value] }))

// Independent of boardVariant, but rides along in the same popover as one of its rows — see
// LoadoutSharedControls' own comment. A single option rather than an on/off pair: presence in a
// one-item multi-select's value array already means "on," so there's nothing an "off" row would
// add beyond what tapping the "on" row a second time (to un-toggle it) already does.
const RINK_OPTION: MenuOption<'on'> = { value: 'on', label: 'Rink', description: 'Rounded corners + net pocket', icon: 'rounded-corner' }

const FRICTION_OPTIONS: MenuOption<FrictionLevel>[] = [
  { value: 'high', label: 'Slow', description: 'Puck stops quickly', icon: 'speedometer-slow' },
  { value: 'medium', label: 'Medium', description: 'Standard glide', icon: 'speedometer-medium' },
  { value: 'low', label: 'Fast', description: 'Puck glides farther', icon: 'speedometer' }
]

const INTERCEPT_SPEED_OPTIONS: MenuOption<InterceptSpeed>[] = [
  { value: 'low', label: 'Patient', description: 'Only once it’s nearly stopped', icon: 'timer-sand-full' },
  { value: 'medium', label: 'Alert', description: 'Jump on a slow roll', icon: 'hand-back-right-outline' },
  { value: 'high', label: 'Aggressive', description: 'Take it while it’s still gliding', icon: 'lightning-bolt' }
]

const PUCK_SIZE_OPTIONS: MenuOption<PuckSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Tighter goal & gaps', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Wider goal & gaps', icon: 'circle-outline' }
]

const SCORE_TO_WIN_OPTIONS: MenuOption<number>[] = [3, 5, 7, 10].map((value) => ({ value, label: String(value) }))

const SHOT_PREVIEW_LENGTH_OPTIONS: MenuOption<ShotPreviewLength>[] = [
  { value: 'off', label: 'Off', description: 'No trajectory preview', icon: 'eye-off-outline' },
  { value: 'short', label: 'Short', description: 'Just the aim direction', icon: 'ray-start' },
  { value: 'medium', label: 'Medium', description: 'Occasionally reveals a bank', icon: 'ray-start-end' },
  { value: 'long', label: 'Long', description: 'Shows most bank shots', icon: 'ray-start-arrow' }
]

const CONTROL_SCHEME_OPTIONS: MenuOption<ControlScheme>[] = [
  { value: 'pull', label: 'Pull', description: 'Drag back, release to fire', icon: 'arrow-collapse' },
  { value: 'push', label: 'Push', description: 'Drag toward your shot, release to fire', icon: 'arrow-expand' },
  { value: 'flick', label: 'Flick', description: 'Swipe fast — power comes from speed', icon: 'gesture-swipe' }
]

const ALL_TIPOFF_MODE_OPTIONS: MenuOption<TipoffMode>[] = [
  { value: 'coinFlip', label: 'Coin Flip', description: 'Random pick starts, loser gets the puck', icon: 'hand-coin-outline' },
  { value: 'faceoff', label: 'Face-Off', description: 'Race the tap on every score', icon: 'hockey-puck' },
  { value: 'tripleTap', label: 'Triple Tap', description: 'Two taps, then swipe to launch', icon: 'gesture-double-tap' }
]
// 'tripleTap' is touch/mobile only — no keyboard equivalent (see game.tsx), so it's hidden from the
// picker entirely on web rather than offered and left unplayable there. Computed once at module
// scope since Platform.OS never changes at runtime; also keeps handleRandomizeMatchSettings below
// from ever landing on it on web, with no separate edit needed there.
const TIPOFF_MODE_OPTIONS: MenuOption<TipoffMode>[] = Platform.OS === 'web' ? ALL_TIPOFF_MODE_OPTIONS.filter((o) => o.value !== 'tripleTap') : ALL_TIPOFF_MODE_OPTIONS

const AI_DIFFICULTY_OPTIONS: MenuOption<AIDifficulty>[] = [
  { value: 'easy', label: AI_DIFFICULTY_LABELS.easy, icon: 'emoticon-happy-outline' },
  { value: 'medium', label: AI_DIFFICULTY_LABELS.medium, icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: AI_DIFFICULTY_LABELS.hard, icon: 'emoticon-devil-outline' }
]

function pickRandom<T>(options: readonly { value: T }[]): T {
  return options[Math.floor(Math.random() * options.length)].value
}

export default function LoadoutScreen() {
  // Read only from this screen's own route param, never from useSettings().settings.gameMode
  // — the settings hook's AsyncStorage read is async, and racing it here could momentarily show
  // the wrong number of player panels.
  const params = useLocalSearchParams<{ mode: string }>()
  const gameMode = useMemo(() => parseGameMode(params.mode), [params.mode])
  const humanPlayers = useMemo(() => humanPlayersFor(gameMode), [gameMode])
  // CPU (when present at all) is always player 2 — see humanPlayersFor's own comment. Read this
  // early: the guest/CPU color plumbing below needs it before the panels themselves do.
  const p2IsHuman = humanPlayers.includes(2)

  const { settings, setSettings } = useSettings()
  const { profiles, lastSelected, updateProfile, selectProfile } = useProfiles()
  // orientationMode just follows the device's current physical tilt (see @tastic/core's
  // useOrientationState), CPU games included — how you're holding the phone right now decides the
  // panel arrangement, not a stored per-round choice. This is what lets two players sit
  // shoulder-to-shoulder and pick a color at the same time once the phone is turned sideways,
  // instead of a portrait-narrow column — and for vs-CPU, it's simply whichever way the solo player
  // is holding it. Lock Orientation (see SettingsDialog) pins it app-wide by freezing the shared
  // reading itself (OrientationProvider's freezeWhileLocked in _layout.tsx), so this read takes no
  // `locked` argument. app.json is portrait-locked at the OS level now (no more real OS rotation to
  // rely on: see @tastic/split-screen's FakeLandscapeView below, which fakes the rest entirely in
  // JS from this hook's live accelerometer reading).
  const { orientationMode, p1OnRight, upsideDown, resolved: p1OnRightResolved } = useOrientationState()

  // The panel area's own layout (which branch renders, which side each panel is on) lags one fade
  // behind the live orientationMode/p1OnRight/upsideDown above — see useDualZoneLayout's own
  // comment. Also drives the solo (vs-CPU) branch's own row below — that one doesn't rotate
  // anything, but still reorders/fades across a portrait<->landscape change the same way.
  const { panelLayout, panelFadeStyle } = useDualZoneLayout(orientationMode, p1OnRight, p1OnRightResolved, upsideDown, LOADOUT_PANEL_SWAP_FADE_MS)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // react-native-safe-area-context always reports insets relative to the device's own fixed
  // physical frame (the OS thinks the interface is still portrait-locked and never rotates, so it
  // has no idea FakeLandscapeView below is rotating the content) — rotateInsets remaps them onto
  // whichever edge they actually correspond to once visually rotated, using the same committed
  // rotation FakeLandscapeView itself renders with, so `top`/`left`/`right` below always mean the
  // screen's real, visual edges regardless of how the phone is being held.
  const rotation = getViewRotation(panelLayout.orientationMode, panelLayout.p1OnRight, panelLayout.upsideDown)
  const insets = rotateInsets(useSafeAreaInsets(), rotation)
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const { set: setThemeColor } = useThemeSettings()
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  // Typed explicitly (rather than bare useDispatch()) because @tastic/profile's action creators
  // (seatColorsActions below) return a plain `{ payload, type }` interface with no index signature,
  // which react-redux's default `useDispatch()` (typed Dispatch<UnknownAction>) rejects — same fix
  // already applied in hooks/useProfiles.tsx for this package's other action creators.
  const dispatch = useDispatch<AppDispatch>()
  // A seat's live color comes from one of three independently-remembered places depending on what's
  // currently in that seat — a selected profile's own saved color, a CPU opponent's own remembered
  // color, or (human, no profile) a guest's own remembered color — never one shared slot the way
  // this used to work, which let a profile's live color drift from its saved one and made a CPU's
  // color fight a guest's over a single remembered value. Only guestColors/cpuColor are persisted
  // here (the `seatColors` Redux slice — see redux/seatColorsSlice.ts — rehydrated by the time this
  // screen mounts, same PersistGate argument as Theme.tsx's own read of `state.theme`); a profile's
  // own saved color is never written back to (see the profile-color effect below for why, and
  // app/profiles.tsx's own ProfilesManager, the only place that's actually edited).
  const guestColors = useSelector((state: RootState) => state.seatColors.lastGuestColor)
  const cpuColor = useSelector((state: RootState) => state.seatColors.lastCpuColor)
  // A manual recolor/clash-swap landing on a seat that has a profile selected — see
  // redux/seatColorsSlice.ts's own doc comment. Persisted (survives navigation and relaunch), only
  // cleared when that seat's own selection genuinely changes (handleP1ProfileSelect/
  // handleP2ProfileSelect below), never by merely leaving and returning to this screen.
  const profileOverride = useSelector((state: RootState) => state.seatColors.profileOverride)

  const p1Profile = profiles.find((p) => p.id === lastSelected[1]) ?? null
  const p2Profile = p2IsHuman ? (profiles.find((p) => p.id === lastSelected[2]) ?? null) : null

  // Kept in sync via their own trivial effects (never read during render, only written — a plain
  // render-body assignment trips this project's react-hooks/refs lint rule) purely so the
  // focus-reset effect below can read each seat's CURRENT resolved profile / persisted guest /
  // persisted CPU / persisted override color without listing profiles/guestColors/cpuColor/
  // profileOverride themselves as its own dependencies — profiles is a brand new array from
  // useProfiles() on every one of its own re-renders, and depending on any of these reactively
  // there would re-fire that effect (see useFocusEffect's own re-run semantics: it re-invokes its
  // callback immediately, while still focused, whenever the callback's identity changes) merely
  // because one of them changed while this screen stays continuously focused.
  const p1ProfileRef = useRef(p1Profile)
  const p2ProfileRef = useRef(p2Profile)
  const guestColorsRef = useRef(guestColors)
  const cpuColorRef = useRef(cpuColor)
  const profileOverrideRef = useRef(profileOverride)
  useEffect(() => {
    p1ProfileRef.current = p1Profile
  }, [p1Profile])
  useEffect(() => {
    p2ProfileRef.current = p2Profile
  }, [p2Profile])
  useEffect(() => {
    guestColorsRef.current = guestColors
  }, [guestColors])
  useEffect(() => {
    cpuColorRef.current = cpuColor
  }, [cpuColor])
  useEffect(() => {
    profileOverrideRef.current = profileOverride
  }, [profileOverride])

  // Keeps each seat's live theme color matching what it's actually supposed to be right now.
  // Mount-time and reactive only (lastSelected changing from something *outside* this screen's own
  // pickers — e.g. deleting the currently-selected profile from Manage — and the profiles roster
  // itself resolving) — a fresh tap-select is instead applied immediately by
  // handleP1ProfileSelect/handleP2ProfileSelect below, which both know the newly-picked profile
  // directly and don't need to wait on lastSelected to round-trip back through here. Deliberately
  // does NOT run on every render (profiles is a brand new array from useProfiles() on every one of
  // its own re-renders, so it's read here, not depended on — profiles.length stands in as a coarse
  // "profiles finished loading" signal instead).
  useEffect(() => {
    const nextP1 = p1Profile ? (profileOverride[1] ?? p1Profile.color) : guestColors[1]
    const nextP2 = p2Profile ? (profileOverride[2] ?? p2Profile.color) : p2IsHuman ? guestColors[2] : cpuColor
    if (nextP1.toLowerCase() === p1Color.toLowerCase() && nextP2.toLowerCase() === p2Color.toLowerCase()) return
    setThemeColor({ color: { primary: nextP1, secondary: nextP2, tertiary: getThirdColor(nextP1, nextP2) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelected[1], lastSelected[2], p2IsHuman, guestColors, cpuColor, profileOverride, profiles.length])

  // /loadout pushes /game and /profiles on top of itself and returns to this same screen via
  // router.back()/safeBack() — a pop that reveals this SAME, still-mounted instance rather than a
  // fresh mount (see the `ready`-reset useFocusEffect below, which exists for the same reason). On
  // every genuine focus regain — initial mount, and returning here from /game or /profiles —
  // re-derive each seat's live color from its authoritative source (profile / guest / CPU, honoring
  // any active override — see redux/seatColorsSlice.ts), so editing a profile's own saved color via
  // /profiles is picked up the instant you're back, the same way it already was before overrides
  // were persisted.
  //
  // Deliberately triggers on lastSelected[seat]/p2IsHuman only — the same "a real reason to reapply
  // this seat's color" identity the reactive effect above keys its own reapplication on — and reads
  // profiles/guestColors/cpuColor/profileOverride through the refs above instead of depending on
  // them directly. useFocusEffect re-invokes this callback immediately, while still focused,
  // whenever the callback's own identity changes (not just on an actual focus/blur transition) — so
  // listing guestColors/cpuColor/profiles/profileOverride here directly would reapply on every one
  // of their changes even with no real navigation event.
  useFocusEffect(
    useCallback(() => {
      const guest = guestColorsRef.current
      const cpu = cpuColorRef.current
      const p1Prof = p1ProfileRef.current
      const p2Prof = p2ProfileRef.current
      const override = profileOverrideRef.current
      const nextP1 = p1Prof ? (override[1] ?? p1Prof.color) : guest[1]
      const nextP2 = p2Prof ? (override[2] ?? p2Prof.color) : p2IsHuman ? guest[2] : cpu
      setThemeColor({ color: { primary: nextP1, secondary: nextP2, tertiary: getThirdColor(nextP1, nextP2) } })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSelected[1], lastSelected[2], p2IsHuman, setThemeColor])
  )

  // Routes a seat's own just-changed color to whichever slot actually owns it right now — persists
  // it as this seat's own profile override instead when a profile's selected there (see
  // redux/seatColorsSlice.ts), so the profile-color effect leaves it alone until this seat's
  // selection itself changes.
  const persistSeatColor = useCallback(
    (seat: Player, hex: string) => {
      if (seat === 1 ? p1Profile : p2Profile) {
        dispatch(seatColorsActions.setProfileOverride({ seat, color: hex }))
        return
      }
      if (seat === 2 && !p2IsHuman) {
        dispatch(seatColorsActions.setLastCpuColor(hex))
        return
      }
      dispatch(seatColorsActions.setLastGuestColor({ seat, color: hex }))
    },
    [p1Profile, p2Profile, p2IsHuman, dispatch]
  )

  // Picking the other slot's exact current color swaps the two instead of no-op'ing — only
  // reachable at all when that slot's own picker allowed it (allowSwapTaken: vs-CPU only, where
  // the "other" color there is only ever the CPU's, not a second real person's choice). Each side of
  // a swap persists independently per its own seat rule above — a swap into a profile-selected seat
  // is transient there even though the CPU/guest side it came from persists normally.
  const handleP1ColorChange = useCallback(
    (hex: string) => {
      const swapped = hex.toLowerCase() === p2Color.toLowerCase()
      const nextP2 = swapped ? p1Color : p2Color
      setThemeColor({ color: { primary: hex, secondary: nextP2, tertiary: getThirdColor(hex, nextP2) } })
      persistSeatColor(1, hex)
      if (swapped) persistSeatColor(2, nextP2)
    },
    [setThemeColor, p1Color, p2Color, persistSeatColor]
  )
  const handleP2ColorChange = useCallback(
    (hex: string) => {
      const swapped = hex.toLowerCase() === p1Color.toLowerCase()
      const nextP1 = swapped ? p2Color : p1Color
      setThemeColor({ color: { primary: nextP1, secondary: hex, tertiary: getThirdColor(nextP1, hex) } })
      persistSeatColor(2, hex)
      if (swapped) persistSeatColor(1, nextP1)
    },
    [setThemeColor, p1Color, p2Color, persistSeatColor]
  )

  // Applies a freshly-picked profile's own color immediately, rather than waiting for lastSelected
  // to round-trip back through the profile-color effect above — that effect only reacts to
  // lastSelected actually *changing*, so tapping the already-selected profile again (the other way
  // this is supposed to snap back to its saved color — see redux/seatColorsSlice.ts's own
  // profileOverride doc) wouldn't otherwise register. Clears this seat's own persisted override
  // first so a swap/manual recolor made under the previous selection can't leak into the new one.
  // Typed against @tastic/profile's own base Profile, not this app's own extended one (@/types'
  // Profile, which adds controlScheme) — @tastic/hud's PlayerSetupPanel.onProfileSelect is typed
  // against the base shape, and neither handler reads anything beyond .id/.color anyway, so there's
  // no real need for the extension here.
  const handleP1ProfileSelect = useCallback(
    (profile: BaseProfile | null) => {
      dispatch(seatColorsActions.setProfileOverride({ seat: 1, color: null }))
      selectProfile(1, profile?.id ?? null)
      const hex = profile ? profile.color : guestColors[1]
      if (hex) setThemeColor({ color: { primary: hex, secondary: p2Color, tertiary: getThirdColor(hex, p2Color) } })
    },
    [dispatch, selectProfile, guestColors, p2Color, setThemeColor]
  )
  const handleP2ProfileSelect = useCallback(
    (profile: BaseProfile | null) => {
      dispatch(seatColorsActions.setProfileOverride({ seat: 2, color: null }))
      selectProfile(2, profile?.id ?? null)
      const hex = profile ? profile.color : guestColors[2]
      if (hex) setThemeColor({ color: { primary: p1Color, secondary: hex, tertiary: getThirdColor(p1Color, hex) } })
    },
    [dispatch, selectProfile, guestColors, p1Color, setThemeColor]
  )

  // Unlike color above, this one *does* keep syncing back to a currently-selected profile's own
  // saved control scheme for as long as it stays selected: control scheme has no "freely override it
  // for one match" use case the way a paddle's color does. No swap-on-conflict needed here (unlike
  // LightCycles' identically-shaped keyScheme handler) — pull/push isn't a shared physical resource
  // the way a keyboard's WASD/arrow clusters are, so both players can happily use the same scheme at
  // once.
  const handleP1ControlSchemeChange = useCallback(
    (value: ControlScheme) => {
      setSettings({ controlScheme: { ...settings.controlScheme, 1: value } })
      if (lastSelected[1]) updateProfile(lastSelected[1], { controlScheme: value })
    },
    [setSettings, settings.controlScheme, lastSelected, updateProfile]
  )
  const handleP2ControlSchemeChange = useCallback(
    (value: ControlScheme) => {
      setSettings({ controlScheme: { ...settings.controlScheme, 2: value } })
      if (lastSelected[2]) updateProfile(lastSelected[2], { controlScheme: value })
    },
    [setSettings, settings.controlScheme, lastSelected, updateProfile]
  )

  // Covers exactly the fields LoadoutSharedControls itself exposes — board shape, puck physics,
  // match rules, and (vs-CPU only) AI difficulty, since that picker also lives in this shared row
  // rather than a per-player panel the way LightCycles' cpuDifficulty does. Per-player stuff
  // (colors, control scheme) and app-wide prefs (lock orientation) live outside this row and aren't
  // "match settings" in the sense a player means when they ask to shuffle or reset the current
  // round.
  const handleRandomizeMatchSettings = useCallback(() => {
    setSettings({
      boardVariant: pickRandom(BOARD_VARIANT_OPTIONS),
      rink: Math.random() < 0.5,
      friction: pickRandom(FRICTION_OPTIONS),
      puckSize: pickRandom(PUCK_SIZE_OPTIONS),
      interceptSpeed: pickRandom(INTERCEPT_SPEED_OPTIONS),
      scoreToWin: pickRandom(SCORE_TO_WIN_OPTIONS),
      shotPreviewLength: pickRandom(SHOT_PREVIEW_LENGTH_OPTIONS),
      tipoffMode: pickRandom(TIPOFF_MODE_OPTIONS),
      ...(gameMode === 'vsCpu' ? { aiDifficulty: pickRandom(AI_DIFFICULTY_OPTIONS) } : {})
    })
  }, [setSettings, gameMode])

  const handleResetMatchSettings = useCallback(() => {
    setSettings({
      boardVariant: DEFAULT_SETTINGS.boardVariant,
      rink: DEFAULT_SETTINGS.rink,
      friction: DEFAULT_SETTINGS.friction,
      puckSize: DEFAULT_SETTINGS.puckSize,
      interceptSpeed: DEFAULT_SETTINGS.interceptSpeed,
      scoreToWin: DEFAULT_SETTINGS.scoreToWin,
      shotPreviewLength: DEFAULT_SETTINGS.shotPreviewLength,
      tipoffMode: DEFAULT_SETTINGS.tipoffMode,
      ...(gameMode === 'vsCpu' ? { aiDifficulty: DEFAULT_SETTINGS.aiDifficulty } : {})
    })
  }, [setSettings, gameMode])

  const [ready, setReady] = useState<Record<Player, boolean>>({ 1: false, 2: false })

  // Every time this screen (re)gains focus — first arrival from the title screen, or coming back
  // here via the post-game "Loadout" button — Ready starts false again. Without this, popping back
  // to an already-mounted loadout whose players both left it Ready would immediately re-trigger the
  // all-ready effect below and bounce straight back into /game.
  useFocusEffect(
    useCallback(() => {
      setReady({ 1: false, 2: false })
    }, [])
  )

  // Read through a ref rather than listed as a dependency of the effect below: this screen stays
  // mounted (and still all Ready) under /game, so a settings change made there (toggling Lock
  // Orientation or Edge Guard in /game's Settings dialog, or the lock recording its angle) would
  // otherwise re-run that effect and push a second /game.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!humanPlayers.every((p) => ready[p])) return
    // `gameMode` (this screen's own route param), not settings.gameMode: the route param is the mode
    // this loadout was opened for.
    dispatch(liveplayActions.setActiveRoundSettings({ ...settingsRef.current, gameMode }))
    router.push('/game')
  }, [ready, humanPlayers, gameMode, dispatch])

  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  const isPortrait = panelLayout.orientationMode === 'faceToFace'
  // See @tastic/split-screen's needsSharedNeutralZone for the full reasoning — extracted there
  // once this exact boolean turned up independently hand-duplicated across LightCycles/AirHockey/
  // Snake too.
  const showMetaInSharedBand = needsSharedNeutralZone(panelLayout.orientationMode, humanPlayers.length)

  // Where P2's own press-away zone lives on screen — matches panelLayout (the already-committed,
  // currently-painted layout), not the live orientationMode/p1OnRight, since it needs to agree with
  // whichever arrangement is actually on screen right now, mid-fade included. Portrait always
  // renders P2's panel in the top half (see DualZoneLayout below); landscape puts it on whichever
  // side panelLayout.p1OnRight says isn't P1's. Only meaningful in two-player mode — vsCpu's P2/CPU
  // slot shares controlsHost instead (see p2Host below), so it never needs a zone of its own.
  const p2ZoneStyle = gameMode === 'twoPlayer' ? (isPortrait ? styles.p2ZoneTop : panelLayout.p1OnRight ? styles.p2ZoneLeft : styles.p2ZoneRight) : null

  // Vs-CPU only has one human slot, so its Ready toggle renders standalone below both panels
  // instead of embedded in this panel.
  const showReadyButton = gameMode === 'twoPlayer'
  // P1's own panel and the shared controls row always share one host — mutually exclusive
  // regardless of game mode, since both sit in the same near/bottom zone. Vs-CPU additionally
  // folds P2/CPU's panel into this same host: only one human is ever driving both slots there, so
  // having both YOU's and CPU's popovers open at once is just clutter. Two-player mode keeps P2 on
  // its own independent host, since two real people editing at once is the whole point there —
  // lobby.tsx (rather than PlayerSetupPanel's own internal fallback) owns it explicitly so the
  // press-away zones below can close it without a P1-side tap ever reaching into P2's own popover,
  // or vice versa.
  const controlsHost = usePopoverHost()
  const p2PanelHost = usePopoverHost()
  const p2Host = gameMode === 'vsCpu' ? controlsHost : p2PanelHost
  // Vs-CPU's own standalone Ready button (below, not per-panel — see showReadyButton) is centered
  // under the whole row, not under either player's own trigger, so it doesn't share a center with
  // an open popover the way a two-player panel's *embedded* Ready button does. A side player's
  // popover is centered on that player's own (off-center) trigger instead, so it can't fully cover
  // the wider gap between its edge and the standalone button's — leaving a sliver of the button's
  // own border peeking out from beside/behind the popover. Faded out instead while any player's
  // popover is open, rather than trying to reconcile the two different centers.
  const anyPlayerPickerOpen = !!(controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-'))

  // Orientation is derived live from how the phone is held (see useDeviceOrientation) now, not a
  // per-round choice here — this row no longer takes orientationMode/orientationModeOptions/
  // onOrientationModeChange at all.
  const sharedControlsRow = (
    <LoadoutSharedControls
      host={controlsHost}
      rotation={rotation}
      boardVariant={settings.boardVariant}
      boardVariantOptions={BOARD_VARIANT_OPTIONS}
      onBoardVariantChange={(value) => setSettings({ boardVariant: value })}
      rink={settings.rink}
      rinkOption={RINK_OPTION}
      onRinkChange={(value) => setSettings({ rink: value })}
      friction={settings.friction}
      frictionOptions={FRICTION_OPTIONS}
      onFrictionChange={(value) => setSettings({ friction: value })}
      interceptSpeed={settings.interceptSpeed}
      interceptSpeedOptions={INTERCEPT_SPEED_OPTIONS}
      onInterceptSpeedChange={(value) => setSettings({ interceptSpeed: value })}
      puckSize={settings.puckSize}
      puckSizeOptions={PUCK_SIZE_OPTIONS}
      onPuckSizeChange={(value) => setSettings({ puckSize: value })}
      scoreToWin={settings.scoreToWin}
      scoreToWinOptions={SCORE_TO_WIN_OPTIONS}
      onScoreToWinChange={(value) => setSettings({ scoreToWin: value })}
      shotPreviewLength={settings.shotPreviewLength}
      shotPreviewLengthOptions={SHOT_PREVIEW_LENGTH_OPTIONS}
      onShotPreviewLengthChange={(value) => setSettings({ shotPreviewLength: value })}
      tipoffMode={settings.tipoffMode}
      tipoffModeOptions={TIPOFF_MODE_OPTIONS}
      onTipoffModeChange={(value) => setSettings({ tipoffMode: value })}
      // Omitted (leaving LoadoutSharedControls' own actionsRow unrendered) whenever
      // showMetaInSharedBand is about to fold randomize/reset into its own merged header row below
      // instead — otherwise both would render at once.
      onRandomize={showMetaInSharedBand ? undefined : handleRandomizeMatchSettings}
      onReset={showMetaInSharedBand ? undefined : handleResetMatchSettings}
      accentColor={themeColors.tertiary}
      mutedColor={fgMuted}
      onAccentColor={themeColors.onTertiary}
      dark={dark}
    />
  )

  // Only wrapped for showMetaInSharedBand (see its own comment above) — everywhere else back/
  // settings stay in their usual top corners (CornerActionButtons below) and randomize/reset stay
  // in LoadoutSharedControls' own row above the trigger gauges. SharedActionBand owns the "is the
  // open popover actually one of mine" self-elevation check internally, given just the resolved
  // boolean below.
  const sharedControlsPopoverOpen = controlsHost.openId !== null && LOADOUT_SHARED_CONTROLS_IDS.includes(controlsHost.openId)
  const sharedControls = showMetaInSharedBand ? (
    <SharedActionBand onBack={safeBack} onSettings={() => setSettingsOpen(true)} onRandomize={handleRandomizeMatchSettings} onReset={handleResetMatchSettings} fg={fg} popoverOpen={sharedControlsPopoverOpen}>
      {sharedControlsRow}
    </SharedActionBand>
  ) : (
    sharedControlsRow
  )

  // Always 'P1'/'P2', regardless of game mode — see ProfilePicker's own doc for why the trigger uses
  // this instead of "Player" (Player stays as the menu's own row, just not the idle label — using
  // the same word for both would make it impossible to tell "nothing selected yet" from "Player
  // deliberately selected" at a glance).
  // Pull/push "feel" preference, human slots only (a CPU has no finger on the glass to have a
  // "feel" about — see useAIOpponent.ts, which cancels this setting's sign back out regardless of
  // what it's set to, so it's invisible to the CPU either way). PlayerSetupPanel itself has no
  // opinion on this concept (see its own `secondPicker` doc) — this app constructs the same
  // SectionedDropdown it always has and hands it in directly, sharing whichever host that panel's
  // own `host` prop below resolves to so its popover keeps participating in the same
  // open/elevate/press-away plumbing as the color picker beside it.
  const p1ControlSchemePicker = <SectionedDropdown id='p1-controlScheme' host={controlsHost} icon='arrow-collapse' accessibilityLabel='Controls' sections={[{ kind: 'single', id: 'controlScheme', options: CONTROL_SCHEME_OPTIONS, value: settings.controlScheme[1], onChange: handleP1ControlSchemeChange }]} accentColor={themeColors.tertiary} mutedColor={fgMuted} dark={dark} />
  // Both panels render inside a live @tastic/split-screen zone in two-player mode (unlike the
  // cpuDifficulty picker below, which only ever renders outside one — see its own comment), so the
  // color picker's popover can overflow past the zone's own shared-row boundary into the other
  // player's half unless clamped the same way. Every seat (p1, and p2 whether human or CPU) always
  // has a color picker — unlike cpuDifficultyAlignOverride, this is computed and passed
  // unconditionally for both panels, never gated behind isHuman/p2IsHuman. Both panels pass the same
  // swatches={defaultColors}, so their content size is identical and computed once here.
  const { width: windowWidth } = useWindowDimensions()
  const colorContentSize = getInlineColorPickerContentSize(defaultColors.length, windowWidth)
  const p1ColorOpen = controlsHost.openId === getColorPopoverId('p1')
  const p1ColorAlignOverride = useZoneClampedAlign(p1ColorOpen, colorContentSize.width, colorContentSize.height)
  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} colorAlignOverride={p1ColorAlignOverride} isHuman ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} secondPicker={p1ControlSchemePicker} secondPickerId='p1-controlScheme' profiles={profiles} selectedProfileId={lastSelected[1]} takenProfileId={p2IsHuman ? lastSelected[2] : null} guestLabel='P1' onProfileSelect={handleP1ProfileSelect} onManageProfiles={() => router.push('/profiles')} />
  // CPU slot (vsCpu, !p2IsHuman) gets no second picker at all — matches the old isHuman-gated
  // showControlScheme check that used to live inside PlayerSetupPanel itself.
  const p2ControlSchemePicker = p2IsHuman ? <SectionedDropdown id='p2-controlScheme' host={p2Host} icon='arrow-collapse' accessibilityLabel='Controls' sections={[{ kind: 'single', id: 'controlScheme', options: CONTROL_SCHEME_OPTIONS, value: settings.controlScheme[2], onChange: handleP2ControlSchemeChange }]} accentColor={themeColors.tertiary} mutedColor={fgMuted} dark={dark} /> : undefined
  // cpuDifficulty only ever renders for a non-human seat 2, which only exists in vsCpu mode, and
  // vsCpu always renders through the plain stacked (non-DualZoneLayout) branch below (gameMode ===
  // 'twoPlayer' ? <DualZoneLayout .../> : <View style={styles.stackedZone}>...) — never inside a
  // @tastic/split-screen zone. So useZoneBounds() is null here and useZoneClampedAlign is a
  // documented no-op, falling straight back to useAutoAlign's own plain screen-edge placement —
  // same conclusion LightCycles' own lobby.tsx already reached for its equivalent p2Panel, before
  // @tastic/hud had an alignOverride pass-through for this picker at all. Wired in anyway per
  // @tastic/hud@0.9.0's new cpuDifficultyAlignOverride prop: it costs nothing while inert, and if
  // vsCpu's stacked layout is ever nested inside a zone later this starts clamping for free instead
  // of silently staying stale.
  const p2CpuDifficultyOpen = p2Host.openId === getCpuDifficultyPopoverId('p2')
  const p2CpuDifficultyAlignOverride = useZoneClampedAlign(p2CpuDifficultyOpen, LABELED_DROPDOWN_POPOVER_WIDTH, getLabeledDropdownContentHeight(AI_DIFFICULTY_OPTIONS.length))
  const p2ColorOpen = p2Host.openId === getColorPopoverId('p2')
  const p2ColorAlignOverride = useZoneClampedAlign(p2ColorOpen, colorContentSize.width, colorContentSize.height)
  const p2Panel = (
    <PlayerSetupPanel
      idPrefix='p2'
      host={p2Host}
      color={p2Color}
      onColorChange={handleP2ColorChange}
      swatches={defaultColors}
      takenColor={p1Color}
      allowSwapTaken={gameMode === 'vsCpu'}
      colorAlignOverride={p2ColorAlignOverride}
      isHuman={p2IsHuman}
      ready={p2IsHuman ? ready[2] : undefined}
      onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined}
      dark={dark}
      showReadyButton={showReadyButton}
      secondPicker={p2ControlSchemePicker}
      secondPickerId={p2IsHuman ? 'p2-controlScheme' : undefined}
      profiles={p2IsHuman ? profiles : undefined}
      selectedProfileId={lastSelected[2]}
      takenProfileId={lastSelected[1]}
      guestLabel='P2'
      onProfileSelect={p2IsHuman ? handleP2ProfileSelect : undefined}
      cpuDifficulty={p2IsHuman ? undefined : settings.aiDifficulty}
      cpuDifficultyOptions={p2IsHuman ? undefined : AI_DIFFICULTY_OPTIONS}
      onCpuDifficultyChange={p2IsHuman ? undefined : (value: AIDifficulty) => setSettings({ aiDifficulty: value })}
      cpuDifficultyAlignOverride={p2IsHuman ? undefined : p2CpuDifficultyAlignOverride}
    />
  )

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Everything below reads correctly no matter which way the phone is actually being held —
      see @tastic/split-screen's FakeLandscapeView for why this is needed at all now that the app is
      portrait-locked at the OS level (no more real OS rotation to rely on). Driven by panelLayout
      (the same committed, already-fade-masked state DualZoneLayout itself renders from), not the
      live orientationMode/p1OnRight/upsideDown above, so the visual rotation change and the panel
      swap/reorder always land in the same fade-covered moment instead of one snapping ahead of the
      other. SettingsDialog is deliberately left outside this wrapper — it renders as a centered
      modal overlay via Portal, unaffected by (and not needing) this transform. */}
      <FakeLandscapeView orientationMode={panelLayout.orientationMode} p1OnRight={panelLayout.p1OnRight} upsideDown={panelLayout.upsideDown} style={styles.rotatable}>
        {/* Press-away overlays for the loadout screen's own popovers (color pickers, control
        dropdowns) — see PressAwayOverlay's own comment for the paint-order trick that keeps real
        controls directly tappable. P1's covers the whole screen (their own panel plus every shared
        setting reads as "theirs" — see LoadoutSharedControls), while P2's is scoped to just their
        own half (p2ZoneStyle) and, being a later sibling, takes priority over P1's within that rect.

        P2's overlay has to mount whenever *either* host has something open, not just p2Host — P1's
        popover being open is exactly when P1's full-screen overlay is sitting underneath P2's zone
        too, and if P2's own overlay were absent then (p2Host closed), a tap anywhere on P2's side
        would fall straight through to P1's and close P1's dialog. Mounting it any time controlsHost
        is open too — even though its own onPress (p2Host.close) is then a no-op — makes it "shield"
        P2's zone from P1's overlay unconditionally, which is what actually keeps P2's side exempt
        from P1's press-away regardless of whether P2 has anything open. */}
        <PressAwayOverlay active={controlsHost.openId !== null} onPress={controlsHost.close} />
        {p2ZoneStyle && <PressAwayOverlay active={controlsHost.openId !== null || p2Host.openId !== null} onPress={p2Host.close} style={p2ZoneStyle} />}

        {!showMetaInSharedBand && <CornerActionButtons onBack={safeBack} onSettings={() => setSettingsOpen(true)} fg={fg} insets={insets} />}

        {gameMode === 'twoPlayer' ? (
          // See @tastic/split-screen's DualZoneLayout for the portrait-vs-landscape switch and its
          // own note on why P1's zone stays unrotated while P2's rotates 180° in portrait.
          <DualZoneLayout
            panelLayout={panelLayout}
            panelFadeStyle={panelFadeStyle}
            p1={p1Panel}
            p2={p2Panel}
            shared={sharedControls}
            // Without these, a popover escaping its own zone (e.g. one of the shared row's own
            // dropdowns growing down into P1/P2's row below it) paints underneath whichever zone
            // happens to be the later DOM sibling, regardless of which one actually has something
            // open — see DualZoneLayout's own p1Elevated/p2Elevated/sharedElevated doc for the
            // stacking-context reason a zone can't just self-elevate the way
            // PlayerSetupPanel/LoadoutSharedControls already do internally. Same openId checks those
            // two components use for their own internal elevation, just re-run here for the outer
            // zone wrapper neither of them can reach on its own.
            p1Elevated={controlsHost.openId?.startsWith('p1-') ?? false}
            p2Elevated={p2Host.openId !== null}
            sharedElevated={sharedControlsPopoverOpen}
          />
        ) : (
          <View style={styles.stackedZone}>
            {sharedControls}
            <Animated.View style={[styles.playersRow, anyPlayerPickerOpen && styles.playersRowOpen, panelFadeStyle]}>
              {!isPortrait && panelLayout.p1OnRight ? p2Panel : p1Panel}
              {!isPortrait && panelLayout.p1OnRight ? p1Panel : p2Panel}
            </Animated.View>
            <ReadyButton color={p1Color} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} style={anyPlayerPickerOpen && styles.readyButtonHidden} />
          </View>
        )}
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotation} settings={settings} setSettings={setSettings} showHowToPlay />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  p2ZoneLeft: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: '50%'
  },
  p2ZoneRight: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '50%'
  },
  p2ZoneTop: {
    height: '50%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  // Only used by vsCpu's stacked (non-rotated) layout below — two-player's own DualZoneLayout
  // handles p1/p2 spacing itself. Matches PlayerSetupPanel's own pickerRow gap (12), not some
  // wider "these are two separate panels" gap — vsCpu's human slot (color + control scheme) and
  // CPU slot (color only) read as one evenly spaced row of triggers this way, rather than two
  // independently-centered blocks whose different widths throw off screen-edge symmetry.
  playersRow: {
    flexDirection: 'row',
    gap: 12
  },
  playersRowOpen: {
    zIndex: 100
  },
  // See anyPlayerPickerOpen above — opacity 0 (not display:'none') so the button keeps its layout
  // space and doesn't shift the row above it when it disappears/reappears. pointerEvents:'none' too
  // — otherwise the sliver an open popover doesn't cover would still be a live, just-invisible tap
  // target underneath it.
  readyButtonHidden: {
    opacity: 0,
    pointerEvents: 'none'
  },
  // Owns the flex-centering layout `container` used to apply directly — now one level deeper, since
  // everything visible sits inside FakeLandscapeView, which needs a real (not shrink-wrapped)
  // full-bleed box to size its own absolutely-positioned children (PressAwayOverlay, back/settings
  // buttons) against correctly.
  rotatable: {
    alignItems: 'center',
    flex: 1,
    gap: 32,
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  stackedZone: {
    alignItems: 'center',
    gap: 28
  }
})
