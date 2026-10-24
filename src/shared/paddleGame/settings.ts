import { createSettingsSlice } from '@rific/core'
import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { SCORE_TO_WIN } from '@/shared/paddleGame/constants/game'
import type { Settings } from '@/shared/paddleGame/types'

// Pong's defaults, minus what the shell keeps pack-wide (seat 2, Lock Orientation, Edge Guard) and
// what the game decides (bricks).
export const DEFAULT_SETTINGS: Settings = {
  scoreToWin: SCORE_TO_WIN,
  aiDifficulty: 'medium',
  paddleSize: 'medium',
  ballSpeed: 'medium',
  // Asymmetric defaults (not both 'mouse') so two seats sharing one desktop's keyboard and mouse
  // don't start out colliding.
  controlScheme: { 1: 'mouse', 2: 'wasd' },
  tiltControlEnabled: false
}

// One paddle game's settings under its own store key (Paddles' paddlesSettings, Breaker's
// breakerSettings), and the hook its screens read and write them through. Built on @rific/core's
// createSettingsSlice: `initialize` in 'merge' mode is the single write path (a partial patch), and
// its REHYDRATE handling fills any field added after a player's settings were saved from the
// defaults, so no validation or migration is needed.
export function createPaddleSettings(key: string) {
  const { actions, reducer } = createSettingsSlice<Settings, 'merge', never>(key, {
    initialState: DEFAULT_SETTINGS,
    initializeMode: 'merge',
    fieldSetters: []
  })

  function useSettings(): { settings: Settings; setSettings: (patch: Partial<Settings>) => void } {
    const settings = useSelector((state: Record<string, Settings>) => state[key])
    const dispatch = useDispatch()
    const setSettings = useCallback(
      (patch: Partial<Settings>) => {
        dispatch(actions.initialize(patch))
      },
      [dispatch]
    )
    return { settings, setSettings }
  }

  return { actions, reducer, useSettings }
}
