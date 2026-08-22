import AsyncStorage from '@react-native-async-storage/async-storage'
import { FeedbackPressProvider, HapticSettings } from '@rific/feedback-press'
import { ReactNode, useCallback, useEffect, useState } from 'react'
import * as RNPaper from 'react-native-paper'

import { SplashGate } from '@/utils/splashGate'

const HAPTIC_STORAGE_KEY = 'boxhockey.vibrate'

interface Props {
  children: ReactNode
}

export function Haptic({ children }: Props) {
  const [settings, setSettings] = useState<Partial<HapticSettings>>({ vibrate: true })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(HAPTIC_STORAGE_KEY).then((stored) => {
      if (stored !== null) setSettings({ vibrate: stored === 'true' })
      setLoaded(true)
    })
  }, [])

  // Only persists — FeedbackPressProvider owns the live settings after mount, and it calls
  // onChange synchronously during its own render, so mirroring `next` back into this component's
  // state here would update a parent while a child renders (React setState-in-render warning).
  const onChange = useCallback((next: HapticSettings) => {
    void AsyncStorage.setItem(HAPTIC_STORAGE_KEY, String(next.vibrate))
  }, [])

  // Withholds mounting FeedbackPressProvider until `loaded` is true, not just the gate: its own
  // `settings` state is a lazy useState(() => ({...defaults, ...initialValue})) that only reads
  // `initialValue` on first mount, so mounting it immediately with the default and patching
  // `settings` once storage resolves would silently never reach the live provider.
  return (
    <SplashGate gate='haptics' ready={loaded}>
      <FeedbackPressProvider initialValue={settings} onChange={onChange} paper={RNPaper}>
        {children}
      </FeedbackPressProvider>
    </SplashGate>
  )
}
