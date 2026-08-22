import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { IconButton } from '@rific/feedback-press'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconDropdownOption } from '@/components/IconDropdown'
import { LoadoutSharedControls } from '@/components/LoadoutSharedControls'
import { PlayerSetupPanel } from '@/components/PlayerSetupPanel'
import { ReadyButton } from '@/components/ReadyButton'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useGameSettings } from '@/hooks/useGameSettings'
import { usePopoverHost } from '@/hooks/usePopoverHost'
import { BoardVariant, OrientationMode, Player } from '@/types'
import { AI_DIFFICULTY_LABELS, AIDifficulty } from '@/utils/aiOpponent'
import { BOARD_VARIANT_LABELS } from '@/utils/board'
import { humanPlayersFor, parseGameMode } from '@/utils/gameMode'
import { safeBack } from '@/utils/navigation'

const BOARD_VARIANT_DESCRIPTIONS: Record<BoardVariant, string> = {
  classic: 'Off-center holes',
  open: 'No obstacles',
  gauntlet: 'Narrow center gap',
  gravity: 'Pull & push zones'
}
const BOARD_VARIANT_OPTIONS: IconDropdownOption<BoardVariant>[] = (['classic', 'open', 'gauntlet', 'gravity'] as BoardVariant[]).map((value) => ({ value, label: BOARD_VARIANT_LABELS[value], description: BOARD_VARIANT_DESCRIPTIONS[value] }))

const SCORE_TO_WIN_OPTIONS: IconDropdownOption<number>[] = [3, 5, 7, 10].map((value) => ({ value, label: String(value) }))

const AI_DIFFICULTY_OPTIONS: IconDropdownOption<AIDifficulty>[] = [
  { value: 'easy', label: AI_DIFFICULTY_LABELS.easy, icon: 'emoticon-happy-outline' },
  { value: 'medium', label: AI_DIFFICULTY_LABELS.medium, icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: AI_DIFFICULTY_LABELS.hard, icon: 'emoticon-devil-outline' }
]

// Labeled "Portrait"/"Landscape" (not "Face-to-Face"/"Side-by-Side") because that's the shape each
// layout actually reads as on screen: portrait splits the two panels top/bottom (P2's rotated 180°
// to face them across the table), landscape sits them side by side, upright, the way two people
// sharing a couch would hold the device between them. Purely a /loadout layout choice — see
// types/index.ts's OrientationMode doc; it never reaches /game or the device's own orientation.
const ORIENTATION_OPTIONS: IconDropdownOption<OrientationMode>[] = [
  { value: 'portrait', label: 'Portrait', description: 'Face each other', icon: 'crop-portrait' },
  { value: 'landscape', label: 'Landscape', description: 'Side by side', icon: 'crop-landscape' }
]

export default function LoadoutScreen() {
  // Read only from this screen's own route param, never from useGameSettings().settings.gameMode
  // — the settings hook's AsyncStorage read is async, and racing it here could momentarily show
  // the wrong number of player panels.
  const params = useLocalSearchParams<{ mode: string }>()
  const gameMode = useMemo(() => parseGameMode(params.mode), [params.mode])
  const humanPlayers = useMemo(() => humanPlayersFor(gameMode), [gameMode])

  const { settings, setSettings, commitRoundSettings } = useGameSettings()
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
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  const p2IsHuman = humanPlayers.includes(2)
  const isPortrait = settings.orientationMode === 'portrait'

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

  const sharedControls = <LoadoutSharedControls host={sharedHost} boardVariant={settings.boardVariant} boardVariantOptions={BOARD_VARIANT_OPTIONS} onBoardVariantChange={(value) => setSettings({ boardVariant: value })} scoreToWin={settings.scoreToWin} scoreToWinOptions={SCORE_TO_WIN_OPTIONS} onScoreToWinChange={(value) => setSettings({ scoreToWin: value })} orientationMode={gameMode === 'twoPlayer' ? settings.orientationMode : undefined} orientationModeOptions={gameMode === 'twoPlayer' ? ORIENTATION_OPTIONS : undefined} onOrientationModeChange={gameMode === 'twoPlayer' ? (value) => setSettings({ orientationMode: value }) : undefined} aiDifficulty={gameMode === 'vsCpu' ? settings.aiDifficulty : undefined} aiDifficultyOptions={gameMode === 'vsCpu' ? AI_DIFFICULTY_OPTIONS : undefined} onAiDifficultyChange={gameMode === 'vsCpu' ? (value) => setSettings({ aiDifficulty: value }) : undefined} accentColor={themeColors.tertiary} mutedColor={fgMuted} dark={dark} />

  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} />
  const p2Panel = <PlayerSetupPanel idPrefix='p2' host={sharedHost} color={p2Color} onColorChange={handleP2ColorChange} swatches={defaultColors} takenColor={p1Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman={p2IsHuman} ready={p2IsHuman ? ready[2] : undefined} onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined} dark={dark} showReadyButton={showReadyButton} align='right' />

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <IconButton icon='arrow-left' iconColor={fgMuted} size={24} style={[styles.back, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={safeBack} />
      <IconButton icon='cog' iconColor={fgMuted} size={24} style={[styles.topRight, { top: 8 + insets.top, right: 8 + insets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

      {gameMode === 'twoPlayer' ? (
        isPortrait ? (
          // Player 1 is assumed to be the device's owner, so the near/bottom zone (unrotated)
          // faces them; player 2 is the "far" player sitting across the table, so their zone is
          // rotated 180° to face them from the opposite side of the device.
          <View style={styles.dualZone}>
            <View style={styles.rotated180}>{p2Panel}</View>
            {sharedControls}
            {p1Panel}
          </View>
        ) : (
          // Landscape/side-by-side: both players sit upright next to each other, so the shared
          // controls sit in their own row above, rather than squeezed into the narrow column
          // between them.
          <View style={styles.stackedZone}>
            {sharedControls}
            <View style={styles.playersRow}>
              {p1Panel}
              {p2Panel}
            </View>
          </View>
        )
      ) : (
        <View style={styles.stackedZone}>
          {sharedControls}
          <View style={[styles.playersRow, (controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-')) && styles.playersRowOpen]}>
            {p1Panel}
            {p2Panel}
          </View>
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
