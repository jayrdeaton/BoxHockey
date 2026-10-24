import AsyncStorage from '@react-native-async-storage/async-storage'

import { airHockey } from '@/games/airhockey'
import { boxHockey } from '@/games/boxhockey'
import { breaker } from '@/games/breaker'
import { paddles } from '@/games/paddles'
import { createBoxHockey1Import } from '@/importBoxHockey1'
import { createPackStore } from '@/shell/redux/createPackStore'
import type { GameDefinition, PackDefinition } from '@/shell/types'

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

// The one store, saved under 'pucktastic:root', every game's keys named for it. A BoxHockey 1.0 save
// (under 'boxhockey:root', Box Hockey's keys unprefixed) is copied over once, on the first launch of a
// pack build (see importBoxHockey1.ts). Never change this prefix or a key now: every player would
// start over.
export const { store, persistor } = createPackStore({
  keyPrefix: 'pucktastic:',
  gameReducers: Object.assign({}, ...games.map((g) => g.reducers)),
  migrate: createBoxHockey1Import(AsyncStorage)
})
