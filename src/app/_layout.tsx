import { useUpdater } from '@rific/updater'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

export default function RootLayout() {
  useUpdater()

  const colorScheme = useColorScheme()
  const theme = colorScheme === 'dark' ? MD3DarkTheme : MD3LightTheme

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <StatusBar style='light' />
        <Stack screenOptions={{ headerShown: false }} />
      </PaperProvider>
    </SafeAreaProvider>
  )
}
