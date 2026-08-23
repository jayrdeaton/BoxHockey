import { Toaster, ToastProvider } from '@rific/toaster'
import { useUpdater } from '@rific/updater'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Feedback } from '@/components/Feedback'
import { Fonts } from '@/components/Fonts'
import { Theme } from '@/components/Theme'
import { GameSettingsProvider } from '@/hooks/useGameSettings'

export default function RootLayout() {
  useUpdater()

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Fonts>
          <Feedback>
            <Theme>
              <GameSettingsProvider>
                <ToastProvider haptics={Haptics} paper={RNPaper}>
                  <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
                  <Toaster />
                </ToastProvider>
              </GameSettingsProvider>
            </Theme>
          </Feedback>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
