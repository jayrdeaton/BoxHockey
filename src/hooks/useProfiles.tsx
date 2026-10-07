import { createProfileRecord, type Profile as BaseProfile, profilesActions, resolveInitialProfiles, useSharedProfilesSync } from '@tastic/profile'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { profileExtensionsActions } from '@/redux/profileExtensionsSlice'
import { profileSelectionActions } from '@/redux/profileSelectionSlice'
import { type AppDispatch, type RootState } from '@/redux/store'
import { ControlScheme, Player, Profile } from '@/types'

// Same group id BoxHockey and LightCycles both declare in app.json's ios.entitlements (and any
// future @tastic game that wants into the same shared roster) — see @tastic/profile's own README
// for why only the BASE identity fields travel through this, never controlScheme.
const SHARED_GROUP_ID = 'group.com.infinitetoken.tastic'
// Matches Settings.controlScheme's own default (see redux/settingsSlice.ts's
// DEFAULT_SETTINGS) — what a profile that's never had one set locally on THIS app falls back to.
// That's exactly the state of any profile created on another @tastic app (LightCycles has no
// concept of controlScheme at all) the very first time it's selected here.
const DEFAULT_CONTROL_SCHEME: ControlScheme = 'flick'

interface CreateProfileInput {
  name: string
  color: string
  tag: string
  controlScheme: ControlScheme
}

interface ProfilesContextValue {
  profiles: Profile[]
  lastSelected: Record<Player, string | null>
  createProfile: (input: CreateProfileInput) => Profile
  updateProfile: (id: string, patch: Partial<CreateProfileInput>) => void
  // Also clears lastSelected for any seat currently pointing at this id, so /loadout immediately
  // reflects Player (no profile) for that seat rather than a dangling id until next reload.
  deleteProfile: (id: string) => void
  selectProfile: (seat: Player, profileId: string | null) => void
  // True once the one-time initial reconciliation below (redux-persist's own already-rehydrated
  // `profiles` against the shared App Group store) has completed — see ProfilesProvider's own doc.
  // _layout.tsx's own GatedApp reads this directly to gate the 'profiles' splash key, same as it
  // already does for useSettings()'s own `loaded`.
  loaded: boolean
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null)

interface Props {
  children: ReactNode
}

// Single source of truth for saved player profiles, mounted once in _layout.tsx — same
// single-Provider rationale as useGameStats.tsx (expo-router keeps prior screens mounted, so a
// per-screen copy could go stale or clobber a concurrent update).
//
// Base identity fields (name/color/tag) now live in Redux (redux/store.ts's `profiles` key,
// @tastic/profile's own profilesReducer) — persisted locally the same way every other slice is
// (redux-persist), with the shared App Group roster layered on top as a separate, cross-app sync
// target (see resolveInitialProfiles/useSharedProfilesSync below) — no separate hand-rolled
// AsyncStorage fallback path needed for that case anymore. controlScheme is BoxHockey's own
// per-profile extension field (LightCycles' analogous field is keyScheme) and deliberately does
// NOT travel through the shared store — it lives entirely in its own redux/profileExtensionsSlice.ts,
// keyed by profile id, and merged onto the shared base roster in the `profiles` value below, falling
// back to DEFAULT_CONTROL_SCHEME the first time a profile created on another app shows up here.
// `lastSelected` is its own small redux/profileSelectionSlice.ts — which profile seat 1/2 last
// picked is naturally a per-app thing, never shared cross-app.
export function ProfilesProvider({ children }: Props) {
  const baseProfiles = useSelector((state: RootState) => state.profiles)
  const extensions = useSelector((state: RootState) => state.profileExtensions)
  const lastSelected = useSelector((state: RootState) => state.profileSelection)
  const dispatch = useDispatch<AppDispatch>()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    // PersistGate (an ancestor — see components/Providers.tsx) already blocks this component from
    // mounting until redux-persist has rehydrated, so `baseProfiles` here is already whatever this
    // device last had locally — resolveInitialProfiles reconciles that against the shared App
    // Group store (if available), seeding the shared store from it on a first sync, or preferring
    // the shared roster once anything has been shared. A one-time reconciliation against the
    // mount-time snapshot, deliberately not a resync whenever `baseProfiles` changes afterward (the
    // empty deps array below is intentional, not a missed dependency — resolved's own setAll
    // dispatch would otherwise re-trigger this effect).
    resolveInitialProfiles(SHARED_GROUP_ID, baseProfiles).then((resolved) => {
      if (cancelled) return
      dispatch(profilesActions.setAll(resolved))
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirrors local writes out to the shared store (syncToShared, called from each CRUD function
  // below) and picks up remote writes a sibling @tastic app made while this one was backgrounded
  // (onRemoteChange) — see @tastic/profile's own doc for both. controlScheme never travels through
  // this — a remote change only ever replaces the base roster, same as before this migration.
  const { syncToShared } = useSharedProfilesSync({
    groupId: SHARED_GROUP_ID,
    onRemoteChange: useCallback((remote: BaseProfile[]) => dispatch(profilesActions.setAll(remote)), [dispatch])
  })

  const createProfile = useCallback(
    (input: CreateProfileInput) => {
      const record = createProfileRecord(input)
      dispatch(profilesActions.add(record))
      syncToShared([...baseProfiles, record])
      dispatch(profileExtensionsActions.set({ extension: { controlScheme: input.controlScheme }, id: record.id }))
      return { ...record, controlScheme: input.controlScheme }
    },
    [baseProfiles, dispatch, syncToShared]
  )

  const updateProfile = useCallback(
    (id: string, patch: Partial<CreateProfileInput>) => {
      // Routed to whichever slice actually owns each field — name/color/tag to the (possibly
      // shared) base roster, controlScheme to this app's own local extension table. A single call
      // can touch both (see ProfilesManager's onSave, which always patches all three base fields
      // at once) or just one (loadout.tsx's own control-scheme sync-back, patch-of-one) — two
      // independent dispatches in the same handler, not a stale-closure risk now that both live in
      // Redux (see profileSelectionSlice.ts's identical reasoning).
      const { controlScheme, ...baseChanges } = patch
      if (Object.keys(baseChanges).length > 0) {
        dispatch(profilesActions.update({ id, patch: baseChanges }))
        syncToShared(baseProfiles.map((p) => (p.id === id ? { ...p, ...baseChanges, updatedAt: Date.now() } : p)))
      }
      if (controlScheme !== undefined) {
        dispatch(profileExtensionsActions.set({ extension: { controlScheme }, id }))
      }
    },
    [baseProfiles, dispatch, syncToShared]
  )

  const deleteProfile = useCallback(
    (id: string) => {
      dispatch(profilesActions.remove(id))
      syncToShared(baseProfiles.filter((p) => p.id !== id))
      dispatch(profileExtensionsActions.remove(id))
      dispatch(profileSelectionActions.clearProfile(id))
    },
    [baseProfiles, dispatch, syncToShared]
  )

  const selectProfile = useCallback(
    (seat: Player, profileId: string | null) => {
      dispatch(profileSelectionActions.select({ profileId, seat }))
    },
    [dispatch]
  )

  const profiles: Profile[] = baseProfiles.map((p) => ({ ...p, controlScheme: extensions[p.id]?.controlScheme ?? DEFAULT_CONTROL_SCHEME }))

  return <ProfilesContext.Provider value={{ profiles, lastSelected, createProfile, updateProfile, deleteProfile, selectProfile, loaded }}>{children}</ProfilesContext.Provider>
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used within a ProfilesProvider')
  return ctx
}
