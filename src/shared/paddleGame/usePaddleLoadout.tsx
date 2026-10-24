import { ControlSchemePicker, type MenuOption, type PopoverHost } from '@tastic/hud'
import { assignSeatScheme } from '@tastic/input'
import { useCallback, useMemo } from 'react'
import { Platform } from 'react-native'

import { LOADOUT_SHARED_CONTROLS_IDS, LoadoutSharedControls } from '@/shared/paddleGame/components/LoadoutSharedControls'
import { DEFAULT_SETTINGS } from '@/shared/paddleGame/settings'
import type { AiDifficulty, BallSpeedLevel, ControlScheme, PaddleSizeLevel, Settings } from '@/shared/paddleGame/types'
import { tiltControlActiveFor } from '@/shared/paddleGame/utils/gameMode'
import type { GameLoadout, LoadoutOptionsProps, RoundMode, Seat, SeatControlLook } from '@/shell/types'

const PADDLE_SIZE_OPTIONS: MenuOption<PaddleSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Shorter paddle, more precision', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Taller paddle, easier defense', icon: 'circle-outline' }
]

// The puck has no friction here: its speed tier sets both the serve speed and how much each paddle
// hit adds (see BALL_SPEED_TIERS in constants/game.ts).
const BALL_SPEED_OPTIONS: MenuOption<BallSpeedLevel>[] = [
  { value: 'slow', label: 'Slow', description: 'Gentle pace, ramps up slowly', icon: 'speedometer-slow' },
  { value: 'medium', label: 'Medium', description: 'Standard pace', icon: 'speedometer-medium' },
  { value: 'fast', label: 'Fast', description: 'Quick pace, ramps up fast', icon: 'speedometer' }
]

const SCORE_TO_WIN_OPTIONS: MenuOption<number>[] = [3, 5, 7, 10].map((value) => ({ value, label: String(value) }))

const AI_DIFFICULTY_OPTIONS: MenuOption<AiDifficulty>[] = [
  { value: 'easy', label: 'Easy', icon: 'emoticon-happy-outline' },
  { value: 'medium', label: 'Medium', icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: 'Hard', icon: 'emoticon-devil-outline' }
]

const TILT_CONTROL_OPTION: MenuOption<'tiltControl'> = { value: 'tiltControl', label: 'Tilt Control', icon: 'screen-rotation' }

// Icon-less, like the other games' pickers: no icon reads as "WASD" or "IJKL" at a glance.
const CONTROL_SCHEME_OPTIONS: MenuOption<ControlScheme>[] = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'wasd', label: 'WASD' },
  { value: 'arrows', label: 'Arrows' },
  { value: 'ijkl', label: 'IJKL' },
  { value: 'numpad', label: 'Numpad' }
]

function pickRandom<T>(options: readonly { value: T }[]): T {
  return options[Math.floor(Math.random() * options.length)].value
}

// A paddle game's part of the shared loadout (shell/screens/LoadoutScreen.tsx), from the game's own
// settings: its match options (paddle size, puck speed, score to win, and tilt steering while one
// person plays on a phone), each seat's controls on desktop web, and the CPU's difficulty.
export function usePaddleLoadout(mode: RoundMode, settings: Settings, setSettings: (patch: Partial<Settings>) => void): GameLoadout {
  const p2IsHuman = mode === 'twoPlayer'
  // Tilt steering needs an accelerometer reading, which the web never has.
  const offerTilt = Platform.OS !== 'web' && tiltControlActiveFor(mode, true)

  // Covers exactly the match options, plus the CPU's difficulty against the CPU. Per-seat things
  // (colors, controls) and tilt steering (a preference, not a match setting) aren't shuffled or reset.
  const randomize = useCallback(() => {
    setSettings({
      paddleSize: pickRandom(PADDLE_SIZE_OPTIONS),
      ballSpeed: pickRandom(BALL_SPEED_OPTIONS),
      scoreToWin: pickRandom(SCORE_TO_WIN_OPTIONS),
      ...(mode === 'vsCpu' ? { aiDifficulty: pickRandom(AI_DIFFICULTY_OPTIONS) } : {})
    })
  }, [setSettings, mode])

  const reset = useCallback(() => {
    setSettings({
      paddleSize: DEFAULT_SETTINGS.paddleSize,
      ballSpeed: DEFAULT_SETTINGS.ballSpeed,
      scoreToWin: DEFAULT_SETTINGS.scoreToWin,
      ...(mode === 'vsCpu' ? { aiDifficulty: DEFAULT_SETTINGS.aiDifficulty } : {})
    })
  }, [setSettings, mode])

  const options = useCallback(
    ({ host, accentColor, mutedColor, onAccentColor, dark, onRandomize, onReset }: LoadoutOptionsProps) => <LoadoutSharedControls host={host} paddleSize={settings.paddleSize} paddleSizeOptions={PADDLE_SIZE_OPTIONS} onPaddleSizeChange={(value) => setSettings({ paddleSize: value })} ballSpeed={settings.ballSpeed} ballSpeedOptions={BALL_SPEED_OPTIONS} onBallSpeedChange={(value) => setSettings({ ballSpeed: value })} scoreToWin={settings.scoreToWin} scoreToWinOptions={SCORE_TO_WIN_OPTIONS} onScoreToWinChange={(value) => setSettings({ scoreToWin: value })} tiltControlEnabled={offerTilt ? settings.tiltControlEnabled : undefined} tiltControlOption={offerTilt ? TILT_CONTROL_OPTION : undefined} onTiltControlEnabledChange={offerTilt ? (value) => setSettings({ tiltControlEnabled: value }) : undefined} onRandomize={onRandomize} onReset={onReset} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />,
    [settings, setSettings, offerTilt]
  )

  // A person's controls on desktop web: the mouse or a key cluster (ControlSchemePicker is null on
  // touch-first devices). Picking the other seat's scheme hands it this seat's old one
  // (@tastic/input's assignSeatScheme), so the two seats never share one; against the CPU or alone,
  // seat 1 can take any scheme.
  const seatControl = useCallback(
    (seat: Seat, host: PopoverHost, { seatColor, mutedColor, dark }: SeatControlLook) => {
      const other: Seat = seat === 1 ? 2 : 1
      return <ControlSchemePicker id={`p${seat}-control`} host={host} value={settings.controlScheme[seat]} onChange={(scheme: ControlScheme) => setSettings({ controlScheme: assignSeatScheme(settings.controlScheme, seat, scheme) })} options={CONTROL_SCHEME_OPTIONS} takenValue={p2IsHuman ? settings.controlScheme[other] : undefined} accentColor={seatColor} mutedColor={mutedColor} dark={dark} />
    },
    [settings.controlScheme, setSettings, p2IsHuman]
  )

  const cpuDifficulty = useMemo(() => ({ value: settings.aiDifficulty, options: AI_DIFFICULTY_OPTIONS, onChange: (value: string) => setSettings({ aiDifficulty: value as AiDifficulty }) }), [settings.aiDifficulty, setSettings])

  return { roundSettings: settings, options, optionIds: LOADOUT_SHARED_CONTROLS_IDS, randomize, reset, seatControl, cpuDifficulty }
}
