import { useAutoPaperTheme } from '@rific/auto-paper'
import { SwipeHint } from '@tastic/hud/guide'
import { StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import { MONO_FONT } from '@/constants/fonts'
import { CONTROL_SCHEME_SIGN } from '@/constants/game'
import type { ControlScheme } from '@/types'

// BoxHockey-specific illustrations for the how-to-play cards (see constants/guideSteps.tsx). The
// generic SwipeHint lives in @tastic/hud/guide; these only make sense for this game. Plain Views and
// react-native-paper Icons: no Skia, so they cost nothing to mount over the Home screen. Seat colors
// come from the live theme (primary = P1, secondary = P2, the same pair Board.tsx draws with), so the
// pictures always match the colors the players have actually picked. Player 1 is always drawn at the
// bottom, attacking upward, exactly as on the real board (see faceoffZoneCenters in utils/board.ts).

// The real puck's look: a flat black disc with a ring in the color of whoever shoots next (see
// Board.tsx's Disc/ringColor).
function Puck({ ringColor }: { ringColor: string }) {
  return <View style={[styles.puck, { borderColor: ringColor }]} />
}

// "Shoot the Puck": the gesture on the right, the puck and the way it flies on the left. The drag
// direction comes straight from CONTROL_SCHEME_SIGN, the same table the engine fires shots with,
// so 'pull' (a slingshot) draws a drag DOWN while the puck still flies up, and 'push'/'flick' draw
// the drag the same way as the shot. Touch gets the shared animated SwipeHint; desktop gets a mouse
// instead, since a desktop player shoots by dragging the mouse, never by swiping.
export function GuideShotArt({ scheme, touch }: { scheme: ControlScheme; touch: boolean }) {
  const { colors } = useAutoPaperTheme()
  const drag = CONTROL_SCHEME_SIGN[scheme] < 0 ? 'down' : 'up'
  const gesture = scheme === 'stick' ? 'Swing' : touch && scheme === 'flick' ? 'Swipe' : 'Drag'

  return (
    <View accessible accessibilityLabel={`${gesture} ${drag} and the puck flies up`} style={styles.shotRow}>
      <View style={styles.shotPuck}>
        <Icon source='arrow-up-bold' size={28} color={colors.primary} />
        <Puck ringColor={colors.primary} />
      </View>
      {touch ? <SwipeHint direction={drag} length={56} /> : <Icon source={drag === 'up' ? 'mouse-move-up' : 'mouse-move-down'} size={56} color={colors.primary} />}
    </View>
  )
}

// "First to N Goals Wins": the default (classic) board seen from player 1's seat: player 2's goal in
// their color at the top, player 1's in theirs at the bottom (Board.tsx tints each crease in its
// owner's color), the center wall with its two off-center holes, and player 1's puck (ring in their
// color: their turn) aimed up the ice at the other player's goal.
export function GuideGoalArt() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel='A puck at the bottom of the rink, aimed at the other player’s goal at the top' style={[styles.rink, { borderColor: colors.outline }]}>
      <View style={[styles.goal, styles.goalTop, { backgroundColor: colors.secondary }]} />
      <View style={[styles.goal, styles.goalBottom, { backgroundColor: colors.primary }]} />
      <View style={styles.divider}>
        <View style={[styles.dividerSegment, styles.dividerEnd, { backgroundColor: colors.outline }]} />
        <View style={[styles.dividerSegment, styles.dividerMiddle, { backgroundColor: colors.outline }]} />
        <View style={[styles.dividerSegment, styles.dividerEnd, { backgroundColor: colors.outline }]} />
      </View>
      <View style={styles.rinkPuck}>
        <Icon source='arrow-up' size={18} color={colors.primary} />
        <Puck ringColor={colors.primary} />
      </View>
    </View>
  )
}

interface FaceoffCircleProps {
  color: string
  onColor: string
  lit: boolean
  label?: string
}

// One face-off dot as Board.tsx draws it: a thin ring in the seat's color with a dot in the middle,
// filled with that color once it's the live target. On desktop the key that presses it sits on top,
// the same way game.tsx's own key hints do.
function FaceoffCircle({ color, onColor, lit, label }: FaceoffCircleProps) {
  return (
    <View style={[styles.faceoffCircle, { borderColor: color }]}>
      {lit && <View style={[StyleSheet.absoluteFill, styles.faceoffLitFill, { backgroundColor: color }]} />}
      {label !== undefined ? <Text style={[styles.faceoffKey, { color: lit ? onColor : color, fontFamily: MONO_FONT }]}>{label}</Text> : <View style={[styles.faceoffDot, { backgroundColor: lit ? onColor : color }]} />}
    </View>
  )
}

