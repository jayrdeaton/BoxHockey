import { ControlSchemePicker, type MenuOption, type PopoverHost } from '@tastic/hud'
import { assignSeatScheme } from '@tastic/input'
import { useCallback, useMemo } from 'react'

import { LOADOUT_SHARED_CONTROLS_IDS, LoadoutSharedControls } from '@/games/airhockey/components/LoadoutSharedControls'
import { useSettings } from '@/games/airhockey/hooks/useSettings'
import { DEFAULT_SETTINGS } from '@/games/airhockey/redux/settingsSlice'
import { ControlScheme, FrictionLevel, PaddleSizeLevel, PuckSizeLevel } from '@/games/airhockey/types'
import { AIDifficulty } from '@/games/airhockey/utils/aiOpponent'
import type { GameLoadout, LoadoutOptionsProps, RoundMode, Seat, SeatControlLook } from '@/shell/types'

// The rink toggle's single option, same as BoxHockey's RINK_OPTION: presence in a one-item
// multi-select's value array already means "on," so there's nothing an "off" row would add beyond
// what tapping the "on" row a second time (to un-toggle it) already does.
const RINK_OPTION: MenuOption<'on'> = { value: 'on', label: 'Rink', description: 'Rounded corners + net pocket', icon: 'rounded-corner' }

const FRICTION_OPTIONS: MenuOption<FrictionLevel>[] = [
  { value: 'high', label: 'Slow', description: 'Puck stops quickly', icon: 'speedometer-slow' },
  { value: 'medium', label: 'Medium', description: 'Standard glide', icon: 'speedometer-medium' },
  { value: 'low', label: 'Fast', description: 'Puck glides farther', icon: 'speedometer' }
]

// Rewritten from BoxHockey's own puck-size descriptions, which referenced divider gaps that don't
// exist here - AirHockey's puck size instead scales the goal mouth itself (goal width is derived
// from puck+paddle radii - see GOAL_OPEN_FRACTION in constants/game.ts), so it's a
// forgiveness/difficulty knob on scoring rather than a squeeze-through one.
const PUCK_SIZE_OPTIONS: MenuOption<PuckSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Narrower goals, harder to score', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Wider goals, easier to score', icon: 'circle-outline' }
]

// New relative to BoxHockey - the paddle now physically collides with the puck (see
// applyPaddleCollision in utils/physics.ts), so its size is a real defense/precision knob, not just
// cosmetic. Same size-tier option shape as PUCK_SIZE_OPTIONS above.
const PADDLE_SIZE_OPTIONS: MenuOption<PaddleSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Smaller mallet, more precision', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Bigger mallet, easier defense', icon: 'circle-outline' }
]

const SCORE_TO_WIN_OPTIONS: MenuOption<number>[] = [3, 5, 7, 10].map((value) => ({ value, label: String(value) }))

const AI_DIFFICULTY_OPTIONS: MenuOption<AIDifficulty>[] = [
  { value: 'easy', label: 'Easy', icon: 'emoticon-happy-outline' },
  { value: 'medium', label: 'Medium', icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: 'Hard', icon: 'emoticon-devil-outline' }
]

// Left icon-less, mirroring Snake's/Pong's own CONTROL_SCHEME_OPTIONS exactly - there's no
// MaterialCommunityIcons glyph that reads as "WASD" or "IJKL" at a glance the other option lists
// above get from their icons, so mixing one iconned option (Mouse) in with four icon-less ones
// would look like an inconsistency rather than a real distinction.
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

