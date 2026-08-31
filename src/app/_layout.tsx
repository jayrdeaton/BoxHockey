import { Toaster, ToastProvider } from '@rific/toaster'
import { AccelerometerOrientationProvider, getViewRotation, useAccelerometerOrientation } from '@tastic/split-screen'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Feedback } from '@/components/Feedback'
import { Fonts } from '@/components/Fonts'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider } from '@/hooks/useGameSettings'
import { ProfilesProvider } from '@/hooks/useProfiles'

// Isolated from RootLayout itself so this live tilt subscription's re-renders stay scoped to just
// this one bar, not the whole app tree — mirrors LightCycles' identically-shaped
// RotationAwareStatusBar. Hides the OS status bar whenever content elsewhere is visually rotated
// (see @tastic/split-screen's FakeLandscapeView, now used by /index and /loadout) — a portrait-drawn
// OS status bar reads wrong sitting over rotated content. /game hides it unconditionally regardless
// (see its own <StatusBar hidden />), so this only actually matters on /index and /loadout.
function RotationAwareStatusBar() {
  const { orientationMode, p1OnRight, upsideDown } = useAccelerometerOrientation()
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  return <StatusBar hidden={rotation !== 0} />
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Fonts>
          <Feedback>
            <Theme>
              <GameSettingsProvider>
                <ProfilesProvider>
                  <AccelerometerOrientationProvider>
                    <ToastProvider haptics={Haptics} paper={RNPaper}>
                      <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
                      <Toaster />
                      <UpdateDialog />
                      <RotationAwareStatusBar />
                    </ToastProvider>
                  </AccelerometerOrientationProvider>
                </ProfilesProvider>
              </GameSettingsProvider>
            </Theme>
          </Feedback>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
