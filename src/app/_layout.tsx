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

// This file is identical across the fleet's games (AirHockey, BoxHockey, LightCycles, Pong). Change
// it in all of them or none, so any game can be the template for the next one.

// Sits below Theme so it can read the live theme. useThemedRootBackground (@tastic/core) keeps both
// the screens' contentStyle and the OS root window's own background on the live theme, which is what
// stops white flashing through the display's rounded corners during a push/pop transition. Passing
// false disables iOS's swipe-back gesture: otherwise it competes with the game's own pan gestures on
// /game and wins (confirmed on-device in LightCycles, where it kicked the player back to the title
// screen mid-round instead of turning their cycle). Web has no such OS-level gesture.
function AppStack() {
  const { dark } = useAutoPaperTheme()
  return <Stack screenOptions={useThemedRootBackground(dark, false)} />
}

// Wires the persisted Lock Orientation setting into @tastic/core's OrientationProvider. Its own
// component because RootLayout renders GameSettingsProvider and so can't call useGameSettings()
// itself; mounted inside GatedApp, so settings have loaded and lockInitialValue carries the saved
// lock from the very first render.
//
// freezeWhileLocked makes the lock app-wide: while settings.lockOrientation is on, the ONE shared
// orientation reading freezes for every consumer (every screen, the in-game board, hud dialogs, the
// status bar), including anything that mounts after the lock, so no call site ever takes a `locked`
// argument of its own (one would freeze on the pre-sensor default at mount). The Settings dialog
// toggle only writes settings.lockOrientation, which reaches the provider as a changed
// lockInitialValue; the provider reports the angle it froze on through onLockChange (`rotation`,
// cleared on unlock), persisted as settings.lockedRotation and handed back here so a relaunch reopens
// in the locked orientation instead of portrait.
//
// Mounted once, here, rather than per screen: one app-lifetime sensor subscription is what lets the
// committed orientation survive navigation. deviceMotion is the app's own expo-sensors import, handed
// in because @tastic/core never imports expo-sensors itself (apps without tilt tracking would
// otherwise need it installed just to bundle).
function OrientationBridge({ children }: { children: ReactNode }) {
  const { settings, setSettings } = useGameSettings()
  return (
    <OrientationProvider deviceMotion={DeviceMotion} freezeWhileLocked lockInitialValue={{ locked: settings.lockOrientation, rotation: settings.lockedRotation }} onLockChange={(next) => setSettings({ lockOrientation: next.locked, lockedRotation: next.rotation })}>
      {children}
    </OrientationProvider>
  )
}

// GameSettingsProvider and ProfilesProvider start from defaults and only patch in their AsyncStorage
// values once the reads resolve, so a screen mounting before then would read (and could persist) the
// wrong values. This gate holds everything nested inside it until both have loaded, while the
// providers themselves (and GameStatsProvider) sit above it and start their loads immediately, in
// parallel. useGameSettings()/useProfiles() are app-local hooks the shared SettingsAndProfilesGate
// can't call itself, so this supplies their `loaded` flags plus the app's own bound SplashGate.
function GatedApp({ children }: { children: ReactNode }) {
  const { loaded: settingsLoaded } = useGameSettings()
  const { loaded: profilesLoaded } = useProfiles()
  return (
    <SettingsAndProfilesGate Gate={SplashGate} settingsLoaded={settingsLoaded} profilesLoaded={profilesLoaded}>
      {children}
    </SettingsAndProfilesGate>
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
                      <OrientationBridge>
                        <ToastProvider haptics={Haptics} paper={RNPaper}>
                          {/* Wraps the stack (rather than sitting beside it like UpdateDialog) because
                          Home's useAutoShowGuide() and the Settings dialog's "How to Play" row reach
                          it through context (see GuideHost). Inside ToastProvider and
                          OrientationBridge because the card renders through a Portal and rotates with
                          the shared reading, and inside the gate because it reads loaded settings. */}
                          <GuideHost>
                            <AppStack />
                          </GuideHost>
                          {/* Hides the OS status bar whenever the content is rotated off portrait. No
                          `locked` prop: OrientationBridge already freezes the reading it follows. */}
                          <RotationAwareStatusBar />
                          {/* historyButton/clearButton off: no game has a toast history to open, and a
                          control row for it above the toast stack would go nowhere. limit pins the
                          package's current default (3) so a future toaster release can't change it. */}
                          <Toaster historyButton={null} clearButton={null} limit={3} />
                          <UpdateDialog />
                        </ToastProvider>
                      </OrientationBridge>
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
