import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useSplashReady } from '@/utils/splashGate'

// Pre-emptive: no sound effects exist yet, but the persisted setting + the toggle in Settings do,
// so whenever sound effects land they just read this instead of also needing a settings migration.
// Mirrors Haptic.tsx's shape exactly (@rific/feedback-press has no built-in equivalent for sound
// the way it does for haptics via useHapticSettings/FeedbackPressProvider) — same AsyncStorage key
// naming, same load-before-mount-then-persist-on-change split, same splash gate.
export interface SoundSettings {
  enabled: boolean
}

interface SoundSettingsContextType {
  settings: SoundSettings
  set: (patch: Partial<SoundSettings>) => void
}

const defaultSoundSettings: SoundSettings = { enabled: true }

const SoundSettingsContext = createContext<SoundSettingsContextType>({
  settings: defaultSoundSettings,
  set: () => {}
})

export function useSoundSettings(): SoundSettingsContextType {
  return useContext(SoundSettingsContext)
}

const SOUND_STORAGE_KEY = 'boxhockey.sound'

interface Props {
  children: ReactNode
}

export function Sound({ children }: Props) {
  const [settings, setSettings] = useState<SoundSettings>(defaultSoundSettings)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(SOUND_STORAGE_KEY).then((stored) => {
      if (stored !== null) setSettings({ enabled: stored === 'true' })
      setLoaded(true)
    })
  }, [])

  useSplashReady('sound', loaded)

  const set = useCallback((patch: Partial<SoundSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      void AsyncStorage.setItem(SOUND_STORAGE_KEY, String(next.enabled))
      return next
    })
  }, [])

  const value = useMemo(() => ({ settings, set }), [settings, set])

  return <SoundSettingsContext.Provider value={value}>{children}</SoundSettingsContext.Provider>
}
