import { useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { UnknownAction } from 'redux'

import { onProfileRemoved } from '@/shell/redux/onProfileRemoved'
import type { ShellState } from '@/shell/redux/shellState'
import type { Seat } from '@/shell/types'

const SEATS: readonly Seat[] = [1, 2]

// Who a seat's saved settings belong to: the profile picked for it, or that seat's guest. Seat 1's
// and seat 2's guests are different people, so each keeps its own.
export function seatPlayerKey(selection: Record<Seat, string | null>, seat: Seat): string {
  return selection[seat] ?? `guest:${seat}`
}

// A game's settings with each seat's controls (Box Hockey's shot style, the desktop keys elsewhere).
type WithControls<C> = { controlScheme: Record<Seat, C> }

// Saved per player: the match settings each player last set up as seat 1 (only what they changed;
// the rest comes from the game's defaults, so a setting added later starts at its default), and
// the controls each player last played with, in either seat.
export type PlayerSettingsState<S> = Record<string, Partial<Omit<S, 'controlScheme'>>>
export type PlayerControlsState<C> = Record<string, C>

interface PlayerSettingsOptions<S extends WithControls<C>, C> {
  // The game's id: its store keys are `${id}Settings` and `${id}Controls`.
  id: string
  defaults: S
  // When the two seats can't share one control (a desktop key cluster), every control in menu order:
  // if both seats would get the same one, seat 2 takes the first one seat 1 isn't using (shown and
  // played, never saved). Leave out where both can use the same (Box Hockey's shot styles).
  distinctControls?: readonly C[]
}

// One game's loadout, kept per player (Jay, 2026-10-24): the match settings follow seat 1's player,
// so each person's own setup loads when they're picked; each seat's controls follow the player in
// that seat. A seat's color pick is the shell's (seatColors, by profile). Seat 2 itself (the CPU, a
// person or nobody) is pack-wide, and so is everything in appSettings.
export function createPlayerSettings<S extends WithControls<C>, C>({ id, defaults, distinctControls }: PlayerSettingsOptions<S, C>) {
  const settingsKey = `${id}Settings`
  const controlsKey = `${id}Controls`
  const PATCH = `${settingsKey}/patch`
  const SET_CONTROL = `${controlsKey}/set`

  const patch = (player: string, changes: Partial<Omit<S, 'controlScheme'>>) => ({ type: PATCH, payload: { player, changes } })
  const setControl = (player: string, control: C) => ({ type: SET_CONTROL, payload: { player, control } })

  function forget<T>(state: Record<string, T>, profileId: string): Record<string, T> {
    if (!(profileId in state)) return state
    const { [profileId]: _removed, ...rest } = state
    return rest
  }

  const settingsReducer = onProfileRemoved((state: PlayerSettingsState<S> = {}, action: UnknownAction): PlayerSettingsState<S> => {
    if (action.type !== PATCH) return state
    const { player, changes } = action.payload as ReturnType<typeof patch>['payload']
    return { ...state, [player]: { ...state[player], ...changes } }
  }, forget)

  const controlsReducer = onProfileRemoved((state: PlayerControlsState<C> = {}, action: UnknownAction): PlayerControlsState<C> => {
    if (action.type !== SET_CONTROL) return state
    const { player, control } = action.payload as ReturnType<typeof setControl>['payload']
    return state[player] === control ? state : { ...state, [player]: control }
  }, forget)

  // The settings the loadout shows and a round plays with, from the saved state: seat 1's player's
  // own setup over the defaults, and each seat's player's controls (seat 2's only for a person).
  function compose(saved: PlayerSettingsState<S> | undefined, controls: PlayerControlsState<C> | undefined, selection: Record<Seat, string | null>, seatTwoIsPerson: boolean): S {
    const control1 = controls?.[seatPlayerKey(selection, 1)] ?? defaults.controlScheme[1]
    let control2 = (seatTwoIsPerson ? controls?.[seatPlayerKey(selection, 2)] : undefined) ?? defaults.controlScheme[2]
    if (distinctControls && control2 === control1) control2 = distinctControls.find((c) => c !== control1) ?? control2
    return { ...defaults, ...saved?.[seatPlayerKey(selection, 1)], controlScheme: { 1: control1, 2: control2 } } as S
  }

  // The same, read straight from the store (a game's How to Play reads it this way).
  function select(state: ShellState): S {
    const root = state as unknown as Record<string, unknown>
    return compose(root[settingsKey] as PlayerSettingsState<S> | undefined, root[controlsKey] as PlayerControlsState<C> | undefined, state.profileSelection, state.opponent.seatTwo === 'person')
  }

  // The loadout's settings and their one write path. A patch's match settings go to seat 1's player;
  // a changed control goes to that seat's player (seat 2's only for a person), so a swap of desktop
  // keys between the seats saves both players' new keys.
  function useSettings(): { settings: S; setSettings: (patch: Partial<S>) => void } {
    const selection = useSelector((state: ShellState) => state.profileSelection)
    const seatTwoIsPerson = useSelector((state: ShellState) => state.opponent.seatTwo === 'person')
    const saved = useSelector((state: Record<string, unknown>) => state[settingsKey] as PlayerSettingsState<S> | undefined)
    const controls = useSelector((state: Record<string, unknown>) => state[controlsKey] as PlayerControlsState<C> | undefined)
    const dispatch = useDispatch()

    const settings = useMemo(() => compose(saved, controls, selection, seatTwoIsPerson), [saved, controls, selection, seatTwoIsPerson])

    const setSettings = useCallback(
      (next: Partial<S>) => {
        const { controlScheme, ...changes } = next
        if (Object.keys(changes).length > 0) dispatch(patch(seatPlayerKey(selection, 1), changes as Partial<Omit<S, 'controlScheme'>>))
        if (!controlScheme) return
        for (const seat of SEATS) {
          if (seat === 2 && !seatTwoIsPerson) continue
          if (controlScheme[seat] !== settings.controlScheme[seat]) dispatch(setControl(seatPlayerKey(selection, seat), controlScheme[seat]))
        }
      },
      [dispatch, selection, seatTwoIsPerson, settings.controlScheme]
    )

    return { settings, setSettings }
  }

  // `reducers` is what a game mounts (its GameDefinition's reducers); the two are also named for tests.
  return { reducers: { [settingsKey]: settingsReducer, [controlsKey]: controlsReducer }, settingsReducer, controlsReducer, actions: { patch, setControl }, compose, select, useSettings }
}
