import AsyncStorage from '@react-native-async-storage/async-storage'
import { getRgb, getThirdColor, Provider as AutoPaperProvider, ThemeSettings } from '@rific/auto-paper'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback, useEffect, useState } from 'react'

import { useSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()
// iOS defaults `fade` to false (Android always fades regardless of this flag), so without this the
// splash view is just yanked off screen the instant every gate reports ready.
SplashScreen.setOptions({ fade: true, duration: 400 })

const APPEARANCE_STORAGE_KEY = 'boxhockey.appearance'
// Cold-boot default before any seat-aware screen has mounted, and — from then on — the persisted
// fallback loadout.tsx uses for a human seat with no profile selected ("guest"). Reused for both
// instead of a redundant third key: a fresh boot has no seats yet, so "the last color a guest saw"
// is exactly the right default for it too. See loadout.tsx's own guest-color effect/handlers.
const GUEST_COLORS_STORAGE_KEY = 'boxhockey.playerColors'
// Independent of the guest slot above so a CPU opponent's color and a human guest's color don't
// fight over one remembered value — see loadout.tsx's own CPU-color effect/handlers. CPU only ever
// occupies player 2 (see utils/gameMode.ts's humanPlayersFor), so this is a single color, not a pair.
const CPU_COLOR_STORAGE_KEY = 'boxhockey.cpuColor'

export const DEFAULT_P1_COLOR = '#f44336'
export const DEFAULT_P2_COLOR = '#2196f3'

function triadFor(p1: string, p2: string) {
  return { primary: p1, secondary: p2, tertiary: getThirdColor(p1, p2) }
}

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && getRgb(value) !== null
}

export async function loadGuestColors(): Promise<{ p1: string; p2: string }> {
  const stored = await AsyncStorage.getItem(GUEST_COLORS_STORAGE_KEY)
  let p1 = DEFAULT_P1_COLOR
  let p2 = DEFAULT_P2_COLOR
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      if (isValidHex(parsed.p1)) p1 = parsed.p1
      if (isValidHex(parsed.p2)) p2 = parsed.p2
    } catch {
      // Corrupt/stale blob — fall back to defaults above.
    }
  }
  return { p1, p2 }
}

export function saveGuestColors(colors: { p1: string; p2: string }) {
  void AsyncStorage.setItem(GUEST_COLORS_STORAGE_KEY, JSON.stringify(colors))
}

export async function loadCpuColor(): Promise<string> {
  const stored = await AsyncStorage.getItem(CPU_COLOR_STORAGE_KEY)
  return isValidHex(stored) ? stored : DEFAULT_P2_COLOR
}

export function saveCpuColor(color: string) {
  void AsyncStorage.setItem(CPU_COLOR_STORAGE_KEY, color)
}

interface Props {
  children: ReactNode
}

export function Theme({ children }: Props) {
  const [settings, setSettings] = useState<Partial<ThemeSettings> | null>(null)

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(APPEARANCE_STORAGE_KEY), loadGuestColors()]).then(([storedAppearance, guest]) => {
      const appearance = storedAppearance === 'light' || storedAppearance === 'dark' || storedAppearance === 'system' ? storedAppearance : 'dark'
      setSettings({ appearance, color: triadFor(guest.p1, guest.p2) })
    })
  }, [])

  // Loaded settings gate mounting AutoPaperProvider entirely (rather than mounting it immediately
  // with defaults and patching `initialValue` once the read resolves): AutoPaperProvider's own
  // `settings` state is a lazy useState(() => ...) that only reads `initialValue` on its very first
  // mount, so a changed `initialValue` prop on a later render is silently ignored — persistence
  // would appear to work (this component's own state updates) while the live theme never actually
  // picks it up. Splash stays up for this window regardless (see useSplashReady below), so gating
  // costs nothing visually.
  useSplashReady('theme', settings !== null)

  // Only persists appearance — AutoPaperProvider owns the live settings after mount, and calling
  // setSettings here too would update this parent component while the provider (a child) is
  // rendering. Color used to be persisted unconditionally here too, on every theme change; now
  // loadout.tsx owns that itself (saveGuestColors/saveCpuColor above), since which slot a color
  // change should land in — or whether it should persist at all — depends on that seat's own
  // profile/guest/CPU status, something this generic theme-level callback has no way to know.
  const onChange = useCallback((next: ThemeSettings) => {
    void AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next.appearance)
  }, [])

  if (!settings) return null

  return (
    <AutoPaperProvider initialValue={settings} onChange={onChange}>
      {children}
    </AutoPaperProvider>
  )
}
