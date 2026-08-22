import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

import { GameSettings } from '@/types'
import { DEFAULT_SETTINGS, isValidSettings } from '@/utils/gameSettingsValidation'

const STORAGE_KEY = 'boxhockey.settings'

interface GameSettingsContextValue {
  settings: GameSettings
  setSettings: (update: Partial<GameSettings>) => void
  // The snapshot /loadout locks in for the round about to start, as opposed to `settings` above
  // (the editable, persisted "next round" defaults) — see commitRoundSettings below.
  activeRoundSettings: GameSettings | null
  commitRoundSettings: (settings: GameSettings) => void
}

const GameSettingsContext = createContext<GameSettingsContextValue | null>(null)

interface Props {
  children: ReactNode
}

// Single source of truth for game settings, mounted once in _layout.tsx. Every screen reads this
// same live instance via useGameSettings() below rather than each keeping its own AsyncStorage-
// backed copy — expo-router keeps prior screens mounted underneath when navigating forward, so a
// per-screen copy would go stale the moment another still-mounted screen changed a setting, and
// could even clobber that change by later writing its own stale snapshot back to storage. Mirrors
// Theme.tsx's own Provider pattern for the same reason.
export function GameSettingsProvider({ children }: Props) {
  const [settings, setSettingsState] = useState<GameSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!stored) return
        try {
          const parsed = JSON.parse(stored)
          if (isValidSettings(parsed)) setSettingsState(parsed)
        } catch {
          // Corrupt/stale blob — keep defaults.
        }
      })
      .catch(() => {
        // Unavailable storage — nothing gates on this (unlike Theme.tsx/Haptic.tsx), so keeping
        // DEFAULT_SETTINGS already in state is a complete, silent fallback.
      })
  }, [])

  const setSettings = useCallback((update: Partial<GameSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...update }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  // Held only in memory, never persisted — /game reads this once at mount (see game.tsx) to lock
  // in the round it's about to play, so a settings-dialog edit made mid-round can't retroactively
  // change a round already underway.
  const [activeRoundSettings, setActiveRoundSettings] = useState<GameSettings | null>(null)
  const commitRoundSettings = useCallback((next: GameSettings) => setActiveRoundSettings(next), [])

  return <GameSettingsContext.Provider value={{ settings, setSettings, activeRoundSettings, commitRoundSettings }}>{children}</GameSettingsContext.Provider>
}

export function useGameSettings() {
  const ctx = useContext(GameSettingsContext)
  if (!ctx) throw new Error('useGameSettings must be used within a GameSettingsProvider')
  return ctx
}