// "Win the Face-Off": the real layout, each player's two circles in their own half (player 2's on
// top, player 1's on the bottom, each half washed in its seat color like SeatDiagram's), one of each
// pair lit. `keys` (desktop web) labels the circles with the keys that press them: A/D for player 1,
// ←/→ for player 2 (game.tsx's FACEOFF_KEY_HINTS; zone 0 is the left circle, see
// faceoffZoneCenters).
export function GuideFaceoffArt({ keys }: { keys: boolean }) {
  const { colors } = useAutoPaperTheme()
  const label = keys ? 'Player 1 uses A and D, player 2 uses the left and right arrows' : 'Player 1 plays the bottom half, player 2 the top half'

  return (
    <View accessible accessibilityLabel={label} style={[styles.device, { borderColor: colors.onSurface }]}>
      <View style={styles.half}>
        <View style={[StyleSheet.absoluteFill, styles.halfTint, { backgroundColor: colors.secondary }]} />
        <FaceoffCircle color={colors.secondary} onColor={colors.onSecondary} lit label={keys ? '←' : undefined} />
        <FaceoffCircle color={colors.secondary} onColor={colors.onSecondary} lit={false} label={keys ? '→' : undefined} />
      </View>
      <View style={[styles.halfDivider, { backgroundColor: colors.onSurface }]} />
      <View style={styles.half}>
        <View style={[StyleSheet.absoluteFill, styles.halfTint, { backgroundColor: colors.primary }]} />
        <FaceoffCircle color={colors.primary} onColor={colors.onPrimary} lit={false} label={keys ? 'A' : undefined} />
        <FaceoffCircle color={colors.primary} onColor={colors.onPrimary} lit label={keys ? 'D' : undefined} />
      </View>
    </View>
  )
}

// "Flip for the First Shot": the coin Board.tsx spins at center ice, one face in each seat's color.
export function GuideCoinArt() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel='A coin with one face in each player’s color' style={[styles.coin, { borderColor: colors.onSurface }]}>
      <View style={[styles.coinFace, { backgroundColor: colors.primary }]} />
      <View style={[styles.coinFace, { backgroundColor: colors.secondary }]} />
    </View>
  )
}

// "Tap Together, Then Swipe": three taps, then a swipe (touch only: the Triple Tap tip-off is hidden on web,
// see loadout.tsx's TIPOFF_MODE_OPTIONS).
export function GuideTripleTapArt() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel='Tap three times, then swipe' style={styles.shotRow}>
      <Icon source='gesture-double-tap' size={48} color={colors.primary} />
      <SwipeHint direction='up' length={48} />
    </View>
  )
}

const PUCK_SIZE = 18
const RINK_WIDTH = 72
const RINK_HEIGHT = 112
const GOAL_WIDTH = 24
const FACEOFF_CIRCLE_SIZE = 26

const styles = StyleSheet.create({
  coin: {
    borderRadius: 32,
    borderWidth: 2,
    flexDirection: 'row',
    height: 64,
    overflow: 'hidden',
    width: 64
  },
  coinFace: {
    flex: 1
  },
  device: {
    borderRadius: 16,
    borderWidth: 2,
    height: 120,
    overflow: 'hidden',
    width: 88
  },
  divider: {
    flexDirection: 'row',
    left: 0,
    position: 'absolute',
    right: 0,
    top: RINK_HEIGHT / 2 - 3
  },
  // Two holes, each off to its own side of center (utils/board.ts's classic case), so the middle
  // segment spans the center line and blocks the straight path between the goals.
  dividerEnd: {
    flex: 1
  },
  dividerMiddle: {
    flex: 3,
    marginHorizontal: 12
  },
  dividerSegment: {
    height: 2
  },
  faceoffCircle: {
    alignItems: 'center',
    borderRadius: FACEOFF_CIRCLE_SIZE / 2,
    borderWidth: 1.5,
    height: FACEOFF_CIRCLE_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: FACEOFF_CIRCLE_SIZE
  },
  faceoffDot: {
    borderRadius: 3,
    height: 6,
    width: 6
  },
  faceoffKey: {
    fontSize: 13,
    fontWeight: 'bold'
  },
  faceoffLitFill: {
    opacity: 0.85
  },
  goal: {
    height: 4,
    left: (RINK_WIDTH - 4 - GOAL_WIDTH) / 2,
    position: 'absolute',
    width: GOAL_WIDTH
  },
  goalBottom: {
    bottom: -3
  },
  goalTop: {
    top: -3
  },
  half: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center'
  },
  halfDivider: {
    height: 2
  },
  // A wash of the seat color rather than an rgba() fill: the theme's colors aren't guaranteed to be
  // 6-digit hex, so an opacity layer is the only alpha that always works (same as SeatDiagram).
  halfTint: {
    opacity: 0.2
  },
  puck: {
    backgroundColor: '#000000',
    borderRadius: PUCK_SIZE / 2,
    borderWidth: 2.5,
    height: PUCK_SIZE,
    width: PUCK_SIZE
  },
  rink: {
    borderRadius: 6,
    borderWidth: 2,
    height: RINK_HEIGHT,
    width: RINK_WIDTH
  },
  rinkPuck: {
    alignItems: 'center',
    bottom: 12,
    left: 0,
    position: 'absolute',
    right: 0
  },
  shotPuck: {
    alignItems: 'center',
    gap: 4
  },
  shotRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 28
  }
})
