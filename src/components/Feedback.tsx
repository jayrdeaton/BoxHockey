import AsyncStorage from '@react-native-async-storage/async-storage'
import { FeedbackPressProvider, HapticSettings, SoundSettings } from '@rific/feedback-press'
import { useAudioPool } from '@rific/feedback-press/audio'
import { ReactNode, useCallback, useEffect, useState } from 'react'
import * as RNPaper from 'react-native-paper'

import { useSplashReady } from '@/utils/splashGate'

const HAPTIC_STORAGE_KEY = 'boxhockey.vibrate'
const SOUND_STORAGE_KEY = 'boxhockey.sound'

interface Props {
  children: ReactNode
}

// Replaces the old separate Haptic.tsx/Sound.tsx — @rific/feedback-press ships its own
// SoundSettings/useSoundSettings (soundInitialValue/onSoundChange on FeedbackPressProvider) now,
// so the bespoke SoundSettingsContext Sound.tsx used to hand-roll is redundant. One provider, one
// persistence pattern for both.
export function Feedback({ children }: Props) {
  const [hapticSettings, setHapticSettings] = useState<Partial<HapticSettings> | null>(null)
  const [soundSettings, setSoundSettings] = useState<Partial<SoundSettings> | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(HAPTIC_STORAGE_KEY)
      .then((stored) => {
        setHapticSettings({ vibrate: stored === null ? true : stored === 'true' })
      })
      .catch(() => {
        // Corrupt/unavailable storage — must still resolve this state, or FeedbackPressProvider
        // below (gated on it, same reasoning as Theme.tsx/AutoPaperProvider) never mounts.
        setHapticSettings({ vibrate: true })
      })
  }, [])

  useEffect(() => {
    AsyncStorage.getItem(SOUND_STORAGE_KEY)
      .then((stored) => {
        setSoundSettings({ enabled: stored === null ? true : stored === 'true' })
      })
      .catch(() => {
        setSoundSettings({ enabled: true })
      })
  }, [])

  // Loaded settings gate mounting FeedbackPressProvider entirely (rather than mounting it
  // immediately with defaults and patching `initialValue`/`soundInitialValue` once the reads
  // resolve): FeedbackPressProvider's own settings state is a lazy useState(() => ...) that only
  // reads those props on its very first mount, so a changed prop on a later render is silently
  // ignored — persistence would appear to work (this component's own state updates) while the
  // live haptic/sound settings never actually pick it up. Mirrors Theme.tsx's own gating of
  // AutoPaperProvider for the identical reason.
  useSplashReady('haptics', hapticSettings !== null)
  useSplashReady('sound', soundSettings !== null)

  // Generic UI feedback sounds, wired into every Button/IconButton/etc. in the package (see
  // useFeedbackHandlers' `fire`, which already gates these on the sound-enabled setting itself —
  // no need to re-check it here).
  const playSelection = useAudioPool(require('../../assets/sounds/select.wav'))
  const playNotification = useAudioPool(require('../../assets/sounds/notification.wav'))

  // Only persists — FeedbackPressProvider owns the live settings after mount, and it calls
  // onChange/onSoundChange synchronously during its own render, so mirroring `next` back into this
  // component's state here would update a parent while a child renders (React setState-in-render
  // warning).
  const onChange = useCallback((next: HapticSettings) => {
    AsyncStorage.setItem(HAPTIC_STORAGE_KEY, String(next.vibrate)).catch(() => {})
  }, [])

  const onSoundChange = useCallback((next: SoundSettings) => {
    AsyncStorage.setItem(SOUND_STORAGE_KEY, String(next.enabled)).catch(() => {})
  }, [])

  if (!hapticSettings || !soundSettings) return null

  return (
    <FeedbackPressProvider initialValue={hapticSettings} onChange={onChange} soundInitialValue={soundSettings} onSoundChange={onSoundChange} paper={RNPaper} sound={{ selection: playSelection, notification: playNotification }}>
      {children}
    </FeedbackPressProvider>
  )
}
