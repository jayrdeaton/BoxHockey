import AsyncStorage from '@react-native-async-storage/async-storage'
import { isSharedProfileStoreAvailable, loadSharedProfiles, Profile as BaseProfile, saveSharedProfiles } from '@tastic/profile'
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { ControlScheme, Player, Profile } from '@/types'
import { DEFAULT_LOCAL_PROFILES_STATE, isValidLocalProfilesState, LocalProfilesState, migrateLegacyProfilesState } from '@/utils/profilesValidation'

const STORAGE_KEY = 'boxhockey.profiles'
// Same group id BoxHockey and LightCycles both declare in app.json's ios.entitlements (and any
// future @tastic game that wants into the same shared roster) — see @tastic/profile's own README
// for why only the BASE identity fields travel through this, never controlScheme.
const SHARED_GROUP_ID = 'group.com.infinitetoken.tastic'
// Matches GameSettings.controlScheme's own default (see gameSettingsValidation.ts's
// DEFAULT_SETTINGS) — what a profile that's never had one set locally on THIS app falls back to.
// That's exactly the state of any profile created on another @tastic app (LightCycles has no
// concept of controlScheme at all) the very first time it's selected here.
const DEFAULT_CONTROL_SCHEME: ControlScheme = 'push'

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
  // False until the initial load effect below has fully resolved — see splashGate.ts's 'profiles'
  // gate and _layout.tsx's GatedApp, which holds every screen reading `profiles`/`lastSelected` off
  // until this flips true.
  loaded: boolean
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null)

interface Props {
  children: ReactNode
}

function generateProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Single source of truth for saved player profiles, mounted once in _layout.tsx — same
// single-Provider rationale as useGameSettings.tsx (expo-router keeps prior screens mounted, so a
// per-screen AsyncStorage-backed copy could go stale or clobber a concurrent update).
//
// Base identity fields (name/color/tag) are shared with every other @tastic game declaring the same
// App Group entitlement (see SHARED_GROUP_ID and @tastic/profile's own loadSharedProfiles/
// saveSharedProfiles) — create a profile in LightCycles, it shows up here too, and vice versa.
// controlScheme is BoxHockey-specific (LightCycles' analogous field is keyScheme) and deliberately
// does NOT travel through that shared store — it's kept entirely in this app's own local
// `extensions` table (see LocalProfilesState in profilesValidation.ts), keyed by profile id, and
// merged onto the shared base roster in the `profiles` getter below, falling back to
// DEFAULT_CONTROL_SCHEME the first time a profile created on another app shows up here.
// isSharedProfileStoreAvailable is false on Android/web and on any iOS build that hasn't run
// `expo prebuild` since the entitlement was added — `local.localBase` (only ever read/written in
// that case) keeps this screen fully usable there too, just without cross-app sharing.
export function ProfilesProvider({ children }: Props) {
  const [local, setLocal] = useState<LocalProfilesState>(DEFAULT_LOCAL_PROFILES_STATE)
  // null until the initial load below resolves — distinguishes "still loading" from "loaded, and
  // genuinely empty," which matters for the one-time seed-from-local migration in that same effect.
  const [sharedBase, setSharedBase] = useState<BaseProfile[] | null>(null)
  // False until the initial load effect below has fully resolved — both the local AsyncStorage read
  // AND (when isSharedProfileStoreAvailable) the shared-store read, not just the first of the two —
  // see that effect's own two setLoaded(true) call sites, one per branch.
  const [loaded, setLoaded] = useState(false)
  // True for the duration of an in-flight saveSharedProfiles write — see persistBase and the
  // AppState foreground-reload effect below, which skips a refresh while this is true rather than
  // risk reading back a pre-write snapshot and reverting the change that's still landing.
  const pendingWriteRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let stored = DEFAULT_LOCAL_PROFILES_STATE
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          stored = isValidLocalProfilesState(parsed) ? parsed : (migrateLegacyProfilesState(parsed) ?? DEFAULT_LOCAL_PROFILES_STATE)
        }
      } catch {
        // Corrupt/stale blob or unavailable storage — DEFAULT_LOCAL_PROFILES_STATE is a complete,
        // silent fallback, same as useGameSettings.tsx.
      }
      if (cancelled) return
      setLocal(stored)

      if (!isSharedProfileStoreAvailable) {
        setSharedBase(stored.localBase)
        setLoaded(true)
        return
      }
      const shared = await loadSharedProfiles(SHARED_GROUP_ID)
      if (cancelled) return
      // First time this build has ever seen the shared store (a fresh install, or an existing
      // install's first launch after this feature shipped): seed it from whatever this app already
      // had saved locally, so an upgrading user's own profiles don't just vanish because nothing's
      // been written to the shared side yet. Only when the shared roster is still completely empty
      // — once ANYTHING has been shared (by this app or another), that always wins over a stale
      // local snapshot, never merged with it (avoids resurrecting a profile deleted elsewhere).
      const seeded = shared.length === 0 && stored.localBase.length > 0 ? stored.localBase : shared
      if (seeded !== shared) saveSharedProfiles(SHARED_GROUP_ID, seeded).catch(() => {})
      setSharedBase(seeded)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The shared store doesn't push — @tastic/profile's sharedProfileStore.ts is a plain
  // UserDefaults(suiteName:) read/write with no cross-process change notification. Re-reading on
  // foreground is what catches "created/edited a profile in the other app, then switched back to
  // this one" — otherwise sharedBase only ever reflects what this app itself last wrote, until the
  // next cold start. controlScheme lives entirely in local.extensions (untouched here), so this
  // only ever needs to replace the base roster. Skipped while pendingWriteRef is still true:
  // persistBase below never awaits its own saveSharedProfiles call, so backgrounding right after a
  // create/edit/delete and foregrounding again before that write actually lands could otherwise read
  // back a pre-write snapshot here and silently revert it. This only ever skips one redundant
  // refresh — the next real foreground event, by which point the write has landed, reads correctly.
  useEffect(() => {
    if (!isSharedProfileStoreAvailable) return
    let cancelled = false
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || pendingWriteRef.current) return
      loadSharedProfiles(SHARED_GROUP_ID).then((shared) => {
        if (!cancelled) setSharedBase(shared)
      })
    })
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  const persistLocal = useCallback((next: LocalProfilesState) => {
    setLocal(next)
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
  }, [])

  // Writes the base roster to whichever store is authoritative — the shared App Group roster when
  // available, this app's own local `localBase` fallback otherwise — and always updates the
  // in-memory sharedBase, which is the merge source for `profiles` below regardless of which
  // backend it actually came from. `extraLocalPatch` lets a caller fold an `extensions`/
  // `lastSelected` change into the SAME persistLocal call as the `localBase` write below, rather
  // than issuing a second call that would spread the stale pre-update `local` closure and silently
  // revert this one (both calls happen synchronously within one event handler, so `local` never
  // reflects the first call's setLocal by the time the second one reads it). saveSharedProfiles
  // itself never rejects (see @tastic/profile's own doc), so the trailing `.catch` below is just
  // defensive; pendingWriteRef is what the AppState foreground-reload effect above actually checks.
  const persistBase = useCallback(
    (next: BaseProfile[], extraLocalPatch?: Partial<LocalProfilesState>) => {
      setSharedBase(next)
      if (isSharedProfileStoreAvailable) {
        pendingWriteRef.current = true
        saveSharedProfiles(SHARED_GROUP_ID, next)
          .catch(() => {})
          .finally(() => {
            pendingWriteRef.current = false
          })
        if (extraLocalPatch) persistLocal({ ...local, ...extraLocalPatch })
      } else {
        persistLocal({ ...local, localBase: next, ...extraLocalPatch })
      }
    },
    [local, persistLocal]
  )

  const createProfile = useCallback(
    (input: CreateProfileInput) => {
      const now = Date.now()
      const profile: Profile = { id: generateProfileId(), name: input.name, color: input.color, tag: input.tag, controlScheme: input.controlScheme, createdAt: now, updatedAt: now }
      persistBase([...(sharedBase ?? []), { id: profile.id, name: profile.name, color: profile.color, tag: profile.tag, createdAt: now, updatedAt: now }], {
        extensions: { ...local.extensions, [profile.id]: { controlScheme: input.controlScheme } }
      })
      return profile
    },
    [sharedBase, local, persistBase]
  )

  const updateProfile = useCallback(
    (id: string, patch: Partial<CreateProfileInput>) => {
      // Routed to whichever store actually owns each field — name/color/tag to the (possibly
      // shared) base roster, controlScheme to this app's own local extension table. A single call
      // can touch both (see ProfilesManager's onSave, which always patches all three base fields
      // at once) or just one (loadout.tsx's own control-scheme sync-back, patch-of-one).
      const { controlScheme, ...baseChanges } = patch
      const controlSchemePatch: Partial<LocalProfilesState> | undefined = controlScheme !== undefined ? { extensions: { ...local.extensions, [id]: { controlScheme } } } : undefined
      if (Object.keys(baseChanges).length > 0) {
        const base = sharedBase ?? []
        persistBase(
          base.map((p) => (p.id === id ? { ...p, ...baseChanges, updatedAt: Date.now() } : p)),
          controlSchemePatch
        )
      } else if (controlSchemePatch) {
        persistLocal({ ...local, ...controlSchemePatch })
      }
    },
    [sharedBase, local, persistBase, persistLocal]
  )

  const deleteProfile = useCallback(
    (id: string) => {
      const extensions = { ...local.extensions }
      delete extensions[id]
      persistBase(
        (sharedBase ?? []).filter((p) => p.id !== id),
        {
          extensions,
          lastSelected: { 1: local.lastSelected[1] === id ? null : local.lastSelected[1], 2: local.lastSelected[2] === id ? null : local.lastSelected[2] }
        }
      )
    },
    [sharedBase, local, persistBase]
  )

  const selectProfile = useCallback(
    (seat: Player, profileId: string | null) => {
      persistLocal({ ...local, lastSelected: { ...local.lastSelected, [seat]: profileId } })
    },
    [local, persistLocal]
  )

  const profiles: Profile[] = (sharedBase ?? []).map((p) => ({ ...p, controlScheme: local.extensions[p.id]?.controlScheme ?? DEFAULT_CONTROL_SCHEME }))

  return <ProfilesContext.Provider value={{ profiles, lastSelected: local.lastSelected, createProfile, updateProfile, deleteProfile, selectProfile, loaded }}>{children}</ProfilesContext.Provider>
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used within a ProfilesProvider')
  return ctx
}
