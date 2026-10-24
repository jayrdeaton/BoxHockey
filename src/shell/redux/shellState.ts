import { createThemeReducer, getThirdColor } from '@rific/auto-paper'
import { keepAwakeReducer } from '@rific/core'
import { defaultSoundSettings, hapticReducer, soundReducer, type SoundSettings } from '@rific/feedback-press'
import { profilesReducer } from '@tastic/profile'

import { DEFAULT_SEAT_COLORS } from '@/shell/seatColors'

import appSettings from './appSettingsSlice'
import liveplay from './liveplaySlice'
import opponent from './opponentSlice'
import profileSelection from './profileSelectionSlice'
import seatColors from './seatColorsSlice'

// @rific/feedback-press's own soundReducer defaults `enabled` to true unconditionally (that
// default isn't published with the dev-only override yet). Wrap it so a fresh install with no
// persisted preference (redux-persist finds nothing in AsyncStorage for the `sound` key) defaults
// muted in dev/simulator builds so Claude/local testing doesn't blast audio; production builds
// still default to sound on. All actual action handling still delegates to the package's reducer.
const initialSoundSettings: SoundSettings = { ...defaultSoundSettings, enabled: !__DEV__ }
const appSoundReducer = (state: SoundSettings = initialSoundSettings, action: { type: string }): SoundSettings => soundReducer(state, action)

// Explicit primary/secondary triad (rather than a single seed expanded via harmony) so the pack's
// red/blue identity is pinned exactly instead of drifting with whatever hue math a harmony offset
// would produce. Primary/secondary ARE player 1/player 2's own default colors (DEFAULT_SEAT_COLORS),
// so the theme and the default guest colors (seatColorsSlice.ts) can never drift apart. Tertiary is
// derived, not picked, via getThirdColor: the hue maximally distant from both (see
// @rific/auto-paper's README "Explicit triad" section).
const themeReducer = createThemeReducer({
  color: { primary: DEFAULT_SEAT_COLORS[1], secondary: DEFAULT_SEAT_COLORS[2], tertiary: getThirdColor(DEFAULT_SEAT_COLORS[1], DEFAULT_SEAT_COLORS[2]) }
})

// The store keys every pack has, whatever its games. Each game adds its own keys beside these (see
// GameDefinition.reducers).
export const shellReducers = {
  theme: themeReducer,
  haptic: hapticReducer,
  sound: appSoundReducer,
  // @rific/core's Keep Awake setting (see Providers.tsx's KeepAwakeBridge), under the namespace its
  // REHYDRATE handling expects.
  keepAwake: keepAwakeReducer,
  // The shared App Group roster (see @tastic/profile's resolveInitialProfiles/
  // useSharedProfilesSync, wired in hooks/useProfiles.tsx) is layered on top of this as a separate
  // sync target - this slice persisting normally via redux-persist is what gives it local-fallback
  // behavior where the shared store isn't available, with no separate AsyncStorage path.
  profiles: profilesReducer,
  profileSelection,
  // The loadout's "remember this color for next time" memory (guest, CPU, and each profile's pick
  // in this pack) - separate from `theme` above, which always reflects whatever's live right now.
  seatColors,
  appSettings,
  opponent,
  // Transient per-round state, the one key blacklisted from persistence (see liveplaySlice.ts).
  liveplay
}

export type ShellState = { [K in keyof typeof shellReducers]: ReturnType<(typeof shellReducers)[K]> }
