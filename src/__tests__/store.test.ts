import { GUIDE_VERSION } from '@/games/boxhockey/constants/guide'
import { selectGuideVersionSeen } from '@/games/boxhockey/redux/guideSlice'
import { DEFAULT_SETTINGS, playerSettings } from '@/games/boxhockey/redux/settingsSlice'

type StoreModule = typeof import('@/pack')
type AsyncStorageModule = typeof import('@react-native-async-storage/async-storage')
type AsyncStorage = AsyncStorageModule['default']

// redux-persist keeps each slice as its own JSON string inside the root blob.
const rootBlob = (slices: Record<string, unknown>) => JSON.stringify(Object.fromEntries([...Object.entries(slices), ['_persist', { version: -1, rehydrated: true }]].map(([key, value]) => [key, JSON.stringify(value)])))

// The real pack store (pack.ts), loaded fresh against the in-memory AsyncStorage mock (as in guideSlice.test.ts),
// so this checks the key the actual persistConfig reads and writes, not a copy of the config.
async function launch(items: Record<string, string>) {
  let loaded: StoreModule | undefined
  let storage: AsyncStorage | undefined
  jest.isolateModules(() => {
    // The official mock is a plain CommonJS object (module.exports = the mock), with no `default`.
    storage = require('@react-native-async-storage/async-storage') as AsyncStorage
    // Its multiSet writes before its first await, so storage is seeded before store.ts reads it.
    void storage.multiSet(Object.entries(items))
    loaded = require('@/pack') as StoreModule
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
describe("the pack store's storage key", () => {
  it('writes its state under its own prefix, pucktastic:root, and nothing else', async () => {
    const { storage } = await launch({})

    expect(await storage.getAllKeys()).toEqual(['pucktastic:root'])
  })

  it('reads its state back from pucktastic:root on the next launch', async () => {
    const { store } = await launch({ 'pucktastic:root': rootBlob({ boxhockeyGuide: { versionSeen: GUIDE_VERSION }, opponent: { seatTwo: 'person' } }) })

    expect(selectGuideVersionSeen(store.getState())).toBe(GUIDE_VERSION)
    expect(store.getState().opponent).toEqual({ seatTwo: 'person' })
  })

  // Only BoxHockey 1.0's own key is imported (see below); an older build's save, or another game's
  // on the web, starts fresh and is left where it was.
  it('leaves a save under persist:root unread and in place', async () => {
    const oldSave = rootBlob({ guide: { versionSeen: GUIDE_VERSION }, settings: { gameMode: 'twoPlayer', lockOrientation: true } })
    const { storage, store } = await launch({ 'persist:root': oldSave })
    const state = store.getState()

    expect(selectGuideVersionSeen(state)).toBe(0)
    expect(state.appSettings.lockOrientation).toBe(false)
    expect(state.opponent).toEqual({ seatTwo: 'cpu' })
    expect(await storage.getItem('persist:root')).toBe(oldSave)
  })

  it('starts a fresh install with the CPU in seat 2', async () => {
    const { store } = await launch({})

    expect(store.getState().opponent).toEqual({ seatTwo: 'cpu' })
  })
})

// BoxHockey 1.0 saved under boxhockey:root, Box Hockey's keys unprefixed and Lock Orientation, Edge
// Guard and the last mode picked on Home inside Box Hockey's own settings (importBoxHockey1.ts).
describe('a BoxHockey 1.0 save', () => {
  const settings = { gameMode: 'vsCpu', boardVariant: 'gravity', scoreToWin: 7, lockOrientation: true, lockedRotation: 90, deferBottomEdgeGestures: true }
  const oneZero = (extra: Record<string, unknown> = {}) =>
    rootBlob({
      settings,
      achievements: { stats: { firstGameResult: 'win' }, unlocked: { first_blood: 1760000000000 } },
      guide: { versionSeen: GUIDE_VERSION },
      profileExtensions: { sam: { controlScheme: 'stick' } },
      sound: { enabled: false },
      ...extra
    })
  const root = (state: unknown) => state as Record<string, Record<string, unknown>>

  it("is imported on the first launch, Box Hockey's keys under their new names", async () => {
    const { store } = await launch({ 'boxhockey:root': oneZero() })
    const state = root(store.getState())

    expect(state.boxhockeySettings).toEqual({ 'guest:1': { boardVariant: 'gravity', scoreToWin: 7 } })
    expect(state.boxhockeyAchievements).toMatchObject({ unlocked: { first_blood: 1760000000000 } })
    expect(selectGuideVersionSeen(store.getState())).toBe(GUIDE_VERSION)
    expect(state.boxhockeyControls).toEqual({ sam: 'stick' })
    expect(state.sound).toMatchObject({ enabled: false })
  })

  // 1.0 had one setup for everyone; it's seat 1's player's now. Each seat's shot style goes to the
  // player in it, and a profile's own saved pick wins over the one it only inherited from its seat.
  it("gives 1.0's setup to seat 1's guest, and each seat's shot style to its guest", async () => {
    const { store } = await launch({ 'boxhockey:root': oneZero({ settings: { ...settings, controlScheme: { 1: 'pull', 2: 'push' } } }) })
    const state = root(store.getState())

    expect(state.boxhockeySettings).toEqual({ 'guest:1': { boardVariant: 'gravity', scoreToWin: 7 } })
    expect(state.boxhockeyControls).toEqual({ 'guest:1': 'pull', 'guest:2': 'push', sam: 'stick' })
    expect(playerSettings.select(store.getState())).toEqual({ ...DEFAULT_SETTINGS, boardVariant: 'gravity', scoreToWin: 7, controlScheme: { 1: 'pull', 2: 'flick' } })
  })

  it("gives 1.0's setup to the profile in seat 1, who loads it with their own shot style", async () => {
    const twoPlayer = { ...settings, gameMode: 'twoPlayer', controlScheme: { 1: 'pull', 2: 'push' } }
    const { store } = await launch({ 'boxhockey:root': oneZero({ settings: twoPlayer, profileSelection: { 1: 'sam', 2: 'riley' } }) })
    const state = root(store.getState())

    expect(state.boxhockeySettings).toEqual({ sam: { boardVariant: 'gravity', scoreToWin: 7 } })
    expect(state.boxhockeyControls).toEqual({ sam: 'stick', riley: 'push' })
    expect(playerSettings.select(store.getState())).toEqual({ ...DEFAULT_SETTINGS, boardVariant: 'gravity', scoreToWin: 7, controlScheme: { 1: 'stick', 2: 'push' } })
  })

  it("moves 1.0's app-wide settings out of Box Hockey's, and its last mode into seat 2", async () => {
    const { store } = await launch({ 'boxhockey:root': oneZero() })
    const state = store.getState()

    expect(state.appSettings).toEqual({ lockOrientation: true, lockedRotation: 90, deferBottomEdgeGestures: true })
    expect(state.opponent).toEqual({ seatTwo: 'cpu' })
    for (const field of ['gameMode', 'lockOrientation', 'lockedRotation', 'deferBottomEdgeGestures']) expect(root(state).boxhockeySettings['guest:1']).not.toHaveProperty(field)
  })

  it('reads a 2 Player last mode as a person in seat 2', async () => {
    const { store } = await launch({ 'boxhockey:root': oneZero({ settings: { ...settings, gameMode: 'twoPlayer' } }) })

    expect(store.getState().opponent).toEqual({ seatTwo: 'person' })
  })

  it('saves the import under pucktastic:root and leaves the 1.0 save in place', async () => {
    const save = oneZero()
    const { storage } = await launch({ 'boxhockey:root': save })

    expect(JSON.parse(JSON.parse((await storage.getItem('pucktastic:root')) ?? '{}').boxhockeyGuide)).toEqual({ versionSeen: GUIDE_VERSION })
    expect(await storage.getItem('boxhockey:root')).toBe(save)
  })

  it('is ignored once there is a pack save', async () => {
    const { store } = await launch({ 'boxhockey:root': oneZero(), 'pucktastic:root': rootBlob({ opponent: { seatTwo: 'person' } }) })
    const state = store.getState()

    expect(state.opponent).toEqual({ seatTwo: 'person' })
    expect(selectGuideVersionSeen(state)).toBe(0)
    expect(state.appSettings.lockOrientation).toBe(false)
  })

  it('starts fresh when the 1.0 save is unreadable', async () => {
    const { store } = await launch({ 'boxhockey:root': '{not json' })

    expect(selectGuideVersionSeen(store.getState())).toBe(0)
    expect(store.getState().opponent).toEqual({ seatTwo: 'cpu' })
  })
})
