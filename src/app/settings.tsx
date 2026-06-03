import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { IconButton, Text } from 'react-native-paper'

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <IconButton icon='arrow-left' size={24} style={styles.back} onPress={() => router.back()} />
      <Text variant='headlineMedium' style={styles.title}>
        Settings
      </Text>
      <Text variant='bodyMedium' style={styles.placeholder}>
        Coming soon
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  back: {
    left: 8,
    position: 'absolute',
    top: 8
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#0A1628',
    flex: 1,
    justifyContent: 'center'
  },
  placeholder: {
    color: 'rgba(255,255,255,0.4)'
  },
  title: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginBottom: 8
  }
})
