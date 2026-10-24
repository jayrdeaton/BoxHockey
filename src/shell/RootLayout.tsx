import { useAutoPaperTheme } from '@rific/auto-paper'
import { useHapticSettings } from '@rific/feedback-press'
import { Toaster, ToastProvider } from '@rific/toaster'
import { OrientationProvider, useRotationAwareStatusBar, useThemedRootBackground } from '@tastic/core'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { DeviceMotion } from 'expo-sensors'
import { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Persistor } from 'redux-persist'

import { Fonts } from '@/shell/components/Fonts'
import { GuideHost } from '@/shell/components/GuideHost'
import { Providers } from '@/shell/components/Providers'
import { Theme } from '@/shell/components/Theme'
import { UpdateDialog } from '@/shell/components/UpdateDialog'
import { useAppSettings } from '@/shell/hooks/useAppSettings'
import { ProfilesProvider, useProfiles } from '@/shell/hooks/useProfiles'
import { PackProvider } from '@/shell/PackContext'
import type { PackStore } from '@/shell/redux/createPackStore'
import { SplashGate } from '@/shell/splashGate'
import type { GameDefinition, PackDefinition } from '@/shell/types'

// The pack's root: every provider the shell needs, the pack's games' own providers, and the stack.
// src/app/_layout.tsx hands it the pack (pack.ts) and its store, so nothing in shell/ imports a
// game or the pack itself.

// Sits below Theme so it can read the live theme. useThemedRootBackground (@tastic/core) keeps both
// the screens' contentStyle and the OS root window's own background on the live theme, which is what
// stops white flashing through the display's rounded corners during a push/pop transition. Passing
// false disables iOS's swipe-back gesture: otherwise it competes with the game's own pan gestures on
// a play screen and wins (confirmed on-device in LightCycles, where it kicked the player back to the title
// screen mid-round instead of turning their cycle). Web has no such OS-level gesture.
//
// useRotationAwareStatusBar (@tastic/core) hides the OS status bar whenever the content is rotated
// off portrait. It does it through screen options because that is the only way left: an app linked
// against the iOS 27 SDK can't set the status bar app-wide, which is all React Native's StatusBar
// (and expo-status-bar) does on iOS, and with @tastic/core's config plugin on, every mounted
// StatusBar logs an error. So nothing in the app mounts one (Theme passes auto-paper's Provider
// statusBar={false}). No `locked` argument: OrientationBridge already freezes the reading it
// follows. A play screen hides the bar for the whole round, whatever the angle (a screen's own
// options win over screenOptions); index is listed first so it stays the stack's first route.
const PLAY_OPTIONS = { statusBarHidden: true }

function AppStack() {
  const { dark } = useAutoPaperTheme()
  const rootBackground = useThemedRootBackground(dark, false)
  const statusBar = useRotationAwareStatusBar()
  return (
    <Stack screenOptions={{ ...rootBackground, ...statusBar }}>
      <Stack.Screen name='index' />
      <Stack.Screen name='[game]/play' options={PLAY_OPTIONS} />
    </Stack>
  )
}

// Wires the persisted Lock Orientation setting into @tastic/core's OrientationProvider. Its own
// component because RootLayout renders the Redux store (inside Providers) and so can't call
// useAppSettings() itself. Providers' PersistGate holds rendering until the store has rehydrated, so
// lockInitialValue carries the saved lock from the very first render.
//
// freezeWhileLocked makes the lock app-wide: while appSettings.lockOrientation is on, the ONE shared
// orientation reading freezes for every consumer (every screen, every board, hud dialogs, the
// status bar), including anything that mounts after the lock, so no call site ever takes a `locked`
// argument of its own (one would freeze on the pre-sensor default at mount). The Settings dialog
// toggle only writes appSettings.lockOrientation, which reaches the provider as a changed
// lockInitialValue; the provider reports the angle it froze on through onLockChange (`rotation`,
// cleared on unlock), persisted as appSettings.lockedRotation and handed back here so a relaunch reopens
// in the locked orientation instead of portrait.
//
// Mounted once, here, rather than per screen: one app-lifetime sensor subscription is what lets the
// committed orientation survive navigation. deviceMotion is the app's own expo-sensors import, handed
// in because @tastic/core never imports expo-sensors itself (apps without tilt tracking would
// otherwise need it installed just to bundle).
function OrientationBridge({ children }: { children: ReactNode }) {
  const { settings, setSettings } = useAppSettings()
  return (
    <OrientationProvider deviceMotion={DeviceMotion} freezeWhileLocked lockInitialValue={{ locked: settings.lockOrientation, rotation: settings.lockedRotation }} onLockChange={(next) => setSettings({ lockOrientation: next.locked, lockedRotation: next.rotation })}>
      {children}
    </OrientationProvider>
  )
}

// ProfilesProvider reconciles the local roster with the shared App Group one before `loaded` flips,
// so a screen mounting earlier would read (and could persist) the wrong profiles. This holds
// everything nested inside it, and the splash screen, until that's done, while ProfilesProvider sits
// above it and starts reconciling immediately. Settings and stats need no gate: they live in the
// Redux store, which Providers' PersistGate already holds until rehydrated.
function GatedApp({ children }: { children: ReactNode }) {
  const { loaded } = useProfiles()
  return (
    <SplashGate gate='profiles' ready={loaded}>
      {children}
    </SplashGate>
  )
}

// The toaster only gets expo-haptics while the player's Vibrate setting is on, so its haptic ticks
// follow the same setting as every other haptic in the app. Today they can't fire anyway (the only
// controls that tick, the history and clear buttons, are off below), but this keeps it that way if
// either is ever shown. Must render inside Providers, whose FeedbackBridge provides the setting.
function HapticGatedToastProvider({ children }: { children: ReactNode }) {
  const { settings } = useHapticSettings()
  return (
    <ToastProvider haptics={settings.vibrate ? Haptics : undefined} paper={RNPaper}>
      {children}
    </ToastProvider>
  )
}

// Every game's own root provider (its stats and achievements context), nested in pack order.
function GameProviders({ games, children }: { games: readonly GameDefinition[]; children: ReactNode }) {
  return games.reduceRight<ReactNode>((inner, game) => <game.Provider key={game.id}>{inner}</game.Provider>, children)
}

interface RootLayoutProps {
  pack: PackDefinition
  store: PackStore
  persistor: Persistor
}

export function RootLayout({ pack, store, persistor }: RootLayoutProps) {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Fonts>
          <PackProvider pack={pack}>
            <Providers store={store} persistor={persistor}>
              <Theme>
                <ProfilesProvider>
                  <GameProviders games={pack.games}>
                    <GatedApp>
                      <OrientationBridge>
                        <HapticGatedToastProvider>
                          {/* Wraps the stack (rather than sitting beside it like UpdateDialog)
                          because Home's tiles and the loadout's How to Play row reach it through
                          context (see GuideHost). Inside the toast provider and OrientationBridge
                          because the card renders through a Portal and rotates with the shared
                          reading, and inside the gate so it mounts together with Home rather than
                          before it. */}
                          <GuideHost>
                            <AppStack />
                          </GuideHost>
                          {/* historyButton/clearButton off: there's no toast history to open, and a
                          control row for it above the toast stack would go nowhere. limit pins the
                          package's current default (3) so a future toaster release can't change it. */}
                          <Toaster historyButton={null} clearButton={null} limit={3} />
                          <UpdateDialog />
                        </HapticGatedToastProvider>
                      </OrientationBridge>
                    </GatedApp>
                  </GameProviders>
                </ProfilesProvider>
              </Theme>
            </Providers>
          </PackProvider>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }
})
