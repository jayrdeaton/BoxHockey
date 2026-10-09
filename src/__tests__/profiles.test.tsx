import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { type Profile as BaseProfile, profilesReducer } from '@tastic/profile'
import { act, render } from '@testing-library/react-native'
import { AppState } from 'react-native'
import { Provider } from 'react-redux'

import { ProfilesProvider } from '@/hooks/useProfiles'
import profileExtensions from '@/redux/profileExtensionsSlice'
import profileSelection from '@/redux/profileSelectionSlice'
import { Player } from '@/types'

import { emitAppState } from '../testUtils/appState'

// The shared App Group roster sibling @tastic apps write to: @tastic/profile's native TasticProfile
// module, faked over one in-memory JSON blob so the package's real resolveInitialProfiles and
// useSharedProfilesSync run end to end. `failRead` makes a read throw, which the package reports as
// an empty roster.
const mockSharedStore: { json: string | null; failRead: boolean } = { json: null, failRead: false }

jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core')
  return {
    ...actual,
    requireOptionalNativeModule: (name: string) =>
      name === 'TasticProfile'
        ? {
            getSharedJSON: async () => {
              if (mockSharedStore.failRead) throw new Error('read failed')
              return mockSharedStore.json
            },
            setSharedJSON: async (_groupId: string, _key: string, value: string) => {
              mockSharedStore.json = value
            }
          }
        : actual.requireOptionalNativeModule(name)
  }
})

function profile(id: string): BaseProfile {
  return { id, name: id, color: '#FF0000', tag: id.toUpperCase(), createdAt: 0, updatedAt: 0 }
}

const ada = profile('ada')
const bo = profile('bo')
const cy = profile('cy')

function writeShared(roster: BaseProfile[]) {
  mockSharedStore.json = JSON.stringify(roster)
}

beforeEach(() => {
  mockSharedStore.json = null
  mockSharedStore.failRead = false
  jest.mocked(AppState.addEventListener).mockClear()
})

// Mounts the real ProfilesProvider over the three slices it reads, with this device's last roster
// and seat selection as the persisted state, and lets the initial reconciliation land.
async function mountProfiles(local: BaseProfile[], selection: Record<Player, string | null>) {
  const store = configureStore({
    reducer: combineReducers({ profiles: profilesReducer, profileExtensions, profileSelection }),
    preloadedState: { profiles: local, profileExtensions: { [bo.id]: { controlScheme: 'push' } }, profileSelection: selection }
  })
  render(
    <Provider store={store}>
      <ProfilesProvider>{null}</ProfilesProvider>
    </Provider>
  )
  await act(async () => {})
  return store
}

// Returning to the foreground is when useSharedProfilesSync rereads the shared roster.
async function returnToForeground() {
  await act(async () => emitAppState('active'))
}

describe('ProfilesProvider seat selection', () => {
  it('clears a seat whose profile a sibling app deleted before this launch, and keeps the other seat', async () => {
    writeShared([ada])
    const store = await mountProfiles([ada, bo], { 1: ada.id, 2: bo.id })
    expect(store.getState().profiles).toEqual([ada])
    expect(store.getState().profileSelection).toEqual({ 1: ada.id, 2: null })
  })

  it('clears a seat whose profile a sibling app deleted while this one was backgrounded', async () => {
    writeShared([ada, bo])
    const store = await mountProfiles([ada, bo], { 1: ada.id, 2: bo.id })
    writeShared([bo, cy])
    await returnToForeground()
    expect(store.getState().profiles).toEqual([bo, cy])
    expect(store.getState().profileSelection).toEqual({ 1: null, 2: bo.id })
  })

  it('leaves the selection state untouched when every selected profile is still in the roster', async () => {
    writeShared([ada, bo])
    const store = await mountProfiles([ada, bo], { 1: ada.id, 2: null })
    const before = store.getState().profileSelection
    writeShared([ada, cy])
    await returnToForeground()
    expect(store.getState().profileSelection).toBe(before)
  })

  // A failed native read reports an empty roster, so pruning this app's own per-profile data on a
  // remote change could erase real players' settings for good. Only the seat selection is pruned.
  it("keeps a removed profile's local control scheme", async () => {
    writeShared([ada, bo])
    const store = await mountProfiles([ada, bo], { 1: ada.id, 2: bo.id })
    mockSharedStore.failRead = true
    await returnToForeground()
    expect(store.getState().profileSelection).toEqual({ 1: null, 2: null })
    expect(store.getState().profileExtensions).toEqual({ [bo.id]: { controlScheme: 'push' } })
  })
})
