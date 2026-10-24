import { createReturningPlayerMigrate, type GuidePersistedState, type GuideStorageReader } from '@tastic/hud/guide'

import { GUIDE_VERSION } from '@/games/boxhockey/constants/guide'
import reducer, { guideActions, LEGACY_STORAGE_KEYS, selectGuideVersionSeen } from '@/games/boxhockey/redux/guideSlice'

const REHYDRATE = 'persist/REHYDRATE'
// redux-persist's own default persistConfig version (store.ts doesn't set one).
const PERSIST_VERSION = -1

// The factory's own behavior is covered in @tastic/hud's tests; this only pins this app's binding of
// it: GUIDE_VERSION is what an existing player is stamped with, and the slice is mounted (and
// therefore rehydrated) under `guide` in the 'root' persisted store (store.ts).
describe('guideSlice', () => {
  it('starts a fresh install as never seen, so the guide auto-shows on Home', () => {
    const state = reducer(undefined, { type: REHYDRATE, key: 'root', payload: undefined })
    expect(state.versionSeen).toBe(0)
  })

  it('stamps a player who already had the app with the current version, so an update never nags them', () => {
    const state = reducer(undefined, { type: REHYDRATE, key: 'root', payload: { theme: {}, profiles: {}, seatColors: {} } })
    expect(state.versionSeen).toBe(GUIDE_VERSION)
  })

  it('keeps a version this player already finished or skipped', () => {
    const state = reducer(undefined, { type: REHYDRATE, key: 'root', payload: { theme: {}, guide: { versionSeen: GUIDE_VERSION } } })
    expect(state.versionSeen).toBe(GUIDE_VERSION)
  })

  it('records the version on finish or skip, and reads back from the root state under `guide`', () => {
    const state = reducer(undefined, guideActions.markSeen(GUIDE_VERSION))

    expect(state.versionSeen).toBe(GUIDE_VERSION)
    expect(selectGuideVersionSeen({ guide: state })).toBe(GUIDE_VERSION)
  })
})

function storageWith(items: Record<string, string>): GuideStorageReader {
  return { getItem: async (key: string) => items[key] ?? null }
}

// store.ts's migrate over what storage held, then the guide slice rehydrated with its result, in the
// same order redux-persist uses.
async function launch(persistedRoot: GuidePersistedState, storage: GuideStorageReader) {
  const payload = await createReturningPlayerMigrate(storage, LEGACY_STORAGE_KEYS)(persistedRoot, PERSIST_VERSION)
  return reducer(undefined, { type: REHYDRATE, key: 'root', payload }).versionSeen
}

// Players of the shipped pre-redux build (ad363aa) have no root store, only these keys. See
// LEGACY_STORAGE_KEYS's own doc for where each one came from.
describe('LEGACY_STORAGE_KEYS', () => {
  it('lists at least one key, every one namespaced to this app, none twice', () => {
    expect(LEGACY_STORAGE_KEYS.length).toBeGreaterThan(0)
    expect(new Set(LEGACY_STORAGE_KEYS).size).toBe(LEGACY_STORAGE_KEYS.length)
    for (const key of LEGACY_STORAGE_KEYS) expect(key).toMatch(/^boxhockey\.[a-zA-Z]+$/)
  })

  it.each(LEGACY_STORAGE_KEYS)('grandfathers a shipped-build player who has only %s', async (key) => {
    expect(await launch(undefined, storageWith({ [key]: 'true' }))).toBe(GUIDE_VERSION)
  })

  it('still shows the guide on a fresh install: no root store and none of the keys', async () => {
    expect(await launch(undefined, storageWith({}))).toBe(0)
  })

  it('leaves an existing root store alone, so a player who has not finished the guide still sees it', async () => {
    const persistedRoot = { _persist: { version: PERSIST_VERSION, rehydrated: true } }
    const payload = await createReturningPlayerMigrate(storageWith({ 'boxhockey.settings': '{}' }), LEGACY_STORAGE_KEYS)(persistedRoot, PERSIST_VERSION)

    expect(payload).toBe(persistedRoot)
  })
})

type StoreModule = typeof import('@/pack')
type AsyncStorageModule = typeof import('@react-native-async-storage/async-storage')

// The real store.ts, loaded fresh against the in-memory AsyncStorage mock (@infinitetoken/jest-config
// maps the package to its official Jest mock), so this checks the actual persistConfig carries the
// migrate, not a copy of it.
describe('store.ts persistConfig', () => {
  async function launchRealStore(items: Record<string, string>): Promise<number> {
    let loaded: StoreModule | undefined
    // A fresh module registry per launch: a fresh (empty) storage mock and a fresh store.ts, whose
    // persistStore call reads storage at import time.
    jest.isolateModules(() => {
      // The official mock is a plain CommonJS object (module.exports = the mock), with no `default`.
      const AsyncStorage = require('@react-native-async-storage/async-storage') as AsyncStorageModule['default']
      // Its multiSet writes before its first await, so storage is seeded before store.ts reads it.
      void AsyncStorage.multiSet(Object.entries(items))
      loaded = require('@/pack') as StoreModule
    })
    const { persistor, store } = loaded as StoreModule
    await new Promise<void>((resolve) => {
      if (persistor.getState().bootstrapped) resolve()
      else persistor.subscribe(() => persistor.getState().bootstrapped && resolve())
    })
    // Drains redux-persist's write queue, so no timer outlives the test.
    await persistor.flush()
    return selectGuideVersionSeen(store.getState())
  }

  it('grandfathers a player from the shipped pre-redux build', async () => {
    expect(await launchRealStore({ 'boxhockey.settings': JSON.stringify({ gameMode: 'vsCpu' }) })).toBe(GUIDE_VERSION)
  })

  it('shows the guide on a fresh install', async () => {
    expect(await launchRealStore({})).toBe(0)
  })
})
