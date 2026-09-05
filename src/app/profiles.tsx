import { defaultColors, useAutoPaperTheme } from '@rific/auto-paper'
import { IconButton } from '@rific/feedback-press'
import { ProfilesManager, ProfilesManagerHandle } from '@tastic/profile'
import { useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { useProfiles } from '@/hooks/useProfiles'
import { ControlScheme } from '@/types'
import { safeBack } from '@/utils/navigation'

// Neutral default (the swatch grid's own first color, not either seat's own current color) — a new
// profile isn't necessarily *for* whichever seat opened this screen (the whole point of a dedicated
// screen is P1 handing the phone to P2 to create theirs), and whoever it's for can always change
// their own profile's color later regardless. Mirrors LightCycles' identical NEW_PROFILE default.
const NEW_PROFILE_CONTROL_SCHEME: ControlScheme = 'push'

// A real routed screen — reachable only from P1's dropdown (see ProfilePicker's own doc for why P2
// can't host this: its zone is 180°-rotated in face-to-face mode, and the OS keyboard doesn't rotate
// with it). Reads useProfiles() directly rather than taking it as props from loadout.tsx — there's
// nothing left for that screen to thread through once this is its own destination instead of
// conditionally-rendered state living on the loadout itself. Mirrors LightCycles' identically-shaped
// app/profiles.tsx, minus its own stats cleanup (BoxHockey has no per-profile stats to remove).
export default function ProfilesScreen() {
  const { dark } = useAutoPaperTheme()
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const { profiles, createProfile, updateProfile, deleteProfile } = useProfiles()
  // See LightCycles' identical comment in app/profiles.tsx for why this ref/handler pair is needed
  // — expo-router web keeps a popped screen mounted-but-hidden, so ProfilesManager's own
  // unmount-flush fallback never fires here without it.
  const managerRef = useRef<ProfilesManagerHandle>(null)

  const handleBack = () => {
    managerRef.current?.commitPendingEdit()
    safeBack()
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <ProfilesManager ref={managerRef} profiles={profiles} defaultColor={defaultColors[0].value} onCreate={(patch) => createProfile({ ...patch, controlScheme: NEW_PROFILE_CONTROL_SCHEME })} onSave={(id, patch) => updateProfile(id, patch)} onDelete={(id) => deleteProfile(id)} headerLeft={<IconButton icon='arrow-left' iconColor={fg} size={24} onPress={handleBack} accessibilityLabel='Back' />} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
})
