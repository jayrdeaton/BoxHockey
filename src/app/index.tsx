import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, IconButton, Text, TouchableRipple } from 'react-native-paper'

import { COLORS } from '@/constants/game'
import { BoardVariant } from '@/types'
import { BOARD_VARIANT_LABELS } from '@/utils/board'

const SCORE_OPTIONS = [3, 5, 7, 10]
const LAYOUT_OPTIONS: BoardVariant[] = ['classic', 'open', 'gauntlet']

const LAYOUT_DESCRIPTIONS: Record<BoardVariant, string> = {
  classic: 'Staggered walls',
  open: 'No obstacles',
  gauntlet: 'Narrow center gap'
}

export default function HomeScreen() {
  const [scoreTo, setScoreTo] = useState(5)
  const [layout, setLayout] = useState<BoardVariant>('classic')

  return (
    <View style={styles.container}>
      <IconButton icon='cog' iconColor='rgba(255,255,255,0.5)' size={24} style={styles.settings} onPress={() => router.push('/settings')} />

      <Text variant='displaySmall' style={styles.title}>
        Box Hockey
      </Text>

      <View style={styles.section}>
        <Text variant='labelMedium' style={styles.sectionLabel}>
          FIRST TO WIN
        </Text>
        <View style={styles.chipRow}>
          {SCORE_OPTIONS.map((n) => {
            const selected = scoreTo === n
            return (
              <TouchableRipple key={n} onPress={() => setScoreTo(n)} borderless style={[styles.chip, selected && styles.chipSelected]}>
                <Text variant='titleMedium' style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {n}
                </Text>
              </TouchableRipple>
            )
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text variant='labelMedium' style={styles.sectionLabel}>
          BOARD
        </Text>
        <View style={styles.chipRow}>
          {LAYOUT_OPTIONS.map((v) => {
            const selected = layout === v
            return (
              <TouchableRipple key={v} onPress={() => setLayout(v)} borderless style={[styles.layoutChip, selected && styles.chipSelected]}>
                <View style={styles.layoutChipInner}>
                  <Text variant='labelMedium' style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {BOARD_VARIANT_LABELS[v]}
                  </Text>
                  <Text variant='labelSmall' style={[styles.layoutDesc, selected && styles.layoutDescSelected]}>
                    {LAYOUT_DESCRIPTIONS[v]}
                  </Text>
                </View>
              </TouchableRipple>
            )
          })}
        </View>
      </View>

      <Button mode='contained' onPress={() => router.push({ pathname: '/game', params: { scoreTo: String(scoreTo), layout } })} style={styles.playButton}>
        Play
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderColor: 'rgba(200,216,240,0.25)',
    borderRadius: 12,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 60
  },
  chipRow: {
    flexDirection: 'row',
    gap: 10
  },
  chipSelected: {
    backgroundColor: COLORS.p1,
    borderColor: COLORS.p1
  },
  chipText: {
    color: 'rgba(255,255,255,0.5)'
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: 'bold'
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#0A1628',
    flex: 1,
    gap: 32,
    justifyContent: 'center'
  },
  layoutChip: {
    alignItems: 'center',
    borderColor: 'rgba(200,216,240,0.25)',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  layoutChipInner: {
    alignItems: 'center',
    gap: 3
  },
  layoutDesc: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9
  },
  layoutDescSelected: {
    color: 'rgba(255,255,255,0.7)'
  },
  playButton: {
    minWidth: 140
  },
  section: {
    alignItems: 'center',
    gap: 12
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 2
  },
  settings: {
    position: 'absolute',
    right: 8,
    top: 8
  },
  title: {
    color: '#FFFFFF',
    fontWeight: 'bold'
  }
})