// Air Hockey's part of the shared loadout (shell/screens/LoadoutScreen.tsx): its match options
// (rink, puck speed and size, paddle size, score to win), each seat's controls on desktop web, and
// the CPU's difficulty.
export function useLoadout(mode: RoundMode): GameLoadout {
  const { settings, setSettings } = useSettings()
  const p2IsHuman = mode === 'twoPlayer'

  // Covers exactly the fields the match options row exposes, plus the CPU's difficulty against the
  // CPU. Per-seat things (colors, controls) and pack-wide settings aren't "match settings" in the
  // sense a player means when they shuffle or reset the next match.
  const randomize = useCallback(() => {
    setSettings({
      rink: Math.random() < 0.5,
      friction: pickRandom(FRICTION_OPTIONS),
      puckSize: pickRandom(PUCK_SIZE_OPTIONS),
      paddleSize: pickRandom(PADDLE_SIZE_OPTIONS),
      scoreToWin: pickRandom(SCORE_TO_WIN_OPTIONS),
      ...(mode === 'vsCpu' ? { aiDifficulty: pickRandom(AI_DIFFICULTY_OPTIONS) } : {})
    })
  }, [setSettings, mode])

  const reset = useCallback(() => {
    setSettings({
      rink: DEFAULT_SETTINGS.rink,
      friction: DEFAULT_SETTINGS.friction,
      puckSize: DEFAULT_SETTINGS.puckSize,
      paddleSize: DEFAULT_SETTINGS.paddleSize,
      scoreToWin: DEFAULT_SETTINGS.scoreToWin,
      ...(mode === 'vsCpu' ? { aiDifficulty: DEFAULT_SETTINGS.aiDifficulty } : {})
    })
  }, [setSettings, mode])

  const options = useCallback(({ host, accentColor, mutedColor, onAccentColor, dark, onRandomize, onReset }: LoadoutOptionsProps) => <LoadoutSharedControls host={host} rink={settings.rink} rinkOption={RINK_OPTION} onRinkChange={(value) => setSettings({ rink: value })} friction={settings.friction} frictionOptions={FRICTION_OPTIONS} onFrictionChange={(value) => setSettings({ friction: value })} puckSize={settings.puckSize} puckSizeOptions={PUCK_SIZE_OPTIONS} onPuckSizeChange={(value) => setSettings({ puckSize: value })} paddleSize={settings.paddleSize} paddleSizeOptions={PADDLE_SIZE_OPTIONS} onPaddleSizeChange={(value) => setSettings({ paddleSize: value })} scoreToWin={settings.scoreToWin} scoreToWinOptions={SCORE_TO_WIN_OPTIONS} onScoreToWinChange={(value) => setSettings({ scoreToWin: value })} onRandomize={onRandomize} onReset={onReset} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />, [settings, setSettings])

  // A person's controls on desktop web: the mouse or a key cluster (ControlSchemePicker is null on
  // touch-first devices). Picking the other seat's scheme hands it this seat's old one
  // (@tastic/input's assignSeatScheme), so the two seats never share one; against the CPU, seat 1
  // can take any scheme.
  const seatControl = useCallback(
    (seat: Seat, host: PopoverHost, { seatColor, mutedColor, dark }: SeatControlLook) => {
      const other: Seat = seat === 1 ? 2 : 1
      return <ControlSchemePicker id={`p${seat}-control`} host={host} value={settings.controlScheme[seat]} onChange={(scheme: ControlScheme) => setSettings({ controlScheme: assignSeatScheme(settings.controlScheme, seat, scheme) })} options={CONTROL_SCHEME_OPTIONS} takenValue={p2IsHuman ? settings.controlScheme[other] : undefined} accentColor={seatColor} mutedColor={mutedColor} dark={dark} />
    },
    [settings.controlScheme, setSettings, p2IsHuman]
  )

  const cpuDifficulty = useMemo(() => ({ value: settings.aiDifficulty, options: AI_DIFFICULTY_OPTIONS, onChange: (value: string) => setSettings({ aiDifficulty: value as AIDifficulty }) }), [settings.aiDifficulty, setSettings])

  return { roundSettings: settings, options, optionIds: LOADOUT_SHARED_CONTROLS_IDS, randomize, reset, seatControl, cpuDifficulty }
}
