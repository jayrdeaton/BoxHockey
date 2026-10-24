import { createProfileExtensionSlice } from '@tastic/profile'

import { ControlScheme } from '@/games/boxhockey/types'
import { onProfileRemoved } from '@/shell/redux/onProfileRemoved'

// This app's own per-profile extension data - controlScheme (LightCycles' analogous field is
// keyScheme) - kept entirely local, always, whether or not the shared App Group store is
// available: it never travels through @tastic/profile's shared base roster (a profile created on
// another @tastic game has no controlScheme of its own at all), same rationale as
// profileSelectionSlice's lastSelected. Keyed by profile id rather than by seat - unlike
// lastSelected, a controlScheme preference belongs to the PROFILE (see useProfiles.tsx's own merge
// into the public Profile shape), not to whichever seat currently has it selected.
//
// The Record<profileId, TExtension> reducer itself (set/remove) is @tastic/profile's own
// createProfileExtensionSlice factory - this file just supplies the namespace and the
// app-specific extension shape.
export interface ProfileExtension {
  controlScheme: ControlScheme
}

const { actions: profileExtensionsActions, reducer: profileExtensionsReducer } = createProfileExtensionSlice<ProfileExtension>('controlScheme')

export { profileExtensionsActions }
// A profile deleted on the Profiles screen takes its saved shot style with it.
export default onProfileRemoved(profileExtensionsReducer, (state, profileId) => profileExtensionsReducer(state, profileExtensionsActions.remove(profileId)))
