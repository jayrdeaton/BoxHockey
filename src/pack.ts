import AsyncStorage from '@react-native-async-storage/async-storage'
import { createReturningPlayerMigrate } from '@tastic/hud/guide'
import type { PersistedState } from 'redux-persist'

import { airHockey } from '@/games/airhockey'
import { boxHockey } from '@/games/boxhockey'
import { LEGACY_STORAGE_KEYS } from '@/games/boxhockey/redux/guideSlice'
import { breaker } from '@/games/breaker'
import { paddles } from '@/games/paddles'
import { createPackStore } from '@/shell/redux/createPackStore'
import type { GameDefinition, PackDefinition, SeatTwo } from '@/shell/types'

// PuckTastic: the pack's identity and its games, in Home's order. Box Hockey first: it's the star,
// and the game BoxHockey 1.0 shipped as. The App Store record, bundle id, EAS project and URL scheme
// all stay BoxHockey's (see app.json).
export const games: readonly GameDefinition[] = [boxHockey, airHockey, paddles, breaker]

export const pack: PackDefinition = {
  name: 'PuckTastic',
  wordmark: ['PUCK', 'TASTIC'],
  colorCaption: 'PuckTastic only',
  games
}

// BoxHockey 1.0 kept Lock Orientation, Edge Guard and the last mode picked on Home inside Box
// Hockey's own `settings`. Once, on the first launch of a pack build, seed the pack-wide settings
// and seat 2 from them; Box Hockey's own keys stay exactly as 1.0 saved them (no migration). A store
// that already has `appSettings` passes through untouched.
interface LegacySettings {
  gameMode?: 'twoPlayer' | 'vsCpu'
  lockOrientation?: boolean
  lockedRotation?: unknown
  deferBottomEdgeGestures?: boolean
}

export function seedFromBoxHockey(state: PersistedState): PersistedState {
  const saved = state as (PersistedState & { appSettings?: unknown; settings?: LegacySettings }) | undefined
  if (!saved || saved.appSettings !== undefined || !saved.settings) return state
  const { gameMode, lockOrientation, lockedRotation, deferBottomEdgeGestures } = saved.settings
  const seatTwo: SeatTwo = gameMode === 'vsCpu' ? 'cpu' : 'person'
  return {
    ...saved,
    appSettings: { lockOrientation: lockOrientation ?? false, deferBottomEdgeGestures: deferBottomEdgeGestures ?? false, ...(lockedRotation !== undefined ? { lockedRotation } : {}) },
    opponent: { seatTwo }
  } as PersistedState
}

// Grandfathers players from BoxHockey's shipped pre-redux builds past Box Hockey's How to Play cards
// (see LEGACY_STORAGE_KEYS), then seeds the pack-wide settings from 1.0's.
const returningPlayerMigrate = createReturningPlayerMigrate(AsyncStorage, LEGACY_STORAGE_KEYS)
async function migrate(state: PersistedState, version: number): Promise<PersistedState> {
  return seedFromBoxHockey(await returningPlayerMigrate(state, version))
}

// The one store. Its keyPrefix stays 'boxhockey:' (BoxHockey 1.0's) so a 1.0 player's saved state
// is the one this build reads.
export const { store, persistor } = createPackStore({
  keyPrefix: 'boxhockey:',
  gameReducers: Object.assign({}, ...games.map((g) => g.reducers)),
  migrate
})
