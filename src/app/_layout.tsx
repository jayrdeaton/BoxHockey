import { Toaster, ToastProvider } from '@rific/toaster'
import { getViewRotation, OrientationProvider, useOrientationState } from '@tastic/core'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { DeviceMotion } from 'expo-sensors'
import { StatusBar } from 'expo-status-bar'
import { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Fonts } from '@/components/Fonts'
import { Providers } from '@/components/Providers'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider, useGameSettings } from '@/hooks/useGameSettings'
import { GameStatsProvider } from '@/hooks/useGameStats'
import { ProfilesProvider, useProfiles } from '@/hooks/useProfiles'
import { SplashGate } from '@/utils/splashGate'

// Isolated from RootLayout itself so this live tilt subscription's re-renders stay scoped to just
// this one bar, not the whole app tree — mirrors LightCycles' identically-shaped
// RotationAwareStatusBar. Hides the OS status bar whenever content elsewhere is visually rotated
// (see @tastic/split-screen's FakeLandscapeView, now used by /index and /loadout) — a portrait-drawn
// OS status bar reads wrong sitting over rotated content. /game hides it unconditionally regardless
// (see its own <StatusBar hidden />), so this only actually matters on /index and /loadout.
function RotationAwareStatusBar() {
  const { orientationMode, p1OnRight, upsideDown } = useOrientationState()
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  return <StatusBar hidden={rotation !== 0} />
}

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
    <SplashGate gate='settings' ready={settingsLoaded}>
      <SplashGate gate='profiles' ready={profilesLoaded}>
        {children}
      </SplashGate>
    </SplashGate>
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
                      {/* @tastic/core never imports expo-sensors itself — a real top-level import
                      there would force every consumer of the package (even one with zero interest
                      in tilt tracking) to have expo-sensors installed, or Metro fails to resolve
                      it. This app wants live tilt tracking, so it does its own real import and
                      hands the resolved module in — same injection convention as @rific/auto-paper's
                      <Provider reanimated={...}>/<Provider expoBlur={...}>. Omitting this prop
                      degrades gracefully (orientation just never resolves past its default guess,
                      logged once in dev), it doesn't throw. */}
                      <OrientationProvider deviceMotion={DeviceMotion}>
                        <ToastProvider haptics={Haptics} paper={RNPaper}>
                          <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
                          <Toaster />
                          <UpdateDialog />
                          <RotationAwareStatusBar />
                        </ToastProvider>
                      </OrientationProvider>
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
