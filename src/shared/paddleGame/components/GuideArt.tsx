import { useAutoPaperTheme } from '@rific/auto-paper'
import { type DirectionKeyLabels, DirectionKeysHint } from '@tastic/hud/guide'
import { StyleSheet, View } from 'react-native'
import { Icon } from 'react-native-paper'

// The paddle games' illustrations for the how-to-play cards (see constants/guideSteps.tsx). The shared
// art in @tastic/hud/guide is used wherever it fits: DirectionKeysHint (axis='vertical') for the key
// caps inside GuideUpDownKeys, and SeatDevicesHint for the desktop two-player card (used directly in
// guideSteps.tsx). What's here draws something only Pong has: SwipeHint (finger or pointer='mouse')
// draws a flick toward an arrowhead, but a Pong paddle isn't flicked one way, it lines up with
// wherever your finger or pointer is, so GuidePaddleDrag and GuideMouseDrag draw the paddle beside
// what moves it. And SeatDiagram labels P1 as the bottom half (which end each seat plays in a
// face-to-face match comes from how the phone is held, see game.tsx's rotation, so a label saying
// which half is whose could be wrong; GuideSplitPhone below avoids the same claim by drawing both
// halves in one neutral color). Plain Views and paper Icons only: no Skia, so they cost nothing to
// mount over the Home screen. Seat colors come from the live theme (primary = P1, secondary = P2),
// so they always match the colors the players have picked.

const PADDLE_THICKNESS = 6

// A finger over a paddle that lines up beneath it: the "your paddle follows your finger" idea,
// drawn the way a phone held upright plays (the court is rotated so each paddle runs across one end
// of the screen and moves side to side; see game.tsx's rotation). The dotted line is the point: the
// paddle goes where the finger is, it doesn't need touching.
export function GuidePaddleDrag() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel='A finger dragging sideways, with the paddle lined up beneath it' style={styles.dragStage}>
      <View style={styles.fingerRow}>
        <Icon source='chevron-left' size={24} color={colors.primary} />
        <View style={[styles.finger, { borderColor: colors.primary }]} />
        <Icon source='chevron-right' size={24} color={colors.primary} />
      </View>
      <View style={styles.guideLine}>
        {Array.from({ length: 4 }, (_, i) => (
          <View key={i} style={[styles.guideDot, { backgroundColor: colors.primary }]} />
        ))}
      </View>
      <View style={[styles.paddleAcross, { backgroundColor: colors.primary }]} />
    </View>
  )
}

// The two caps a Pong seat's key scheme uses: KeyboardInputLayer only ever reads up and down.
export type UpDownKeyLabels = Pick<DirectionKeyLabels, 'up' | 'down'>

// The desktop counterpart to GuidePaddleDrag for a seat on a key scheme: an upright paddle beside
// hud's up-over-down DirectionKeysHint, printed with that seat's own two keys (arrow icons when
// `labels` is omitted, i.e. the arrow keys themselves). A wide desktop window plays the court
// unrotated, paddles at the left and right edges moving up and down.
export function GuideUpDownKeys({ labels }: { labels?: UpDownKeyLabels }) {
  const { colors } = useAutoPaperTheme()

  return (
    <View style={styles.desktopRow}>
      <View style={[styles.paddleUpright, { backgroundColor: colors.primary }]} />
      <DirectionKeysHint axis='vertical' labels={labels} />
    </View>
  )
}

// The desktop counterpart to GuidePaddleDrag for a seat left on 'mouse': TouchInputLayer's own
// drag input, driven by the pointer instead of a finger.
export function GuideMouseDrag() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel='A mouse moving up and down, beside a paddle' style={styles.desktopRow}>
      <View style={[styles.paddleUpright, { backgroundColor: colors.primary }]} />
      <Icon source='mouse-move-vertical' size={56} color={colors.primary} />
    </View>
  )
}

// Player 1's shot getting past player 2's paddle, the one way to score in a versus match. Drawn in
// the court's own native shape (wide, a paddle at each end), not rotated for any particular hold.
export function GuideScorePoint() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel="The puck getting past the other player's paddle" style={[styles.court, { borderColor: colors.onSurface }]}>
      <View style={[styles.centerLine, { backgroundColor: colors.onSurface }]} />
      <View style={[styles.courtPaddle, styles.courtPaddleLeft, { backgroundColor: colors.primary }]} />
      <View style={[styles.courtPaddle, styles.courtPaddleRight, { backgroundColor: colors.secondary }]} />
      {TRAIL.map(([left, top], i) => (
        <View key={i} style={[styles.trailDot, { left, top, backgroundColor: colors.onSurface, opacity: 0.25 + (0.5 * i) / (TRAIL.length - 1) }]} />
      ))}
      <View style={styles.puck} />
    </View>
  )
}

