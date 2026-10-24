import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { profilesActions } from '@tastic/profile'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import type { UnknownAction } from 'redux'

import { createPlayerSettings, seatPlayerKey } from '@/shared/playerSettings'
import opponent, { opponentActions } from '@/shell/redux/opponentSlice'
import profileSelection, { profileSelectionActions } from '@/shell/redux/profileSelectionSlice'
import type { Seat, SeatTwo } from '@/shell/types'

// A game's loadout follows its players (Jay, 2026-10-24): the match settings are seat 1's player's
// own, and each seat's controls are its player's.

type Key = 'mouse' | 'wasd' | 'arrows'
interface Settings {
  speed: 'slow' | 'medium' | 'fast'
  scoreToWin: number
  controlScheme: Record<Seat, Key>
}

const DEFAULTS: Settings = { speed: 'medium', scoreToWin: 5, controlScheme: { 1: 'mouse', 2: 'wasd' } }
const game = createPlayerSettings<Settings, Key>({ id: 'test', defaults: DEFAULTS, distinctControls: ['mouse', 'wasd', 'arrows'] })
const shared = createPlayerSettings<Settings, Key>({ id: 'shared', defaults: DEFAULTS })

const NOBODY = { 1: null, 2: null }

function makeStore(selection: Record<Seat, string | null> = NOBODY, seatTwo: SeatTwo = 'cpu') {
  const store = configureStore({ reducer: combineReducers({ profileSelection, opponent, ...game.reducers }) })
  store.dispatch(profileSelectionActions.select({ seat: 1, profileId: selection[1] }))
  store.dispatch(profileSelectionActions.select({ seat: 2, profileId: selection[2] }))
  store.dispatch(opponentActions.initialize({ seatTwo }))
  return store
}

async function renderSettings(store: ReturnType<typeof makeStore>) {
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  return renderHook(() => game.useSettings(), { wrapper })
}

const saved = (store: ReturnType<typeof makeStore>) => store.getState() as unknown as { testSettings: Record<string, unknown>; testControls: Record<string, unknown> }

describe('seatPlayerKey', () => {
  it("is the seat's profile, or that seat's own guest", () => {
    expect(seatPlayerKey({ 1: 'sam', 2: null }, 1)).toBe('sam')
    expect(seatPlayerKey({ 1: 'sam', 2: null }, 2)).toBe('guest:2')
    expect(seatPlayerKey(NOBODY, 1)).toBe('guest:1')
  })
})

describe('compose', () => {
  it('is the defaults for a player who has changed nothing', () => {
    expect(game.compose(undefined, undefined, NOBODY, false)).toEqual(DEFAULTS)
  })

  it("loads seat 1's player's own setup, over the defaults", () => {
    const settings = { sam: { speed: 'fast' as const }, riley: { scoreToWin: 10 } }
    expect(game.compose(settings, {}, { 1: 'sam', 2: 'riley' }, true)).toEqual({ ...DEFAULTS, speed: 'fast' })
    expect(game.compose(settings, {}, { 1: 'riley', 2: 'sam' }, true)).toEqual({ ...DEFAULTS, scoreToWin: 10 })
  })

  it("gives each seat its own player's controls, seat 2's only for a person", () => {
    const controls = { sam: 'arrows' as const, riley: 'mouse' as const }
    expect(game.compose({}, controls, { 1: 'riley', 2: 'sam' }, true).controlScheme).toEqual({ 1: 'mouse', 2: 'arrows' })
    expect(game.compose({}, controls, { 1: 'sam', 2: 'riley' }, false).controlScheme).toEqual({ 1: 'arrows', 2: 'wasd' })
  })

  it('moves seat 2 off a control seat 1 is using, where two seats cannot share one', () => {
    const controls = { sam: 'wasd' as const, riley: 'wasd' as const }
    expect(game.compose({}, controls, { 1: 'sam', 2: 'riley' }, true).controlScheme).toEqual({ 1: 'wasd', 2: 'mouse' })
    // Against the CPU too, so a later 2 Player round never starts with both seats on the same keys.
    expect(game.compose({}, { sam: 'wasd' }, { 1: 'sam', 2: null }, false).controlScheme).toEqual({ 1: 'wasd', 2: 'mouse' })
  })

  it('lets both seats keep the same control where they can share one', () => {
    expect(shared.compose({}, { sam: 'wasd', riley: 'wasd' }, { 1: 'sam', 2: 'riley' }, true).controlScheme).toEqual({ 1: 'wasd', 2: 'wasd' })
  })
})

