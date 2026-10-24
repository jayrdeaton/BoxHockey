import { defaultColors } from '@rific/auto-paper'
import { ProfilesScreen } from '@tastic/profile'

import { useProfiles } from '@/shell/hooks/useProfiles'
import { safeBack } from '@/shell/navigation'

// The Profiles screen (Manage, from either seat 1 button). Deleting a profile also removes its
// stats and achievements in every game: each game's reducers listen for the removal (see
// onProfileRemoved.ts).
export function ProfilesRoute() {
  const { profiles, createProfile, updateProfile, deleteProfile } = useProfiles()

  return <ProfilesScreen profiles={profiles} defaultColor={defaultColors[0].value} onCreate={(patch) => createProfile(patch)} onSave={(id, patch) => updateProfile(id, patch)} onDelete={deleteProfile} onBack={safeBack} />
}
