import { TouchableRipple } from '@rific/feedback-press'
import { StyleSheet } from 'react-native'
import { Text } from 'react-native-paper'

import { MONO_FONT } from '@/constants/fonts'

interface Props {
  color: string
  ready: boolean
  onToggleReady: () => void
}

// Extracted from PlayerSetupPanel so it can also be rendered standalone — vs-CPU only has one
// human player, so its Ready toggle sits centered below both slots rather than tucked under just
// that player's own panel.
export function ReadyButton({ color, ready, onToggleReady }: Props) {
  return (
    <TouchableRipple onPress={onToggleReady} borderless style={[styles.readyButton, { borderColor: color }, ready && { backgroundColor: color }]}>
      <Text variant='labelLarge' style={[{ fontFamily: MONO_FONT, fontWeight: 'bold' }, { color: ready ? '#000000' : color }]}>
        {ready ? 'READY ✓' : 'READY?'}
      </Text>
    </TouchableRipple>
  )
}

const styles = StyleSheet.create({
  readyButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 120,
    paddingHorizontal: 16,
    paddingVertical: 10
  }
})
