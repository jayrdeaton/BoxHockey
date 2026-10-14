import { defaultColors } from '@rific/auto-paper'
import { ProfilesScreen } from '@tastic/profile'

import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { ControlScheme } from '@/types'
import { safeBack } from '@/utils/navigation'

// Neutral default (the swatch grid's own first color, not either seat's own current color) - a new
// profile isn't necessarily *for* whichever seat opened this screen (the whole point of a dedicated
// screen is P1 handing the phone to P2 to create theirs), and whoever it's for can always change
// their own profile's color later regardless. Mirrors LightCycles' identical NEW_PROFILE pattern
// (that sibling app has no controlScheme concept of its own, so the specific value doesn't need to
// match - just the "give a fresh profile a sensible default" shape). Matches
// redux/settingsSlice.ts's DEFAULT_SETTINGS.controlScheme, the app-wide default philosophy.
const NEW_PROFILE_CONTROL_SCHEME: ControlScheme = 'flick'

// A real routed screen - reachable only from P1's dropdown (see ProfilePicker's own doc for why P2
// can't host this: its zone is 180°-rotated in face-to-face mode, and the OS keyboard doesn't rotate
// with it). Reads useProfiles()/useGameStats() directly rather than taking them as props from
// loadout.tsx - there's nothing left for that screen to thread through once this is its own
// destination instead of conditionally-rendered state living on the loadout itself. Mirrors
// LightCycles' identically-shaped app/profiles.tsx, including its stats cleanup on delete - this app
// does have its own per-profile stats bucket (useGameStats' removeProfileStats), the same as
// LightCycles, so the earlier "BoxHockey has no per-profile stats to remove" note here was stale.
// The container View, back button, and theme-derived bg/fg all now live inside @tastic/profile's own
// ProfilesScreen - this only supplies what's genuinely app-specific: the extra controlScheme field
// this app's own createProfile needs beyond ProfileEditPatch's base name/color/tag shape.
export default function Profiles() {
  const { profiles, createProfile, updateProfile, deleteProfile } = useProfiles()
  // Only for wiring onDelete below - nothing else on this screen touches stats directly.
  const { removeProfileStats } = useGameStats()

  return (
    <ProfilesScreen
      profiles={profiles}
      defaultColor={defaultColors[0].value}
      onCreate={(patch) => createProfile({ ...patch, controlScheme: NEW_PROFILE_CONTROL_SCHEME })}
      onSave={(id, patch) => updateProfile(id, patch)}
      onDelete={(id) => {
        deleteProfile(id)
        removeProfileStats(id)
      }}
      onBack={safeBack}
    />
  )
}
