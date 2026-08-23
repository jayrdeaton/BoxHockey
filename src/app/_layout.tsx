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
  // Silent background staging: games shouldn't get an update dialog interrupting a pass-and-play
  // session. Settings exposes a manual "Check for Updates" button for the confirm-and-reload flow.
  useUpdater({ autoPrompt: false })

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
