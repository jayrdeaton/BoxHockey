import { isValidProfile as isValidBaseProfile, MAX_PROFILE_NAME_LENGTH, MAX_TAG_LENGTH, Profile as BaseProfile } from '@tastic/profile'

import { ControlScheme, Player, Profile } from '@/types'

// Pulled out of hooks/useProfiles.tsx specifically so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment (its native module is never linked there) — mirrors gameSettingsValidation.ts.
//
// The base identity fields (name/color/tag/timestamps) are validated by @tastic/profile's own
// isValidProfile/isValidTag. controlScheme (this app's own extension field — LightCycles' analogous
// field is keyScheme) is validated here, but as of the shared-roster feature (see useProfiles.tsx's
// own top doc comment) it's stored SEPARATELY from the base fields, never persisted as one blob —
// see LocalProfilesState below.

export { MAX_PROFILE_NAME_LENGTH, MAX_TAG_LENGTH }
export { isValidTag } from '@tastic/profile'

export interface ProfileExtension {
  controlScheme: ControlScheme
}

// What this app actually persists locally now. `localBase` is only read/written when the shared
// App Group store is unavailable (see isSharedProfileStoreAvailable in useProfiles.tsx) — this
// app's own complete fallback roster, in exactly the shape a solo (non-shared) install would have
// used. `extensions` is this app's own per-profile controlScheme, keyed by profile id — always
// local, whether or not the shared store is available, since it never travels through it (a profile
// created on another @tastic app has no controlScheme of its own at all). `lastSelected` is likewise
// always local — which profile P1/P2 last picked is naturally a per-app thing, not a cross-app one.
export interface LocalProfilesState {
  localBase: BaseProfile[]
  extensions: Record<string, ProfileExtension>
  lastSelected: Record<Player, string | null>
}

export const DEFAULT_LOCAL_PROFILES_STATE: LocalProfilesState = {
  localBase: [],
  extensions: {},
  lastSelected: { 1: null, 2: null }
}

// Pre-shared-roster storage shape — a single flat `profiles: Profile[]`, controlScheme baked
// straight into each entry, the only shape this app ever wrote under STORAGE_KEY before this
// feature existed. Kept only so migrateLegacyProfilesState below can upgrade an already-installed
// app's existing saved roster into the new split shape instead of silently losing it the first time
// this version loads.
interface LegacyProfilesState {
  profiles: Profile[]
  lastSelected: Record<Player, string | null>
}

function isValidControlScheme(value: unknown): value is ControlScheme {
  return value === 'pull' || value === 'push' || value === 'flick'
}

// Full, merged shape — used only to validate a LEGACY stored blob (see migrateLegacyProfilesState)
// and by useProfiles.tsx's own in-memory merge of base + extension. Not persisted as one blob
// anymore, so nothing else in this file reads/writes a value of this shape directly.
export function isValidProfile(value: unknown): value is Profile {
  return isValidBaseProfile(value) && isValidControlScheme((value as Partial<Profile>).controlScheme)
}

function isValidExtension(value: unknown): value is ProfileExtension {
  if (!value || typeof value !== 'object') return false
  return isValidControlScheme((value as Partial<ProfileExtension>).controlScheme)
}

function isValidExtensions(value: unknown): value is Record<string, ProfileExtension> {
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every(isValidExtension)
}

function isValidSeatProfileId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0)
}

function isValidLastSelected(value: unknown): value is Record<Player, string | null> {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Record<Player, string | null>>
  return isValidSeatProfileId(v[1]) && isValidSeatProfileId(v[2])
}

// All-or-nothing, matching gameSettingsValidation.ts's isValidSettings: one malformed entry
// anywhere invalidates the whole blob rather than silently dropping just that entry.
export function isValidLocalProfilesState(value: unknown): value is LocalProfilesState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<LocalProfilesState>
  return Array.isArray(v.localBase) && v.localBase.every(isValidBaseProfile) && isValidExtensions(v.extensions) && isValidLastSelected(v.lastSelected)
}

function isValidLegacyProfilesState(value: unknown): value is LegacyProfilesState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<LegacyProfilesState>
  return Array.isArray(v.profiles) && v.profiles.every(isValidProfile) && isValidLastSelected(v.lastSelected)
}

// One-time upgrade path: an already-installed app's pre-shared-roster save (see LegacyProfilesState
// above) still has every full profile — base fields and controlScheme baked into one record — under
// the same storage key this version now expects a LocalProfilesState at. Rather than let
// isValidLocalProfilesState simply reject that old shape (and silently drop every saved profile the
// first time this version loads), this splits each legacy entry into its base fields (localBase)
// and its controlScheme (extensions) — exactly the shape a freshly-created profile ends up in under
// the new split. Returns null for anything that's neither a valid current nor a valid legacy blob
// (corrupt/unrecognized), same "keep defaults" fallback the caller already had for a corrupt blob.
export function migrateLegacyProfilesState(value: unknown): LocalProfilesState | null {
  if (!isValidLegacyProfilesState(value)) return null
  const localBase: BaseProfile[] = []
  const extensions: Record<string, ProfileExtension> = {}
  for (const p of value.profiles) {
    localBase.push({ id: p.id, name: p.name, color: p.color, tag: p.tag, createdAt: p.createdAt, updatedAt: p.updatedAt })
    extensions[p.id] = { controlScheme: p.controlScheme }
  }
  return { localBase, extensions, lastSelected: value.lastSelected }
}
