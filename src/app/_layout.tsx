import { useAutoPaperTheme } from '@rific/auto-paper'
import { Toaster, ToastProvider } from '@rific/toaster'
import { OrientationProvider, RotationAwareStatusBar, SettingsAndProfilesGate, useThemedRootBackground } from '@tastic/core'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { DeviceMotion } from 'expo-sensors'
import { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Fonts } from '@/components/Fonts'
import { GuideHost } from '@/components/GuideHost'
import { Providers } from '@/components/Providers'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider, useGameSettings } from '@/hooks/useGameSettings'
import { GameStatsProvider } from '@/hooks/useGameStats'
import { ProfilesProvider, useProfiles } from '@/hooks/useProfiles'
import { SplashGate } from '@/utils/splashGate'

// Sits below both GameSettingsProvider and ProfilesProvider (so it can call their own hooks) and
// above everything that actually reads them — index.tsx reads settings.lockOrientation immediately
// on mount, and /loadout reads profiles/lastSelected immediately too, so without this both would
// briefly render on DEFAULT_SETTINGS/an empty roster before popping to the real persisted values a
// moment after the splash lifts. GameSettingsProvider/ProfilesProvider themselves are deliberately
// NOT gated/delayed — both still mount immediately, right alongside GameStatsProvider, so all three
// providers' own AsyncStorage reads keep starting in parallel exactly as before; only what's below
// this component ever calls useGameSettings()/useProfiles() and had anything to gain by waiting.
// Safe to gate on each provider's own `loaded` from down here rather than needing to delay the
// providers' own mount (contrast Theme.tsx's AutoPaperProvider, which genuinely can't be patched
// after mount) because neither hook's state is seeded via a lazy useState(() => ...) initializer —
// both start at hardcoded defaults and correct themselves via a normal setState once their load
// effect resolves, so by the time `loaded` flips true here the context value already reflects it.
function GatedApp({ children }: { children: ReactNode }) {
  const { loaded: settingsLoaded } = useGameSettings()
  const { loaded: profilesLoaded } = useProfiles()
  return (
    <SettingsAndProfilesGate Gate={SplashGate} settingsLoaded={settingsLoaded} profilesLoaded={profilesLoaded}>
      {children}
    </SettingsAndProfilesGate>
  )
}

// RootLayout itself sits ABOVE GameSettingsProvider (it's the one that renders it), so it can't call
// useGameSettings() to read settings.lockOrientation for <RotationAwareStatusBar>'s own `locked`
// prop. This component exists purely to sit far enough down the tree to read it — same role the old
// local RotationAwareStatusBar function used to serve — while otherwise rendering exactly the same
// JSX RootLayout used to inline directly.
function AppContent() {
  const { settings } = useGameSettings()
  const { dark } = useAutoPaperTheme()
  return (
    // @tastic/core never imports expo-sensors itself — a real top-level import there would force
    // every consumer of the package (even one with zero interest in tilt tracking) to have
    // expo-sensors installed, or Metro fails to resolve it. This app wants live tilt tracking, so it
    // does its own real import and hands the resolved module in — same injection convention as
    // @rific/auto-paper's <Provider reanimated={...}>/<Provider expoBlur={...}>. Omitting this prop
    // degrades gracefully (orientation just never resolves past its default guess, logged once in
    // dev), it doesn't throw.
    <OrientationProvider deviceMotion={DeviceMotion}>
      <ToastProvider haptics={Haptics} paper={RNPaper}>
        {/* Wraps the stack (rather than sitting beside it like UpdateDialog) because Home's
        useAutoShowGuide() and the Settings dialog's "How to Play" row reach it through context (see
        GuideHost's own doc). Must stay inside ToastProvider/OrientationProvider (and GatedApp, so the
        cards are built from the real persisted settings): the card renders through a Portal and
        reads the live tilt. */}
        <GuideHost>
          {/* useThemedRootBackground also keeps the root window's own OS-level background (a separate
          layer from contentStyle here, the screen-level backing) synced to the live theme — see its
          own doc comment in @tastic/core for why both are needed together. */}
          <Stack screenOptions={useThemedRootBackground(dark, false)} />
        </GuideHost>
        {/* historyButton/clearButton off — this app has no history modal use case for them to open,
        and a stray control row above the toast stack for a feature that goes nowhere is worse than
        just not offering it. limit is already the package's own default (3); pinned explicitly so
        it stays 3 regardless of what that default does in a future toaster version. */}
        <Toaster historyButton={null} clearButton={null} limit={3} />
        <UpdateDialog />
        <RotationAwareStatusBar locked={settings.lockOrientation} />
      </ToastProvider>
    </OrientationProvider>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Fonts>
          <Providers>
            <Theme>
              <GameSettingsProvider>
                <ProfilesProvider>
                  <GameStatsProvider>
                    <GatedApp>
                      <AppContent />
                    </GatedApp>
                  </GameStatsProvider>
                </ProfilesProvider>
              </GameSettingsProvider>
            </Theme>
          </Providers>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }
})
