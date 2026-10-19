import { GUIDE_VERSION } from '@/constants/guide'
import { selectGuideVersionSeen } from '@/redux/guideSlice'

type StoreModule = typeof import('@/redux/store')
type AsyncStorageModule = typeof import('@react-native-async-storage/async-storage')
type AsyncStorage = AsyncStorageModule['default']

// redux-persist keeps each slice as its own JSON string inside the root blob.
const rootBlob = (slices: Record<string, unknown>) => JSON.stringify(Object.fromEntries([...Object.entries(slices), ['_persist', { version: -1, rehydrated: true }]].map(([key, value]) => [key, JSON.stringify(value)])))

// The real store.ts, loaded fresh against the in-memory AsyncStorage mock (as in guideSlice.test.ts),
// so this checks the key the actual persistConfig reads and writes, not a copy of the config.
async function launch(items: Record<string, string>) {
  let loaded: StoreModule | undefined
  let storage: AsyncStorage | undefined
  jest.isolateModules(() => {
    // The official mock is a plain CommonJS object (module.exports = the mock), with no `default`.
    storage = require('@react-native-async-storage/async-storage') as AsyncStorage
    // Its multiSet writes before its first await, so storage is seeded before store.ts reads it.
    void storage.multiSet(Object.entries(items))
    loaded = require('@/redux/store') as StoreModule
  })
  const { persistor, store } = loaded as StoreModule
  await new Promise<void>((resolve) => {
    if (persistor.getState().bootstrapped) resolve()
    else persistor.subscribe(() => persistor.getState().bootstrapped && resolve())
  })
  // Drains redux-persist's write queue, so the root blob is written and no timer outlives the test.
  await persistor.flush()
  return { store, storage: storage as AsyncStorage }
}

// On the web every Tastic game shares games.infinitetoken.com's localStorage, where redux-persist's
// default prefix would make this game's state the same persist:root every game writes.
describe('store.ts storage key', () => {
  it("writes its state under BoxHockey's own prefix, boxhockey:root, and nothing else", async () => {
    const { storage } = await launch({})

    expect(await storage.getAllKeys()).toEqual(['boxhockey:root'])
  })

  it('reads its state back from boxhockey:root on the next launch', async () => {
    const { store } = await launch({ 'boxhockey:root': rootBlob({ guide: { versionSeen: GUIDE_VERSION } }) })

    expect(selectGuideVersionSeen(store.getState())).toBe(GUIDE_VERSION)
  })

  // No migrations: a save under the old key (unshipped builds, or another game's on the web) starts
  // fresh, so the guide shows once, and the old key is left where it was.
  it('leaves a save under the old persist:root unread and in place', async () => {
    const oldSave = rootBlob({ guide: { versionSeen: GUIDE_VERSION } })
    const { storage, store } = await launch({ 'persist:root': oldSave })

    expect(selectGuideVersionSeen(store.getState())).toBe(0)
    expect(await storage.getItem('persist:root')).toBe(oldSave)
  })

  it('still grandfathers a shipped pre-redux player past the guide, under the new key', async () => {
    const { storage, store } = await launch({ 'boxhockey.settings': JSON.stringify({ gameMode: 'vsCpu' }) })

    expect(selectGuideVersionSeen(store.getState())).toBe(GUIDE_VERSION)
    expect(JSON.parse(JSON.parse((await storage.getItem('boxhockey:root')) ?? '{}').guide)).toEqual({ versionSeen: GUIDE_VERSION })
  })
})
