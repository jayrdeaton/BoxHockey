import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { IconButton } from '@rific/feedback-press'
import { MenuOption, PressAwayOverlay, ReadyButton, usePopoverHost } from '@tastic/hud'
import { DualZoneLayout, useDeviceOrientation, useDualZoneLayout, useOrientationLock, useP1OnRight } from '@tastic/split-screen'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LoadoutSharedControls } from '@/components/LoadoutSharedControls'
import { PlayerSetupPanel } from '@/components/PlayerSetupPanel'
import { SettingsDialog } from '@/components/SettingsDialog'
import { LOADOUT_PANEL_SWAP_FADE_MS } from '@/constants/game'
import { useGameSettings } from '@/hooks/useGameSettings'
import { BoardVariant, ControlScheme, FrictionLevel, Player, PuckSizeLevel, ShotPreviewLength, TipoffMode } from '@/types'
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
  { value: 'push', label: 'Push', description: 'Swipe toward your shot', icon: 'gesture-swipe' }
]

const TIPOFF_MODE_OPTIONS: MenuOption<TipoffMode>[] = [
  { value: 'coinFlip', label: 'Coin Flip', description: 'Random pick starts, loser gets the puck', icon: 'hand-coin-outline' },
  { value: 'faceoff', label: 'Face-Off', description: 'Race the tap on every score', icon: 'hockey-puck' }
]

const AI_DIFFICULTY_OPTIONS: MenuOption<AIDifficulty>[] = [
  { value: 'easy', label: AI_DIFFICULTY_LABELS.easy, icon: 'emoticon-happy-outline' },
  { value: 'medium', label: AI_DIFFICULTY_LABELS.medium, icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: AI_DIFFICULTY_LABELS.hard, icon: 'emoticon-devil-outline' }
]

