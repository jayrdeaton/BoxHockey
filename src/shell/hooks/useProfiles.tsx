import { type CreateProfileInput, createProfileRecord, Profile, profilesActions, resolveInitialProfiles, useSharedProfilesSync } from '@tastic/profile'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { Action, Dispatch } from 'redux'

import { profileSelectionActions } from '@/shell/redux/profileSelectionSlice'
import type { ShellState } from '@/shell/redux/shellState'
import type { Seat } from '@/shell/types'

// Same group id BoxHockey and LightCycles both declare in app.json's ios.entitlements (and any
// future @tastic game that wants into the same shared roster) - see @tastic/profile's own README
// for why only the base identity fields travel through this.
const SHARED_GROUP_ID = 'group.com.infinitetoken.tastic'

interface ProfilesContextValue {
  profiles: Profile[]
  lastSelected: Record<Seat, string | null>
  // True once the one-time initial reconciliation below (redux-persist's own already-rehydrated
  // `profiles` against the shared App Group store) has completed - see ProfilesProvider's own doc.
  // RootLayout's GatedApp reads this to hold its children back (see splashGate.ts's
  // 'profiles' gate) until real profile data exists, rather than the empty starting state.
  loaded: boolean
  createProfile: (input: CreateProfileInput) => Profile
  updateProfile: (id: string, patch: Partial<CreateProfileInput>) => void
  // Also clears lastSelected for any seat currently pointing at this id, so /loadout immediately
  // reflects Player (no profile) for that seat rather than a dangling id until next reload.
  deleteProfile: (id: string) => void
  selectProfile: (seat: Seat, profileId: string | null) => void
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null)

interface Props {
  children: ReactNode
}

// Single source of truth for saved player profiles, mounted once at the root (RootLayout): expo-router
// keeps prior screens mounted, so a per-screen copy could go stale or clobber a concurrent update.
//
// `profiles` lives in Redux (the shell's `profiles` key, @tastic/profile's own profilesReducer),
// persisted locally like every other key, with the shared App Group roster layered on top as a
// separate, cross-app sync target (see resolveInitialProfiles/useSharedProfilesSync below).
// `lastSelected` is profileSelectionSlice.ts: which profile seat 1/2 last picked is a per-app thing,
// never shared cross-app. Only the base identity fields live here; a game that keeps something per
// profile (Box Hockey's control scheme) keeps it in its own slice.
//
// Gating stays external (RootLayout's GatedApp holds the app behind the 'profiles' splash gate
// until `loaded`); this provider just exposes `loaded` and always renders `children` at once.
export function ProfilesProvider({ children }: Props) {
  const profiles = useSelector((state: ShellState) => state.profiles)
  const lastSelected = useSelector((state: ShellState) => state.profileSelection)
  const dispatch = useDispatch<Dispatch<Action>>()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    // PersistGate (an ancestor - see components/Providers.tsx) already blocks this component from
    // mounting until redux-persist has rehydrated, so `profiles` here is already whatever this
    // device last had locally - resolveInitialProfiles reconciles that against the shared App
    // Group store (if available), seeding the shared store from it on a first sync, or preferring
    // the shared roster once anything has been shared. A one-time reconciliation against the
    // mount-time snapshot, deliberately not a resync whenever `profiles` changes afterward (the
    // empty deps array below is intentional, not a missed dependency - resolveInitialProfiles' own
    // setAll dispatch would otherwise re-trigger this effect).
    resolveInitialProfiles(SHARED_GROUP_ID, profiles).then((resolved) => {
      if (cancelled) return
      dispatch(profilesActions.setAll(resolved))
      // A seat can still point at a profile a sibling app deleted since this device last ran.
      dispatch(profileSelectionActions.pruneToRoster(resolved.map((p) => p.id)))
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirrors local writes out to the shared store (syncToShared, called from each CRUD function
  // below) and picks up remote writes a sibling @tastic app made while this one was backgrounded
  // (onRemoteChange) - see @tastic/profile's own doc for both.
  const { syncToShared } = useSharedProfilesSync({
    groupId: SHARED_GROUP_ID,
    onRemoteChange: useCallback(
      (remote: Profile[]) => {
        dispatch(profilesActions.setAll(remote))
        // Same job as deleteProfile's clearProfile below, for profiles a sibling app deleted while this one was backgrounded.
        dispatch(profileSelectionActions.pruneToRoster(remote.map((p) => p.id)))
      },
      [dispatch]
    )
  })

  const createProfile = useCallback(
    (input: CreateProfileInput) => {
      const record = createProfileRecord(input)
      dispatch(profilesActions.add(record))
      syncToShared([...profiles, record])
      return record
    },
    [profiles, dispatch, syncToShared]
  )

  const updateProfile = useCallback(
    (id: string, patch: Partial<CreateProfileInput>) => {
      dispatch(profilesActions.update({ id, patch }))
      syncToShared(profiles.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)))
    },
    [profiles, dispatch, syncToShared]
  )

  const deleteProfile = useCallback(
    (id: string) => {
      dispatch(profilesActions.remove(id))
      syncToShared(profiles.filter((p) => p.id !== id))
      dispatch(profileSelectionActions.clearProfile(id))
    },
    [profiles, dispatch, syncToShared]
  )

  const selectProfile = useCallback(
    (seat: Seat, profileId: string | null) => {
      dispatch(profileSelectionActions.select({ profileId, seat }))
    },
    [dispatch]
  )

  return <ProfilesContext.Provider value={{ profiles, lastSelected, loaded, createProfile, updateProfile, deleteProfile, selectProfile }}>{children}</ProfilesContext.Provider>
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used within a ProfilesProvider')
  return ctx
}
