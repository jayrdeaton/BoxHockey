import type { MenuOption, PopoverHost } from '@tastic/hud'
import type { GuideStep } from '@tastic/hud/guide'
import type { ComponentType, ReactNode } from 'react'
import type { ImageSourcePropType } from 'react-native'
import type { Action, Reducer } from 'redux'

import type { ShellState } from '@/shell/redux/shellState'

// The two seats every game in a pack shares: seat 1 is whoever picked a player on Home, seat 2 is
// the CPU, a second person, or (only in a game with a solo mode) nobody at all.
export type Seat = 1 | 2

// Who sits in seat 2. One value for the whole pack (shell/redux/opponentSlice.ts), so the same two
// people stay set up from one game to the next.
export type SeatTwo = 'cpu' | 'person' | 'nobody'

// What a round is, from seat 2: a CPU opponent, two people on one device, or one player alone.
export type RoundMode = 'vsCpu' | 'twoPlayer' | 'solo'

export function roundModeFor(seatTwo: SeatTwo): RoundMode {
  return seatTwo === 'person' ? 'twoPlayer' : seatTwo === 'nobody' ? 'solo' : 'vsCpu'
}

// The players who take part in a round and have to press Ready: a CPU and nobody don't.
export function humanSeatsFor(mode: RoundMode): Seat[] {
  return mode === 'twoPlayer' ? [1, 2] : [1]
}

// What the loadout's match-options row is handed (see GameLoadout.options): the popover host it
// shares with seat 1's panel, the screen's rotation, and the colors the row draws with.
export interface LoadoutOptionsProps {
  host: PopoverHost
  rotation: number
  accentColor: string
  mutedColor: string
  onAccentColor: string
  dark: boolean
  // Undefined while the loadout folds randomize/reset into its shared action band instead.
  onRandomize?: () => void
  onReset?: () => void
}

// The colors a seat's controls picker draws with: the loadout's tertiary accent, or the seat's own.
export interface SeatControlLook {
  accentColor: string
  seatColor: string
  mutedColor: string
  dark: boolean
}

// One game's part of the shared loadout (shell/screens/LoadoutScreen.tsx), built by the game's
// own useLoadout hook from its own saved settings.
export interface GameLoadout {
  // The settings snapshot committed as the round's when every human player readies up.
  roundSettings: object
  // The match-options row (board, rules, puck): the game's own controls, drawn under the shared
  // popover host so its menus open, elevate and close like every other loadout menu.
  options: (props: LoadoutOptionsProps) => ReactNode
  // The popover ids the options row opens, so the loadout can elevate the row while one is open.
  optionIds: readonly string[]
  randomize: () => void
  reset: () => void
  // A human seat's controls picker (shot style, keys), or undefined when the game has none.
  seatControl: (seat: Seat, host: PopoverHost, look: SeatControlLook) => ReactNode | undefined
  // Seat 2's CPU difficulty, saved per game since each game's CPU plays differently.
  cpuDifficulty: { value: string; options: MenuOption<string>[]; onChange: (value: string) => void }
}

// What a game's How to Play cards are built from: the live settings (through the game's own
// selector, so the guide host never has to know their shape), how seat 2 is set up, and whether
// the device is touch-first.
export interface GameGuide {
  version: number
  selectVersionSeen: (state: ShellState) => number
  markSeen: (version: number) => Action
  // Returns a value compared with shallowEqual, so keep it a flat object of the settings read.
  selectInput: (state: ShellState) => object
  getSteps: (input: object, context: { touch: boolean; mode: RoundMode }) => GuideStep[]
}

export interface GameDefinition {
  id: string
  title: string
  // One line under the tile's name on Home.
  blurb: string
  icon: { light: ImageSourcePropType; dark: ImageSourcePropType }
  // Seat 2's choices in this game, in menu order. 'nobody' only where the game has a solo mode.
  seatTwo: readonly SeatTwo[]
  // How the 2 Player loadout seats its players, to match where the game puts them: always face
  // to face (or only off the web, where a desktop window seats them side by side), and whether an
  // upside-down hold swaps who is at the bottom.
  twoPlayerSeats: { faceToFaceOnWeb: boolean; followUpsideDown: boolean }
  // The store keys this game mounts (settings, achievements, guide), merged into the pack's store.
  reducers: Record<string, Reducer>
  // Mounted at the app root for the game's lifetime (its stats and achievements context).
  Provider: ComponentType<{ children: ReactNode }>
  useLoadout: (mode: RoundMode) => GameLoadout
  PlayScreen: ComponentType
  // The game's stats sections and its achievement list for the stats screen, for one profile
  // (null is Everyone).
  StatsSections: ComponentType<{ profileId: string | null }>
  AchievementList: ComponentType<{ profileId: string | null }>
  // Clears the game's stats and achievements (the stats screen's Reset).
  resetStats: () => Action
  guide: GameGuide
}

export interface PackDefinition {
  name: string
  // The Home wordmark's two lines.
  wordmark: readonly [string, string]
  // A seat's color pick for a profile is kept for this pack only; the seat button says so.
  colorCaption: string
  games: readonly GameDefinition[]
}