export default function LoadoutScreen() {
  // Read only from this screen's own route param, never from useGameSettings().settings.gameMode
  // — the settings hook's AsyncStorage read is async, and racing it here could momentarily show
  // the wrong number of player panels.
  const params = useLocalSearchParams<{ mode: string }>()
  const gameMode = useMemo(() => parseGameMode(params.mode), [params.mode])
  const humanPlayers = useMemo(() => humanPlayersFor(gameMode), [gameMode])

  const { settings, setSettings, commitRoundSettings } = useGameSettings()
  // orientationMode just follows the device's current physical shape (see useDeviceOrientation),
  // CPU games included — how you're holding the phone right now decides the panel arrangement,
  // not a stored per-round choice. This is what lets two players sit shoulder-to-shoulder and pick
  // a color at the same time once the phone is turned sideways, instead of a portrait-narrow
  // column — and for vs-CPU, it's simply whichever way the solo player is holding it. Lock
  // Orientation (see SettingsDialog) is the opt-in for pinning it.
  const orientationMode = useDeviceOrientation()
  useOrientationLock(settings.lockOrientation, orientationMode)
  const { p1OnRight, resolved: p1OnRightResolved } = useP1OnRight()

  // The panel area's own layout (which branch renders, which side each panel is on) lags one fade
  // behind the live orientationMode/p1OnRight above — see useDualZoneLayout's own comment. Also
  // drives the solo (vs-CPU) branch's own row below — that one doesn't rotate anything, but still
  // reorders/fades across a portrait<->landscape change the same way.
  const { panelLayout, panelFadeStyle } = useDualZoneLayout(orientationMode, p1OnRight, p1OnRightResolved, LOADOUT_PANEL_SWAP_FADE_MS)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const { set: setThemeColor } = useThemeSettings()
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  // Picking the other slot's exact current color swaps the two instead of no-op'ing — only
  // reachable at all when that slot's own picker allowed it (allowSwapTaken: vs-CPU only, where
  // the "other" color there is only ever the CPU's, not a second real person's choice).
  const handleP1ColorChange = useCallback(
    (hex: string) => {
      const nextP2 = hex.toLowerCase() === p2Color.toLowerCase() ? p1Color : p2Color
      setThemeColor({ color: { primary: hex, secondary: nextP2, tertiary: getThirdColor(hex, nextP2) } })
    },
    [setThemeColor, p1Color, p2Color]
  )
  const handleP2ColorChange = useCallback(
    (hex: string) => {
      const nextP1 = hex.toLowerCase() === p1Color.toLowerCase() ? p2Color : p1Color
      setThemeColor({ color: { primary: nextP1, secondary: hex, tertiary: getThirdColor(nextP1, hex) } })
    },
    [setThemeColor, p1Color, p2Color]
  )

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

  useEffect(() => {
    if (!humanPlayers.every((p) => ready[p])) return
    // `gameMode` here, not `settings.gameMode` — same race the comment above guards against: this
    // screen's own route param is the trustworthy value, not the settings hook's own (possibly
    // still-loading) copy.
    commitRoundSettings({ ...settings, gameMode })
    router.push('/game')
  }, [ready, humanPlayers, settings, gameMode, commitRoundSettings])

  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  const p2IsHuman = humanPlayers.includes(2)
  const isPortrait = panelLayout.orientationMode === 'faceToFace'

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
  const sharedControls = (
    <LoadoutSharedControls
      host={controlsHost}
      boardVariant={settings.boardVariant}
      boardVariantOptions={BOARD_VARIANT_OPTIONS}
      onBoardVariantChange={(value) => setSettings({ boardVariant: value })}
      rink={settings.rink}
      rinkOption={RINK_OPTION}
      onRinkChange={(value) => setSettings({ rink: value })}
      friction={settings.friction}
      frictionOptions={FRICTION_OPTIONS}
      onFrictionChange={(value) => setSettings({ friction: value })}
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
      aiDifficulty={gameMode === 'vsCpu' ? settings.aiDifficulty : undefined}
      aiDifficultyOptions={gameMode === 'vsCpu' ? AI_DIFFICULTY_OPTIONS : undefined}
      onAiDifficultyChange={gameMode === 'vsCpu' ? (value) => setSettings({ aiDifficulty: value }) : undefined}
      accentColor={themeColors.tertiary}
      mutedColor={fgMuted}
      onAccentColor={themeColors.onTertiary}
      dark={dark}
    />
  )

  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} controlScheme={settings.controlScheme[1]} controlSchemeOptions={CONTROL_SCHEME_OPTIONS} onControlSchemeChange={(value) => setSettings({ controlScheme: { ...settings.controlScheme, 1: value } })} accentColor={themeColors.tertiary} mutedColor={fgMuted} />
  const p2Panel = <PlayerSetupPanel idPrefix='p2' host={p2Host} color={p2Color} onColorChange={handleP2ColorChange} swatches={defaultColors} takenColor={p1Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman={p2IsHuman} ready={p2IsHuman ? ready[2] : undefined} onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined} dark={dark} showReadyButton={showReadyButton} controlScheme={settings.controlScheme[2]} controlSchemeOptions={CONTROL_SCHEME_OPTIONS} onControlSchemeChange={(value) => setSettings({ controlScheme: { ...settings.controlScheme, 2: value } })} accentColor={themeColors.tertiary} mutedColor={fgMuted} />

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
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

      <IconButton icon='arrow-left' iconColor={fg} size={24} style={[styles.back, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={safeBack} />
      <IconButton icon='cog' iconColor={fg} size={24} style={[styles.topRight, { top: 8 + insets.top, right: 8 + insets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

      {gameMode === 'twoPlayer' ? (
        // See @tastic/split-screen's DualZoneLayout for the portrait-vs-landscape switch and its
        // own note on why P1's zone stays unrotated while P2's rotates 180° in portrait.
        <DualZoneLayout panelLayout={panelLayout} panelFadeStyle={panelFadeStyle} p1={p1Panel} p2={p2Panel} shared={sharedControls} />
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

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  back: {
    left: 8,
    position: 'absolute',
    top: 8
  },
  container: {
    alignItems: 'center',
    flex: 1,
    gap: 32,
    justifyContent: 'center',
    paddingHorizontal: 16
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
  stackedZone: {
    alignItems: 'center',
    gap: 28
  },
  topRight: {
    position: 'absolute',
    right: 8,
    top: 8
  }
})
