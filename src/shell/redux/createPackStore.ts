import AsyncStorage from '@react-native-async-storage/async-storage'
import { combineReducers, configureStore, type Middleware, type Reducer } from '@reduxjs/toolkit'
import { FLUSH, PAUSE, PERSIST, type PersistedState, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist'

import { shellReducers } from './shellState'

const hasError = (action: unknown): action is { error?: unknown } => typeof action === 'object' && action !== null && 'error' in action && Boolean(action.error)

const errorMiddleware: Middleware = () => (next) => (action) => {
  if (!hasError(action)) return next(action)
  return action
}

export interface PackStoreConfig {
  // On web every Tastic app shares one origin (games.infinitetoken.com) and so one localStorage,
  // where AsyncStorage keeps this state under keyPrefix + 'root': the default prefix would make every
  // app's state the same persist:root. REHYDRATE still reports key 'root'. It applies on native too.
  // This is the only key the pack writes itself (the shared profile roster is @tastic/profile's,
  // shared on purpose).
  keyPrefix: string
  // Every game's own store keys (see GameDefinition.reducers), beside the shell's.
  gameReducers: Record<string, Reducer>
  // redux-persist's migrate, run on the saved store before it rehydrates (see pack.ts).
  migrate?: (state: PersistedState, version: number) => Promise<PersistedState>
}

// The pack's one Redux store, persisted with redux-persist: the shell's keys (shellState.ts) plus
// every game's own.
export function createPackStore({ keyPrefix, gameReducers, migrate }: PackStoreConfig) {
  const rootReducer = combineReducers({ ...shellReducers, ...gameReducers })

  const persistedReducer = persistReducer(
    {
      key: 'root',
      keyPrefix,
      storage: AsyncStorage,
      // redux-persist defaults `timeout` to 5000ms: a failsafe setTimeout scheduled on every PERSIST
      // dispatch to force-resolve rehydrate if storage never responds. It's never cleared once
      // rehydrate resolves normally (only guarded by an internal `_sealed` flag), so it sits as a
      // pending timer for up to 5s after every store creation - under Jest that's a real open handle
      // ("A worker process has failed to exit gracefully"). Disabling it (falsy timeout skips the
      // setTimeout call entirely) is redux-persist's own documented way to opt out; AsyncStorage reads
      // failing to ever resolve at all isn't a failure mode worth a 5s failsafe for.
      timeout: 0,
      // liveplay is per-round state that must never survive a relaunch (see liveplaySlice.ts).
      blacklist: ['liveplay'],
      migrate
    },
    rootReducer
  )

  const store = configureStore({
    middleware: (getDefaultMiddleware) => {
      const defaultMiddleware = getDefaultMiddleware({
        immutableCheck: false,
        serializableCheck: {
          ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
        }
      })
      return defaultMiddleware.concat(errorMiddleware)
    },
    reducer: persistedReducer
  })

  const persistor = persistStore(store)
  return { store, persistor }
}

export type PackStore = ReturnType<typeof createPackStore>['store']
