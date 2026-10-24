import { type MenuOption, type PopoverHost, SectionedDropdown } from '@tastic/hud'
import { useCallback, useMemo } from 'react'
import { Platform } from 'react-native'

import { LOADOUT_SHARED_CONTROLS_IDS, LoadoutSharedControls } from '@/games/boxhockey/components/LoadoutSharedControls'
import { DEFAULT_SETTINGS, playerSettings } from '@/games/boxhockey/redux/settingsSlice'
import { BoardVariant, ControlScheme, FrictionLevel, InterceptSpeed, PuckSizeLevel, ShotPreviewLength, TipoffMode } from '@/games/boxhockey/types'
import { AI_DIFFICULTY_LABELS, AIDifficulty } from '@/games/boxhockey/utils/aiOpponent'
import { BOARD_VARIANT_LABELS } from '@/games/boxhockey/utils/board'
import type { GameLoadout, LoadoutOptionsProps, RoundMode, Seat, SeatControlLook } from '@/shell/types'

const BOARD_VARIANT_DESCRIPTIONS: Record<BoardVariant, string> = {
  classic: 'Off-center holes',
  gauntlet: 'Three alternating walls',
  gravity: 'Classic walls + corner pushes'
}
const BOARD_VARIANT_OPTIONS: MenuOption<BoardVariant>[] = (['classic', 'gauntlet', 'gravity'] as BoardVariant[]).map((value) => ({ value, label: BOARD_VARIANT_LABELS[value], description: BOARD_VARIANT_DESCRIPTIONS[value] }))

// Independent of boardVariant, but rides along in the same popover as one of its rows - see
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
  { value: 'flick', label: 'Flick', description: 'Swipe fast: power comes from speed', icon: 'gesture-swipe' },
  { value: 'stick', label: 'Stick', description: 'Swing into the puck to hit it', icon: 'hockey-sticks' },
  { value: 'pull', label: 'Pull', description: 'Drag back, release to fire', icon: 'arrow-collapse' },
  { value: 'push', label: 'Push', description: 'Drag toward your shot, release to fire', icon: 'arrow-expand' }
]

const ALL_TIPOFF_MODE_OPTIONS: MenuOption<TipoffMode>[] = [
  { value: 'coinFlip', label: 'Coin Flip', description: 'Random pick starts, loser gets the puck', icon: 'hand-coin-outline' },
  { value: 'faceoff', label: 'Face-Off', description: 'Race the tap on every score', icon: 'hockey-puck' },
  { value: 'tripleTap', label: 'Triple Tap', description: 'Tap 3 times together, then race to swipe', icon: 'gesture-double-tap' }
]
// 'tripleTap' is touch/mobile only - no keyboard equivalent (see game.tsx), so it's hidden from the
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

// Box Hockey's part of the shared loadout (shell/screens/LoadoutScreen.tsx): its match options
// (board, rink, puck physics, intercepts, score to win, shot preview, tip-off), each seat's shot
// style, and the CPU's difficulty.
export function useLoadout(mode: RoundMode): GameLoadout {
  // Seat 1's player's own setup, and each seat's player's shot style (redux/settingsSlice.ts).
  const { settings, setSettings } = playerSettings.useSettings()

  // Saved with the player in that seat. No swap on conflict: Flick, Stick, Pull and Push aren't a
  // shared physical resource the way a keyboard's key clusters are, so both players can use the
  // same one.
  const setSeatControl = useCallback((seat: Seat, value: ControlScheme) => setSettings({ controlScheme: { ...settings.controlScheme, [seat]: value } }), [setSettings, settings.controlScheme])

  // Covers exactly the fields the match options row exposes, plus the CPU's difficulty against the
  // CPU. Per-seat things (colors, shot style) and pack-wide settings (Lock Orientation) aren't
  // "match settings" in the sense a player means when they shuffle or reset the next match.
  const randomize = useCallback(() => {
    setSettings({
      boardVariant: pickRandom(BOARD_VARIANT_OPTIONS),
      rink: Math.random() < 0.5,
      friction: pickRandom(FRICTION_OPTIONS),
      puckSize: pickRandom(PUCK_SIZE_OPTIONS),
      interceptSpeed: pickRandom(INTERCEPT_SPEED_OPTIONS),
      scoreToWin: pickRandom(SCORE_TO_WIN_OPTIONS),
      shotPreviewLength: pickRandom(SHOT_PREVIEW_LENGTH_OPTIONS),
      tipoffMode: pickRandom(TIPOFF_MODE_OPTIONS),
      ...(mode === 'vsCpu' ? { aiDifficulty: pickRandom(AI_DIFFICULTY_OPTIONS) } : {})
    })
  }, [setSettings, mode])

  const reset = useCallback(() => {
    setSettings({
      boardVariant: DEFAULT_SETTINGS.boardVariant,
      rink: DEFAULT_SETTINGS.rink,
      friction: DEFAULT_SETTINGS.friction,
      puckSize: DEFAULT_SETTINGS.puckSize,
      interceptSpeed: DEFAULT_SETTINGS.interceptSpeed,
      scoreToWin: DEFAULT_SETTINGS.scoreToWin,
      shotPreviewLength: DEFAULT_SETTINGS.shotPreviewLength,
      tipoffMode: DEFAULT_SETTINGS.tipoffMode,
      ...(mode === 'vsCpu' ? { aiDifficulty: DEFAULT_SETTINGS.aiDifficulty } : {})
    })
  }, [setSettings, mode])

  const options = useCallback(
    ({ host, rotation, accentColor, mutedColor, onAccentColor, dark, onRandomize, onReset }: LoadoutOptionsProps) => (
      <LoadoutSharedControls
        host={host}
        rotation={rotation as 0 | 90 | 180 | -90}
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
        onRandomize={onRandomize}
        onReset={onReset}
        accentColor={accentColor}
        mutedColor={mutedColor}
        onAccentColor={onAccentColor}
        dark={dark}
      />
    ),
    [settings, setSettings]
  )

  // A person's shot-style picker (Flick, Stick, Pull, Push) under their seat button. A CPU never
  // gets one: useAIOpponent.ts cancels the scheme's sign back out, so it's invisible to the CPU.
  const seatControl = useCallback((seat: Seat, host: PopoverHost, { accentColor, mutedColor, dark }: SeatControlLook) => <SectionedDropdown id={`p${seat}-control`} host={host} icon='arrow-collapse' accessibilityLabel='Controls' sections={[{ kind: 'single', id: 'controlScheme', options: CONTROL_SCHEME_OPTIONS, value: settings.controlScheme[seat], onChange: (value: ControlScheme) => setSeatControl(seat, value) }]} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />, [settings.controlScheme, setSeatControl])

  const cpuDifficulty = useMemo(() => ({ value: settings.aiDifficulty, options: AI_DIFFICULTY_OPTIONS, onChange: (value: string) => setSettings({ aiDifficulty: value as AIDifficulty }) }), [settings.aiDifficulty, setSettings])

  return { roundSettings: settings, options, optionIds: LOADOUT_SHARED_CONTROLS_IDS, randomize, reset, seatControl, cpuDifficulty }
}
