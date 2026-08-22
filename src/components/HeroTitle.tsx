import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated'

import { MONO_FONT } from '@/constants/fonts'

export interface HeroTitleProps {
  color: string
  // The live theme's p1/p2 colors — whatever the players actually picked (see Theme.tsx), not a
  // fixed pair — so the goal-line accent beneath the title always matches the real in-game colors.
  p1Color: string
  p2Color: string
}

const WORD_TOP = 'BOX'
const WORD_BOTTOM = 'HOCKEY'
const TOTAL_LETTERS = WORD_TOP.length + WORD_BOTTOM.length

const STAGGER_MS = 45
const LETTER_DURATION_MS = 320
const TOTAL_STAGGER_MS = (TOTAL_LETTERS - 1) * STAGGER_MS + LETTER_DURATION_MS

// The goal-line accent (and the puck that drops onto it) stay hidden until the wordmark has mostly
// landed — one "power on" beat once the letters settle, rather than motion competing with letters
// still flying in.
const LINE_DELAY_MS = Math.round(TOTAL_STAGGER_MS * 0.7)
const LINE_DURATION_MS = 280
const PUCK_DELAY_MS = LINE_DELAY_MS + LINE_DURATION_MS + 60

function AnimatedLetter({ char, index, color, reducedMotion }: { char: string; index: number; color: string; reducedMotion: boolean }) {
  const progress = useSharedValue(reducedMotion ? 1 : 0)

  useEffect(() => {
    if (reducedMotion) return
    progress.value = withDelay(index * STAGGER_MS, withTiming(1, { duration: LETTER_DURATION_MS, easing: Easing.out(Easing.back(1.5)) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }, { scale: 0.85 + progress.value * 0.15 }]
  }))

  return (
    <Animated.Text allowFontScaling={false} style={[styles.letter, { color }, style]}>
      {char}
    </Animated.Text>
  )
}

function Word({ text, startIndex, color, reducedMotion }: { text: string; startIndex: number; color: string; reducedMotion: boolean }) {
  return (
    <View style={styles.word}>
      {text.split('').map((char, i) => (
        <AnimatedLetter key={i} char={char} index={startIndex + i} color={color} reducedMotion={reducedMotion} />
      ))}
    </View>
  )
}

// Bespoke hero for this game (as opposed to LightCycles' light-trail wordmark): two staggered
// lines of letters, then a goal-line accent — two colored bars sliding in from each side to meet
// in the middle, echoing the two goals on the real board — with a small puck dropping onto the
// seam between them once the bars land.
export function HeroTitle({ color, p1Color, p2Color }: HeroTitleProps) {
  const reducedMotion = useReducedMotion()

  const lineProgress = useSharedValue(reducedMotion ? 1 : 0)
  useEffect(() => {
    if (reducedMotion) return
    lineProgress.value = withDelay(LINE_DELAY_MS, withTiming(1, { duration: LINE_DURATION_MS, easing: Easing.out(Easing.cubic) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const puckProgress = useSharedValue(reducedMotion ? 1 : 0)
  useEffect(() => {
    if (reducedMotion) return
    puckProgress.value = withDelay(PUCK_DELAY_MS, withSpring(1, { damping: 8, stiffness: 180 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const leftBarStyle = useAnimatedStyle(() => ({ opacity: lineProgress.value, transform: [{ scaleX: lineProgress.value }] }))
  const rightBarStyle = useAnimatedStyle(() => ({ opacity: lineProgress.value, transform: [{ scaleX: lineProgress.value }] }))
  const puckStyle = useAnimatedStyle(() => ({
    opacity: puckProgress.value,
    transform: [{ translateY: (1 - puckProgress.value) * -18 }, { scale: 0.6 + puckProgress.value * 0.4 }]
  }))

  return (
    <View style={styles.wrapper}>
      <Word text={WORD_TOP} startIndex={0} color={color} reducedMotion={reducedMotion} />
      <Word text={WORD_BOTTOM} startIndex={WORD_TOP.length} color={color} reducedMotion={reducedMotion} />

      <View style={styles.lineRow}>
        <Animated.View style={[styles.bar, styles.barLeft, { backgroundColor: p1Color }, leftBarStyle]} />
        <Animated.View pointerEvents='none' style={[styles.puck, { backgroundColor: color }, puckStyle]} />
        <Animated.View style={[styles.bar, styles.barRight, { backgroundColor: p2Color }, rightBarStyle]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: 2,
    height: 4,
    width: 44
  },
  barLeft: {
    transformOrigin: 'right center'
  },
  barRight: {
    transformOrigin: 'left center'
  },
  letter: {
    fontFamily: MONO_FONT,
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: 4,
    lineHeight: 48
  },
  lineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 14
  },
  puck: {
    borderRadius: 6,
    height: 12,
    width: 12
  },
  word: {
    flexDirection: 'row'
  },
  wrapper: {
    alignItems: 'center'
  }
})