// Breaker's brick field: a block of bricks across the middle of the court, one already broken, with
// both paddles for a versus round or only player 1's (and the far wall) for a round alone, the way
// the play screen draws them.
export function GuideBrickField({ alone = false }: { alone?: boolean }) {
  const { colors } = useAutoPaperTheme()
  const rows = [0, 1, 2, 3, 4]
  const cols = alone ? [0, 1, 2, 3] : [0, 1]
  const left = alone ? 62 : 70
  const label = alone ? 'One paddle facing a field of bricks' : 'A block of bricks between the two paddles'

  return (
    <View accessible accessibilityLabel={label} style={[styles.court, { borderColor: colors.onSurface }]}>
      <View style={[styles.courtPaddle, styles.courtPaddleLeft, { backgroundColor: colors.primary }]} />
      {alone ? <View style={[styles.farWall, { backgroundColor: colors.onSurface }]} /> : <View style={[styles.courtPaddle, styles.courtPaddleRight, { backgroundColor: colors.secondary }]} />}
      {rows.flatMap((row) => cols.map((col) => (row === 2 && col === 0 ? null : <View key={`${row}-${col}`} style={[styles.brick, { left: left + col * (BRICK_W + 2), top: 14 + row * (BRICK_H + 2), backgroundColor: colors.onSurface }]} />)))}
      <View style={[styles.puck, styles.puckAtBricks]} />
    </View>
  )
}

// The two-player touch seating: one phone, split in half, a paddle in each half. Both halves are
// drawn identically in the neutral onSurface color, with no seat colors and no labels, so the art
// makes no claim about which end is whose. That claim isn't settled: the two-player loadout seats
// P1 at the bottom, but game.tsx's rotation puts P1's paddle and touch zone at the top for the
// common hold (see the file-level note on SeatDiagram). If a device check settles it, seat tints (or
// hud's SeatDiagram) can come back here.
export function GuideSplitPhone() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel='A phone split in two halves, with a paddle in each half' style={[styles.device, { borderColor: colors.onSurface }]}>
      <View style={styles.half}>
        <View style={[styles.devicePaddle, { backgroundColor: colors.onSurface }]} />
      </View>
      <View style={[styles.divider, { backgroundColor: colors.onSurface }]} />
      <View style={[styles.half, styles.bottomHalf]}>
        <View style={[styles.devicePaddle, { backgroundColor: colors.onSurface }]} />
      </View>
    </View>
  )
}

// GuideBrickField's bricks.
const BRICK_W = 12
const BRICK_H = 14

// GuideScorePoint's puck path, from player 1's paddle out past player 2's: [left, top] of each dot.
const TRAIL: [number, number][] = [
  [26, 44],
  [48, 49],
  [70, 54],
  [92, 59],
  [114, 64],
  [136, 69]
]

const styles = StyleSheet.create({
  bottomHalf: {
    justifyContent: 'flex-end'
  },
  brick: {
    borderRadius: 2,
    height: BRICK_H,
    opacity: 0.6,
    position: 'absolute',
    width: BRICK_W
  },
  centerLine: {
    bottom: 8,
    left: 81,
    opacity: 0.25,
    position: 'absolute',
    top: 8,
    width: 2
  },
  court: {
    borderRadius: 8,
    borderWidth: 2,
    height: 104,
    width: 168
  },
  courtPaddle: {
    borderRadius: 2,
    height: 32,
    position: 'absolute',
    width: PADDLE_THICKNESS
  },
  courtPaddleLeft: {
    left: 12,
    top: 30
  },
  courtPaddleRight: {
    left: 144,
    top: 18
  },
  desktopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 24
  },
  device: {
    borderRadius: 16,
    borderWidth: 2,
    height: 120,
    overflow: 'hidden',
    width: 88
  },
  devicePaddle: {
    alignSelf: 'center',
    borderRadius: 2,
    height: PADDLE_THICKNESS,
    marginVertical: 12,
    width: 34
  },
  divider: {
    height: 2,
    opacity: 0.4
  },
  dragStage: {
    alignItems: 'center',
    gap: 6
  },
  // Solo's far wall, in place of player 2's paddle.
  farWall: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 4
  },
  finger: {
    borderRadius: 14,
    borderWidth: 3,
    height: 28,
    width: 28
  },
  fingerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  guideDot: {
    borderRadius: 2,
    height: 4,
    opacity: 0.5,
    width: 4
  },
  guideLine: {
    alignItems: 'center',
    gap: 5
  },
  half: {
    flex: 1
  },
  paddleAcross: {
    borderRadius: 2,
    height: PADDLE_THICKNESS + 2,
    width: 72
  },
  paddleUpright: {
    borderRadius: 2,
    height: 72,
    width: PADDLE_THICKNESS + 2
  },
  // The puck: the play screen's black disc with a white ring, so it reads on either theme.
  puck: {
    backgroundColor: '#000000',
    borderColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1.5,
    height: 12,
    left: 149,
    position: 'absolute',
    top: 69,
    width: 12
  },
  // GuideBrickField's puck, on its way from player 1's paddle to the gap a broken brick left.
  puckAtBricks: {
    left: 40,
    top: 47
  },
  trailDot: {
    borderRadius: 3,
    height: 6,
    position: 'absolute',
    width: 6
  }
})
