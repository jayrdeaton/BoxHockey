import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { IconButton } from '@rific/feedback-press'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconDropdownOption } from '@/components/IconDropdown'
import { LoadoutSharedControls } from '@/components/LoadoutSharedControls'
import { PlayerSetupPanel } from '@/components/PlayerSetupPanel'
import { ReadyButton } from '@/components/ReadyButton'
import { SettingsDialog } from '@/components/SettingsDialog'
import { LOADOUT_PANEL_SWAP_FADE_MS } from '@/constants/game'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useOrientationLock } from '@/hooks/useOrientationLock'
import { useP1OnRight } from '@/hooks/useP1OnRight'
import { usePopoverHost } from '@/hooks/usePopoverHost'
import { BoardVariant, FrictionLevel, Player, PuckSizeLevel, ShotPreviewLength, TipoffMode } from '@/types'
import { AI_DIFFICULTY_LABELS, AIDifficulty } from '@/utils/aiOpponent'
import { BOARD_VARIANT_LABELS } from '@/utils/board'
import { humanPlayersFor, parseGameMode } from '@/utils/gameMode'
import { safeBack } from '@/utils/navigation'

const BOARD_VARIANT_DESCRIPTIONS: Record<BoardVariant, string> = {
  classic: 'Off-center holes',
  gauntlet: 'Narrow center gap',
  gauntletPlus: 'Three alternating walls',
  gravity: 'Pull & push zones',
  gravityClassic: 'Classic walls + corner pushes',
  rink: 'Rounded corners, net pockets'
}
const BOARD_VARIANT_OPTIONS: IconDropdownOption<BoardVariant>[] = (['classic', 'gauntlet', 'gauntletPlus', 'gravity', 'gravityClassic', 'rink'] as BoardVariant[]).map((value) => ({ value, label: BOARD_VARIANT_LABELS[value], description: BOARD_VARIANT_DESCRIPTIONS[value] }))

const FRICTION_OPTIONS: IconDropdownOption<FrictionLevel>[] = [
  { value: 'low', label: 'Low', description: 'Puck glides farther', icon: 'speedometer' },
  { value: 'medium', label: 'Medium', description: 'Standard glide', icon: 'speedometer-medium' },
  { value: 'high', label: 'High', description: 'Puck stops quickly', icon: 'speedometer-slow' }
]

const PUCK_SIZE_OPTIONS: IconDropdownOption<PuckSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Tighter goal & gaps', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Wider goal & gaps', icon: 'circle-outline' }
]

const SCORE_TO_WIN_OPTIONS: IconDropdownOption<number>[] = [3, 5, 7, 10].map((value) => ({ value, label: String(value) }))

const SHOT_PREVIEW_LENGTH_OPTIONS: IconDropdownOption<ShotPreviewLength>[] = [
  { value: 'off', label: 'Off', description: 'No trajectory preview', icon: 'eye-off-outline' },
  { value: 'short', label: 'Short', description: 'Just the aim direction', icon: 'ray-start' },
  { value: 'medium', label: 'Medium', description: 'Occasionally reveals a bank', icon: 'ray-start-end' },
  { value: 'long', label: 'Long', description: 'Shows most bank shots', icon: 'ray-start-arrow' }
]

const TIPOFF_MODE_OPTIONS: IconDropdownOption<TipoffMode>[] = [
  { value: 'coinFlip', label: 'Coin Flip', description: 'Random pick starts, turns alternate', icon: 'hand-coin-outline' },
  { value: 'faceoff', label: 'Face-Off', description: 'Race the tap on every score', icon: 'hockey-puck' }
]

