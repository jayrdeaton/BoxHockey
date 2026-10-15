import { Provider as AutoPaperProvider, themeActions, ThemeSettings, useThemeBridgeProps } from '@rific/auto-paper'
import * as ExpoBlur from 'expo-blur'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback } from 'react'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import { type RootState } from '@/redux/store'
import { markSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()
// iOS defaults `fade` to false (Android always fades regardless of this flag), so without this the
// splash view is just yanked off screen the instant every gate reports ready.
SplashScreen.setOptions({ fade: true, duration: 400 })

interface Props {
  children: ReactNode
}

export function Theme({ children }: Props) {
  // redux/store.ts's own `theme` slice (createThemeReducer, seeded with this app's real default
  // P1/P2 colors - see constants/game.ts) replaces this component's old per-field AsyncStorage
  // load/save entirely. PersistGate (mounted in Providers.tsx, an ancestor of this component -
  // Theme is rendered as its child in _layout.tsx) already blocks rendering until redux-persist has
  // rehydrated, so by the time this mounts `settings` is already the real persisted (or, on a fresh
  // install, default) triad - no async gate/loading state needed here the way the old AsyncStorage
  // version required.
  const settings = useSelector((state: RootState) => state.theme, shallowEqual)
  const dispatch = useDispatch()

  // A one-shot callback, not a boolean, so there's nothing for useSplashReady to watch - PersistGate
  // (an ancestor, see Providers.tsx) already blocks this component from mounting until redux-persist
  // has rehydrated, so `settings` above is already the real persisted value the instant Theme mounts.
  // That's necessary but not sufficient, though: AutoPaperProvider itself renders null internally
  // until it's actually computed a theme object from that settings value (see its own source), which
  // is a separate, later step from Theme just mounting with valid settings in hand. Marking this gate
  // ready unconditionally at mount - as this file used to - could let the splash screen lift while
  // AutoPaperProvider was still rendering null underneath it, same class of bug this app's own
  // splash-gate audit found elsewhere. This instead marks the 'theme' gate (see
  // src/utils/splashGate.ts) only once AutoPaperProvider itself reports a real theme, matching every
  // sibling app's own Theme.tsx.
  const onReady = useCallback(() => markSplashReady('theme'), [])

  // Persists the FULL settings object now (appearance included), not just appearance - color used
  // to be excluded here and persisted separately by loadout.tsx's own saveGuestColors/saveCpuColor
  // AsyncStorage calls; now that both live in the same `theme` Redux slice, one unconditional
  // dispatch covers all of it. loadout.tsx's own useThemeSettings().set(...) calls (unchanged by
  // this) are what drive the LIVE color moment to moment; this onChange is only what makes whatever
  // that resolves to durable across a relaunch.
  const onChange = useCallback((next: ThemeSettings) => dispatch(themeActions.initialize(next)), [dispatch])

  const bridgeProps = useThemeBridgeProps({ initialValue: settings, onChange, onReady })

  // expoBlur is what lets auto-paper's BlurView actually blur (the settings sheet, Paper menus and
  // @tastic/hud's overlay cards) while the player's Blur setting is on. Without it they paint the
  // theme's solid surface instead, and hud's Settings hides the Blur row.
  // statusBar={false}: auto-paper renders no React Native StatusBar (here or in Appbar.Header). The
  // status bar is set per screen (_layout.tsx's useRotationAwareStatusBar), and with @tastic/core's
  // config plugin on, a mounted StatusBar logs an error (a red box in a dev build).
  return (
    <AutoPaperProvider {...bridgeProps} expoBlur={ExpoBlur} statusBar={false}>
      {children}
    </AutoPaperProvider>
  )
}
