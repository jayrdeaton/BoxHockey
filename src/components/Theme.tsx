import { Provider as AutoPaperProvider, themeActions, ThemeSettings } from '@rific/auto-paper'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback } from 'react'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import { type RootState } from '@/redux/store'
import { useSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()
// iOS defaults `fade` to false (Android always fades regardless of this flag), so without this the
// splash view is just yanked off screen the instant every gate reports ready.
SplashScreen.setOptions({ fade: true, duration: 400 })

interface Props {
  children: ReactNode
}

export function Theme({ children }: Props) {
  // redux/store.ts's own `theme` slice (createThemeReducer, seeded with this app's real default
  // P1/P2 colors — see constants/game.ts) replaces this component's old per-field AsyncStorage
  // load/save entirely. PersistGate (mounted in Providers.tsx, an ancestor of this component —
  // Theme is rendered as its child in _layout.tsx) already blocks rendering until redux-persist has
  // rehydrated, so by the time this mounts `settings` is already the real persisted (or, on a fresh
  // install, default) triad — no async gate/loading state needed here the way the old AsyncStorage
  // version required.
  const settings = useSelector((state: RootState) => state.theme, shallowEqual)
  const dispatch = useDispatch()

  useSplashReady('theme', true)

  // Persists the FULL settings object now (appearance included), not just appearance — color used
  // to be excluded here and persisted separately by loadout.tsx's own saveGuestColors/saveCpuColor
  // AsyncStorage calls; now that both live in the same `theme` Redux slice, one unconditional
  // dispatch covers all of it. loadout.tsx's own useThemeSettings().set(...) calls (unchanged by
  // this) are what drive the LIVE color moment to moment; this onChange is only what makes whatever
  // that resolves to durable across a relaunch.
  const onChange = useCallback((next: ThemeSettings) => dispatch(themeActions.initialize(next)), [dispatch])

  return (
    <AutoPaperProvider initialValue={settings} onChange={onChange}>
      {children}
    </AutoPaperProvider>
  )
}