const AI_DIFFICULTY_OPTIONS: IconDropdownOption<AIDifficulty>[] = [
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
  // behind the live orientationMode/p1OnRight above — see panelOpacity below. Everything else on
  // this screen (the back/settings buttons, shared controls, Ready button) reads the live values
  // directly and never re-positions, so nothing about it needs masking.
  const [panelLayout, setPanelLayout] = useState({ orientationMode, p1OnRight })
  const panelOpacity = useSharedValue(1)
  // Both directions live in this one reaction (panelOpacity's only writer) rather than a useEffect
  // for the fade-out plus a second reaction for the fade-in. That split would let the fade-in start
  // climbing back to 1 the instant setPanelLayout is *called*, racing ahead of the JS-thread commit
  // that actually mounts the new branch/order — the exact bug this whole feature exists to avoid.
  // Comparing live values against the already-committed panelLayout instead means the fade-in only
  // fires once they've caught up, i.e. once the new layout is actually the one on screen.
  //
  // The 'unresolved' phase exists so a fresh navigation to this screen doesn't itself fade: p1OnRight
  // starts as a guess (see useP1OnRight) and corrects itself moments later once its own initial
  // orientation check resolves — that correction isn't a real rotation, so it snaps straight to the
  // right layout instead of fading like an actual mid-loadout rotation would.
  useAnimatedReaction(
    () => {
      if (!p1OnRightResolved) return 'unresolved'
      return `${orientationMode}:${p1OnRight}` === `${panelLayout.orientationMode}:${panelLayout.p1OnRight}` ? 'match' : 'mismatch'
    },
    (phase, previousPhase) => {
      if (previousPhase === null || phase === previousPhase) return
      if (phase === 'match') {
        if (previousPhase === 'mismatch') panelOpacity.value = withTiming(1, { duration: LOADOUT_PANEL_SWAP_FADE_MS })
        return
      }
      if (previousPhase === 'unresolved') {
        runOnJS(setPanelLayout)({ orientationMode, p1OnRight })
        return
      }
      panelOpacity.value = withTiming(0, { duration: LOADOUT_PANEL_SWAP_FADE_MS }, (finished) => {
        if (finished) runOnJS(setPanelLayout)({ orientationMode, p1OnRight })
      })
    }
  )
  const panelFadeStyle = useAnimatedStyle(() => ({ opacity: panelOpacity.value }))

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
  const isPortrait = panelLayout.orientationMode === 'portrait'

  // Vs-CPU only has one human slot, so its Ready toggle renders standalone below both panels
  // instead of embedded in P1's own panel.
  const showReadyButton = gameMode === 'twoPlayer'
  // P1's own panel and the shared controls row always share one host — mutually exclusive
  // regardless of game mode, since both sit in the same near/bottom zone. Vs-CPU additionally
  // folds P2/CPU's panel into this same host: only one human is ever driving both slots there, so
  // having both YOU's and CPU's popovers open at once is just clutter. Two-player mode keeps P2 on
  // its own independent host, since two real people editing at once is the whole point there.
  const controlsHost = usePopoverHost()
  const sharedHost = gameMode === 'vsCpu' ? controlsHost : undefined

  // Orientation is derived live from how the phone is held (see useDeviceOrientation) now, not a
  // per-round choice here — this row no longer takes orientationMode/orientationModeOptions/
  // onOrientationModeChange at all.
  const sharedControls = (
    <LoadoutSharedControls
      host={sharedHost}
      boardVariant={settings.boardVariant}
      boardVariantOptions={BOARD_VARIANT_OPTIONS}
      onBoardVariantChange={(value) => setSettings({ boardVariant: value })}
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
      dark={dark}
    />
  )

  // align mirrors panelLayout.p1OnRight (not the live value) so a panel's popover-anchor direction
  // changes in step with its actual on-screen side, not ahead of the fade that masks the swap.
  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} align={panelLayout.p1OnRight ? 'right' : undefined} />
  const p2Panel = <PlayerSetupPanel idPrefix='p2' host={sharedHost} color={p2Color} onColorChange={handleP2ColorChange} swatches={defaultColors} takenColor={p1Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman={p2IsHuman} ready={p2IsHuman ? ready[2] : undefined} onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined} dark={dark} showReadyButton={showReadyButton} align={panelLayout.p1OnRight ? undefined : 'right'} />

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <IconButton icon='arrow-left' iconColor={fg} size={24} style={[styles.back, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={safeBack} />
      <IconButton icon='cog' iconColor={fg} size={24} style={[styles.topRight, { top: 8 + insets.top, right: 8 + insets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

      {gameMode === 'twoPlayer' ? (
        isPortrait ? (
          // Player 1 is assumed to be the device's owner, so the near/bottom zone (unrotated)
          // faces them; player 2 is the "far" player sitting across the table, so their zone is
          // rotated 180° to face them from the opposite side of the device.
          <View style={styles.dualZone}>
            <Animated.View style={[styles.rotated180, panelFadeStyle]}>{p2Panel}</Animated.View>
            {sharedControls}
            <Animated.View style={panelFadeStyle}>{p1Panel}</Animated.View>
          </View>
        ) : (
          // Landscape/side-by-side: both players sit upright next to each other, so the shared
          // controls sit in their own row above, rather than squeezed into the narrow column
          // between them.
          <View style={styles.stackedZone}>
            {sharedControls}
            <Animated.View style={[styles.playersRow, panelFadeStyle]}>
              {panelLayout.p1OnRight ? p2Panel : p1Panel}
              {panelLayout.p1OnRight ? p1Panel : p2Panel}
            </Animated.View>
          </View>
        )
      ) : (
        <View style={styles.stackedZone}>
          {sharedControls}
          <Animated.View style={[styles.playersRow, (controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-')) && styles.playersRowOpen, panelFadeStyle]}>
            {!isPortrait && panelLayout.p1OnRight ? p2Panel : p1Panel}
            {!isPortrait && panelLayout.p1OnRight ? p1Panel : p2Panel}
          </Animated.View>
          <ReadyButton color={p1Color} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} />
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
  dualZone: {
    alignItems: 'center',
    gap: 28
  },
  playersRow: {
    flexDirection: 'row',
    gap: 40
  },
  playersRowOpen: {
    zIndex: 100
  },
  rotated180: {
    transform: [{ rotate: '180deg' }]
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
