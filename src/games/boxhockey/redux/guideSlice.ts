import { createGuideSlice } from '@tastic/hud/guide'

import { GUIDE_VERSION } from '@/games/boxhockey/constants/guide'

// Thin binding over @tastic/hud/guide's createGuideSlice factory: the persisted "which version of the
// how-to-play flow has this player finished or skipped" flag. A fresh install starts at 0 (the guide
// auto-shows on Home); a player who already had the app before this slice existed is stamped with
// GUIDE_VERSION on their first rehydrate, so an over-the-air update never greets them with a "how to
// play" screen (see the factory's own doc for how it tells the two apart, and LEGACY_STORAGE_KEYS
// below for the players it can't tell apart on its own). Mounted under `guide` in store.ts (that key
// is what the REHYDRATE payload is read from), and store.ts's persistConfig key is 'root', the
// factory's default persistKey, so no options beyond the version are needed.
const slice = createGuideSlice({ currentVersion: GUIDE_VERSION })

export const guideActions = slice.actions
export const selectGuideVersionSeen = slice.selectVersionSeen
export default slice.reducer

// Every AsyncStorage key BoxHockey's shipped builds wrote, for store.ts's createReturningPlayerMigrate.
// The redux-persist root store only arrived in 2af01a6 (2026-09-14), after the last shipped update, so
// no shipped player has one: without this, their first launch of a guide build would look exactly
// like a fresh install. No root store but any of these keys means "played a shipped build".
//
// Read from the last shipped build, ad363aa (otaVersion 5, 2026-08-24); otaVersion 2 to 4 (7b197fb,
// a3824b2, ee5f699) wrote the same five, and otaVersion 1 (28ce396) wrote nothing at all.
// - boxhockey.settings: hooks/useGameSettings.tsx, on any settings change, including picking One
//   Player or Two Player on Home, so every player who ever started a match has it.
// - boxhockey.appearance, boxhockey.playerColors: components/Theme.tsx, on an appearance or player
//   color change.
// - boxhockey.vibrate, boxhockey.sound: components/Feedback.tsx, on a haptics or sound toggle.
// That build recorded no stats or achievements (useGameStats, boxhockey.stats and
// boxhockey.achievements arrived in 2d44b5f, 2026-09-05), and none of its @rific/@tastic packages
// wrote storage of their own.
//
// Literal strings, not today's constants: this is a record of what those builds wrote, and must not
// change if today's code ever renames a key. Today's build no longer writes boxhockey.settings at all
// (settings live in the Redux store since 2026-10-07), so a fresh install can't have it when the
// migrate runs.
//
// The root store itself moved from persist:root to boxhockey:root on 2026-10-19 (store.ts's keyPrefix:
// a colon, so it can never be one of these dotted keys). persist:root is deliberately not listed: no
// shipped build wrote it, and on the web it is the key every game on games.infinitetoken.com used to
// share, so finding it says nothing about this player having played BoxHockey.
export const LEGACY_STORAGE_KEYS: readonly string[] = ['boxhockey.appearance', 'boxhockey.playerColors', 'boxhockey.settings', 'boxhockey.sound', 'boxhockey.vibrate']
