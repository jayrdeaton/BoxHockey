import { getStaggeredWordDuration, StaggeredWord } from '@tastic/hud'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

import { MONO_FONT } from '@/shell/fonts'

export interface HeroTitleProps {
  // The pack's wordmark, one word per line (see PackDefinition.wordmark).
  words: readonly [string, string]
  color: string
  // The live theme's p1/p2 colors - whatever the players actually picked (see Theme.tsx), not a
  // fixed pair - so the goal-line accent beneath the title always matches the real in-game colors.
  p1Color: string
  p2Color: string
}

const LINE_DURATION_MS = 280
// The puck's vertical position is one continuous chain, not a separate drop-in followed by a
// separate idle animation: it eases down from PUCK_DROP_OFFSET to the top of its bounce range,
// then keeps ping-ponging between top and bottom forever - same withRepeat idiom Board.tsx uses
// for its own idle pulses (see idlePulseT), just chained directly onto the entrance so there's no
// hand-off moment where it visibly "starts" bouncing.
const PUCK_DROP_MS = 220
const PUCK_DROP_OFFSET = -18
const BOUNCE_DURATION_MS = 550
const BOUNCE_HEIGHT = 8

// The pack's hero (as opposed to LightCycles' light-trail wordmark): two staggered
// lines of letters, then a goal-line accent - two colored bars sliding in from each side to meet
// in the middle, echoing the two goals on the real board - with a small puck dropping onto the
// seam between them once the bars land, then bouncing there for as long as the screen exists (see
// puckY above) as one continuous motion rather than a drop-in that hands off to a separate idle
// loop. The wordmark and bars themselves are a one-time entrance, not part of the loop.
export function HeroTitle({ words, color, p1Color, p2Color }: HeroTitleProps) {
  const [wordTop, wordBottom] = words
  // The goal-line accent (and the puck that drops onto it) stay hidden until the wordmark has mostly
  // landed - one "power on" beat once the letters settle, rather than motion competing with letters
  // still flying in.
  const lineDelayMs = Math.round(getStaggeredWordDuration(wordTop.length + wordBottom.length) * 0.7)
  const puckDelayMs = lineDelayMs + LINE_DURATION_MS + 60
  const reducedMotion = useReducedMotion()

  const lineProgress = useSharedValue(reducedMotion ? 1 : 0)
  useEffect(() => {
    if (reducedMotion) return
    lineProgress.value = withDelay(lineDelayMs, withTiming(1, { duration: LINE_DURATION_MS, easing: Easing.out(Easing.cubic) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const puckProgress = useSharedValue(reducedMotion ? 1 : 0)
  // Rest position is translateY 0; the bounce range is -BOUNCE_HEIGHT/2 (top) to +BOUNCE_HEIGHT/2
  // (bottom). The drop-in eases straight to the top of that range so the very next step - the
  // infinite ping-pong - just continues on from there with no discontinuity.
  const puckY = useSharedValue(reducedMotion ? -BOUNCE_HEIGHT / 2 : PUCK_DROP_OFFSET)
  useEffect(() => {
    if (reducedMotion) return
    puckProgress.value = withDelay(puckDelayMs, withTiming(1, { duration: PUCK_DROP_MS, easing: Easing.out(Easing.cubic) }))
    puckY.value = withDelay(puckDelayMs, withSequence(withTiming(-BOUNCE_HEIGHT / 2, { duration: PUCK_DROP_MS, easing: Easing.out(Easing.cubic) }), withRepeat(withTiming(BOUNCE_HEIGHT / 2, { duration: BOUNCE_DURATION_MS, easing: Easing.inOut(Easing.sin) }), -1, true)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const leftBarStyle = useAnimatedStyle(() => ({ opacity: lineProgress.value, transform: [{ scaleX: lineProgress.value }] }))
  const rightBarStyle = useAnimatedStyle(() => ({ opacity: lineProgress.value, transform: [{ scaleX: lineProgress.value }] }))
  const puckStyle = useAnimatedStyle(() => ({
    opacity: puckProgress.value,
    transform: [{ translateY: puckY.value }, { scale: 0.6 + puckProgress.value * 0.4 }]
  }))

  return (
    <View style={styles.wrapper}>
      <StaggeredWord word={wordTop} startIndex={0} color={color} fontFamily={MONO_FONT} fontSize={40} lineHeight={48} letterSpacing={4} reducedMotion={reducedMotion} />
      <StaggeredWord word={wordBottom} startIndex={wordTop.length} color={color} fontFamily={MONO_FONT} fontSize={40} lineHeight={48} letterSpacing={4} reducedMotion={reducedMotion} />

      <View style={styles.lineRow}>
        <Animated.View style={[styles.bar, styles.barLeft, { backgroundColor: p1Color }, leftBarStyle]} />
        {/* Black fill + white ring, fixed regardless of theme - matches the real in-game puck
            (see Board.tsx's puck Circle/stroke) rather than the screen's own black/white fg. */}
        <Animated.View pointerEvents='none' style={[styles.puck, puckStyle]} />
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
  lineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 14
  },
  puck: {
    backgroundColor: '#000000',
    borderColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    width: 16
  },
  wrapper: {
    alignItems: 'center'
  }
})
