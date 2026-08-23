import { useSoundSettings } from '@rific/feedback-press'
import { type AudioPoolOptions, useAudioPool } from '@rific/feedback-press/audio'
import { AudioSource } from 'expo-audio'
import { useCallback } from 'react'

// Wraps useAudioPool with the app's own sound-enabled setting (Feedback.tsx/SettingsDialog) —
// for gameplay SFX (bounce, goal, faceoff, etc.) that play outside the button-press pipeline,
// which already gates its own `sound` callbacks on this same setting internally (see
// useFeedbackHandlers' `fire`). Call once per distinct clip, same as useAudioPool itself.
export function useGameSound(source: AudioSource, options?: AudioPoolOptions): () => void {
  const { settings } = useSoundSettings()
  const play = useAudioPool(source, options)
  return useCallback(() => {
    if (settings.enabled) play()
  }, [settings.enabled, play])
}
