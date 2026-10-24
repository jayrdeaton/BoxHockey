import type { PersistedState } from 'redux-persist'

import { seatPlayerKey } from '@/shared/playerSettings'

// The one-time import of a BoxHockey 1.0 save into PuckTastic's store (pack.ts's migrate). 1.0 saved
// under 'boxhockey:root' with Box Hockey's keys unprefixed; the pack saves under 'pucktastic:root'
// with every game's keys named for it. On the first launch of a pack build (no pack save yet), a 1.0
// save is copied over under the new names and shapes, so a 1.0 player keeps their stats,
// achievements, settings and preferences. Every later launch finds the pack save and does nothing. The 1.0 save is left in
// storage, unread from then on.
//
// Temporary (Jay, 2026-10-24): delete this file and pack.ts's migrate once nearly everyone has
// updated past 1.0, no earlier than six months after 2.0 ships and not before May 2027 (TODO.md has
// the steps). A 1.0 player who skips every update until then starts fresh.

const OLD_KEY = 'boxhockey:root'

// What 1.0's Box Hockey settings held that is the pack's now: Lock Orientation and its angle, and
// Edge Guard (appSettings), and the last mode picked on 1.0's Home (seat 2, opponent). Each seat's
// shot style is per player now (boxhockeyControls).
interface OneZeroSettings {
  gameMode?: 'twoPlayer' | 'vsCpu'
  lockOrientation?: boolean
  lockedRotation?: unknown
  deferBottomEdgeGestures?: boolean
  controlScheme?: Record<Seat, string>
  [field: string]: unknown
}

type Seat = 1 | 2
const SEATS: readonly Seat[] = [1, 2]

// 1.0's keys that are the pack's under the same names (the same slices, shell-wide now).
const SAME_KEYS = ['theme', 'haptic', 'sound', 'keepAwake', 'profiles', 'profileSelection', 'seatColors'] as const

// 1.0's Box Hockey keys and their names in the pack.
const RENAMED_KEYS = { achievements: 'boxhockeyAchievements', guide: 'boxhockeyGuide' } as const

export interface StorageReader {
  getItem: (key: string) => Promise<string | null>
}

// redux-persist saves the root as a JSON object whose every value is itself a JSON string.
function readOneZeroSave(text: string): Record<string, unknown> {
  const outer = JSON.parse(text) as Record<string, string>
  return Object.fromEntries(Object.entries(outer).map(([key, value]) => [key, JSON.parse(value)]))
}

// A 1.0 save under the pack's names, or nothing to import.
export function importBoxHockey1(saved: Record<string, unknown>): Record<string, unknown> {
  const imported: Record<string, unknown> = {}
  for (const key of SAME_KEYS) if (saved[key] !== undefined) imported[key] = saved[key]
  for (const [from, to] of Object.entries(RENAMED_KEYS)) if (saved[from] !== undefined) imported[to] = saved[from]

  const settings = saved.settings as OneZeroSettings | undefined
  const selection = { 1: null, 2: null, ...(saved.profileSelection as Partial<Record<Seat, string | null>> | undefined) }
  const player = (seat: Seat) => seatPlayerKey(selection, seat)
  if (settings) {
    const { gameMode, lockOrientation, lockedRotation, deferBottomEdgeGestures, controlScheme: _controlScheme, ...match } = settings
    // 1.0 had one setup for everyone, last set up from seat 1, so it's seat 1's player's own now
    // (the guest, or the profile 1.0 had in seat 1, who loads it). Anyone else starts on the defaults.
    imported.boxhockeySettings = { [player(1)]: match }
    imported.appSettings = { lockOrientation: lockOrientation ?? false, deferBottomEdgeGestures: deferBottomEdgeGestures ?? false, ...(lockedRotation !== undefined ? { lockedRotation } : {}) }
    imported.opponent = { seatTwo: gameMode === 'twoPlayer' ? 'person' : 'cpu' }
  }

  // Each seat's shot style goes to the player in it. A profile's own pick (1.0's profileExtensions,
  // saved whenever it chose one) wins over the style it only inherited from its seat.
  const controls: Record<string, string> = {}
  for (const seat of SEATS) if (settings?.controlScheme?.[seat]) controls[player(seat)] = settings.controlScheme[seat]
  const extensions = saved.profileExtensions as Record<string, { controlScheme?: string }> | undefined
  for (const [id, extension] of Object.entries(extensions ?? {})) if (extension?.controlScheme) controls[id] = extension.controlScheme
  if (Object.keys(controls).length > 0) imported.boxhockeyControls = controls
  return imported
}

// pack.ts's migrate: redux-persist hands it the pack's own save (undefined on the first launch of a
// pack build), and rehydrates the store from what it returns.
export function createBoxHockey1Import(storage: StorageReader) {
  return async function migrate(state: PersistedState): Promise<PersistedState> {
    if (state) return state
    try {
      const text = await storage.getItem(OLD_KEY)
      if (!text) return state
      return importBoxHockey1(readOneZeroSave(text)) as PersistedState
    } catch {
      // An unreadable 1.0 save starts fresh, like a new install.
      return state
    }
  }
}
