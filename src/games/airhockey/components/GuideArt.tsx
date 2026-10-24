import { useAutoPaperTheme } from '@rific/auto-paper'
import { StyleSheet, View } from 'react-native'

// AirHockey-specific illustration for the how-to-play cards (see constants/guideSteps.tsx). The
// generic ones (SwipeHint, DirectionKeysHint, SeatDiagram, SeatDevicesHint) live in @tastic/hud/guide;
// this one only makes sense for this game. Plain Views: no Skia, so it costs nothing to mount over the
// Home screen. Its color comes from the live theme (primary = P1), so it always matches the color
// player 1 has actually picked.

const CREASE_RADIUS = 52
const ARC_THICKNESS = 6
// Pixels shaved off each segment's length so neighbors show a gap, like ScoreWedges' own gapDeg.
const ARC_GAP = 6
const STAGE_WIDTH = 156
const GOAL_LINE_Y = 76

interface GuideScoreArcsProps {
  // settings.scoreToWin: the game draws exactly one arc per point needed (computeGoalWedges).
  count: number
  // How many to draw as already scored; the rest stay in the neutral line color.
  filled: number
}

// The in-game scoreboard, which is never a number during play: player 1's own goal crease, its
// half-circle split into one arc per point needed, the first few lit in their color. Mirrors
// Board.tsx's crease tint + ScoreWedges (filled from the left end, over the top, to the right:
// computeGoalWedges' baseAngle 180 for the local-bottom goal). Each arc is drawn as its chord, a
// straight rounded bar: close enough to read as the same picture without Skia.
export function GuideScoreArcs({ count, filled }: GuideScoreArcsProps) {
  const { colors } = useAutoPaperTheme()
  const cx = STAGE_WIDTH / 2
  const sweep = Math.PI / count

  const segments = Array.from({ length: count }, (_, i) => {
    const mid = Math.PI + (i + 0.5) * sweep
    const length = Math.max(ARC_THICKNESS, 2 * CREASE_RADIUS * Math.sin(sweep / 2) - ARC_GAP)
    // The chord's own midpoint sits slightly inside the circle, at R·cos(sweep/2).
    const inset = CREASE_RADIUS * Math.cos(sweep / 2)
    return {
      key: i,
      left: cx + inset * Math.cos(mid) - length / 2,
      top: GOAL_LINE_Y + inset * Math.sin(mid) - ARC_THICKNESS / 2,
      width: length,
      rotate: `${(mid * 180) / Math.PI + 90}deg`,
      lit: i < filled
    }
  })

  return (
    <View accessible accessibilityLabel={`${filled} of ${count} score arcs lit in front of a goal`} style={styles.scoreStage}>
      <View style={[styles.crease, { backgroundColor: colors.primary }]} />
      <View style={[styles.goalLine, { backgroundColor: colors.onSurface }]} />
      {segments.map((s) => (
        <View key={s.key} style={[styles.arc, !s.lit && styles.arcUnlit, { left: s.left, top: s.top, width: s.width, transform: [{ rotate: s.rotate }], backgroundColor: s.lit ? colors.primary : colors.onSurface }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  arc: {
    borderRadius: ARC_THICKNESS / 2,
    height: ARC_THICKNESS,
    position: 'absolute'
  },
  // Unscored arcs, in the neutral line color like Board.tsx's unfilled wedges.
  arcUnlit: {
    opacity: 0.3
  },
  // Board.tsx tints each crease at 0.28 opacity in its owner's color; same here.
  crease: {
    borderTopLeftRadius: CREASE_RADIUS,
    borderTopRightRadius: CREASE_RADIUS,
    height: CREASE_RADIUS,
    left: STAGE_WIDTH / 2 - CREASE_RADIUS,
    opacity: 0.28,
    position: 'absolute',
    top: GOAL_LINE_Y - CREASE_RADIUS,
    width: CREASE_RADIUS * 2
  },
  goalLine: {
    height: 4,
    left: 8,
    opacity: 0.6,
    position: 'absolute',
    top: GOAL_LINE_Y,
    width: STAGE_WIDTH - 16
  },
  scoreStage: {
    height: GOAL_LINE_Y + 12,
    width: STAGE_WIDTH
  }
})