describe('the reducers', () => {
  const { settingsReducer, controlsReducer } = game
  // @tastic/profile's action creators are typed without an index signature.
  const removeSam = profilesActions.remove('sam') as unknown as UnknownAction

  it("keep each player's changes apart", () => {
    let state = settingsReducer(undefined, game.actions.patch('sam', { speed: 'fast' }))
    state = settingsReducer(state, game.actions.patch('riley', { scoreToWin: 3 }))
    state = settingsReducer(state, game.actions.patch('sam', { scoreToWin: 7 }))
    expect(state).toEqual({ sam: { speed: 'fast', scoreToWin: 7 }, riley: { scoreToWin: 3 } })
  })

  it("forget a deleted profile's setup and controls, and keep everyone else's", () => {
    const settings = settingsReducer({ sam: { speed: 'fast' }, riley: { scoreToWin: 3 } }, removeSam)
    const controls = controlsReducer({ sam: 'arrows', 'guest:1': 'wasd' }, removeSam)
    expect(settings).toEqual({ riley: { scoreToWin: 3 } })
    expect(controls).toEqual({ 'guest:1': 'wasd' })
  })
})

describe('useSettings', () => {
  it("saves a match setting with seat 1's player, and loads each player's own when seat 1 changes", async () => {
    const store = makeStore({ 1: 'sam', 2: null })
    const { result } = await renderSettings(store)

    await act(async () => result.current.setSettings({ speed: 'fast' }))
    expect(result.current.settings.speed).toBe('fast')
    expect(saved(store).testSettings).toEqual({ sam: { speed: 'fast' } })

    await act(async () => store.dispatch(profileSelectionActions.select({ seat: 1, profileId: 'riley' })))
    expect(result.current.settings.speed).toBe('medium')

    await act(async () => store.dispatch(profileSelectionActions.select({ seat: 1, profileId: 'sam' })))
    expect(result.current.settings.speed).toBe('fast')
  })

  it("saves each seat's control with the player in it", async () => {
    const store = makeStore({ 1: 'sam', 2: 'riley' }, 'person')
    const { result } = await renderSettings(store)

    await act(async () => result.current.setSettings({ controlScheme: { 1: 'arrows', 2: 'mouse' } }))
    expect(saved(store).testControls).toEqual({ sam: 'arrows', riley: 'mouse' })
    expect(saved(store).testSettings).toEqual({})
  })

  it("never saves seat 2's control for the CPU", async () => {
    const store = makeStore({ 1: 'sam', 2: 'riley' }, 'cpu')
    const { result } = await renderSettings(store)

    await act(async () => result.current.setSettings({ controlScheme: { 1: 'wasd', 2: 'mouse' } }))
    expect(saved(store).testControls).toEqual({ sam: 'wasd' })
  })

  it("keeps a guest's setup with the seat they sat in", async () => {
    const store = makeStore(NOBODY, 'person')
    const { result } = await renderSettings(store)

    await act(async () => result.current.setSettings({ scoreToWin: 10, controlScheme: { 1: 'arrows', 2: 'wasd' } }))
    expect(saved(store).testSettings).toEqual({ 'guest:1': { scoreToWin: 10 } })
    expect(saved(store).testControls).toEqual({ 'guest:1': 'arrows' })
  })
})
