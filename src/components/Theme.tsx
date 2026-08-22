import AsyncStorage from '@react-native-async-storage/async-storage'
import { getRgb, getThirdColor, Provider as AutoPaperProvider, ThemeSettings } from '@rific/auto-paper'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback, useEffect, useState } from 'react'

import { useSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()

const APPEARANCE_STORAGE_KEY = 'boxhockey.appearance'
const PLAYER_COLORS_STORAGE_KEY = 'boxhockey.playerColors'

export const DEFAULT_P1_COLOR = '#f44336'
export const DEFAULT_P2_COLOR = '#2196f3'

function triadFor(p1: string, p2: string) {
  return { primary: p1, secondary: p2, tertiary: getThirdColor(p1, p2) }
}

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && getRgb(value) !== null
}

interface Props {
  children: ReactNode
}

export function Theme({ children }: Props) {
  const [settings, setSettings] = useState<Partial<ThemeSettings> | null>(null)

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(APPEARANCE_STORAGE_KEY), AsyncStorage.getItem(PLAYER_COLORS_STORAGE_KEY)]).then(([storedAppearance, storedColors]) => {
      const appearance = storedAppearance === 'light' || storedAppearance === 'dark' || storedAppearance === 'system' ? storedAppearance : 'dark'

      let p1 = DEFAULT_P1_COLOR
      let p2 = DEFAULT_P2_COLOR
      if (storedColors) {
        try {
          const parsed = JSON.parse(storedColors)
          if (isValidHex(parsed.p1)) p1 = parsed.p1
          if (isValidHex(parsed.p2)) p2 = parsed.p2
        } catch {
          // Corrupt/stale blob — fall back to defaults above.
        }
      }

      setSettings({ appearance, color: triadFor(p1, p2) })
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

  // Only persists — AutoPaperProvider owns the live settings after mount, and calling setSettings
  // here too would update this parent component while the provider (a child) is rendering.
  const onChange = useCallback((next: ThemeSettings) => {
    void AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next.appearance)
    if (typeof next.color === 'object') {
      void AsyncStorage.setItem(PLAYER_COLORS_STORAGE_KEY, JSON.stringify({ p1: next.color.primary, p2: next.color.secondary }))
    }
  }, [])

  if (!settings) return null

  return (
    <AutoPaperProvider initialValue={settings} onChange={onChange}>
      {children}
    </AutoPaperProvider>
  )
}
