import { useAutoPaperTheme } from '@rific/auto-paper'
import { Canvas, DashPathEffect, Line, Rect, RoundedRect, vec } from '@shopify/react-native-skia'
import { Disc, ObstacleRect } from '@tastic/sprites/shapes'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { cancelAnimation, Easing, useDerivedValue, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { BallState, BoardLayout, Brick, GamePhase, PaddleStates } from '@/shared/paddleGame/types'

export interface BoardProps {
  board: BoardLayout
  ball: BallState
  paddles: PaddleStates
  phase: GamePhase
  // Perimeter top/bottom walls - see game.tsx's isDesktopWeb. On a phone (native or mobile web)
  // they'd sit redundantly right against the device's own physical edge, which already reads as the
  // boundary; only desktop web, with no such edge, gets them drawn.
  showWalls: boolean
  bricks: Brick[]
  // Solo/Brickbreaker: no second paddle (see below), and the far edge renders as a solid wall -
  // unconditionally, unlike showWalls above, since without it the new bounce-instead-of-score
  // behavior at that edge would be inexplicable to the player.
  soloMode: boolean
}

export default function Board({ board, ball, paddles, phase, showWalls, bricks, soloMode }: BoardProps) {
  const { x, y, width, height, wallThickness, ballRadius, paddleWidth, paddleHeight } = board
  const { colors: themeColors, dark } = useAutoPaperTheme()

  // Retro-vector palette, same convention as the games this was cloned from: the board's own
  // structure (walls/centerline) is a literal black/white-by-appearance neutral, not a themed
  // color, since it's scaffolding rather than a gameplay signal - a player's own paddle color is the
  // only saturated color on screen. The puck is Air Hockey's black disc with a white ring.
  const wallColor = dark ? '#FFFFFF' : '#000000'
  const centerLineColor = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  // A gentle "not live yet" breathe during the pre-game/post-point pause - plain and static once
  // play is actually live. The whole puck pulses, not just its ring as Air Hockey's does, since a
  // white ring alone doesn't show on a light theme.
  const waiting = phase !== 'live'
  const idlePulseT = useSharedValue(0)
  useEffect(() => {
    if (waiting) {
      idlePulseT.value = 0
      idlePulseT.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(idlePulseT)
      idlePulseT.value = 0
    }
  }, [waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  const ballOpacity = useDerivedValue(() => (waiting ? 0.5 + idlePulseT.value * 0.5 : 1))

  // ~0.3x paddleWidth corner radius, per the design spec - a small, subtle round rather than a
  // fully pill-shaped bar.
  const paddleCornerRadius = paddleWidth * 0.3

  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Dashed center line at board.centerX - Pong has no "own half" clamp the way AirHockey's
            solid centerline implied (see clampPaddleY in utils/board.ts, which spans the FULL board
            height for both paddles), so this is purely a classic-Pong visual cue, not a rule
            boundary. */}
        <Line p1={vec(board.centerX, y)} p2={vec(board.centerX, y + height)} color={centerLineColor} strokeWidth={2}>
          <DashPathEffect intervals={[10, 10]} />
        </Line>

        {/* Perimeter top/bottom walls - desktop web only, see BoardProps' showWalls doc comment. */}
        {showWalls && (
          <>
            <Rect x={x - wallThickness} y={y - wallThickness} width={width + wallThickness * 2} height={wallThickness} color={wallColor} />
            <Rect x={x - wallThickness} y={y + height} width={width + wallThickness * 2} height={wallThickness} color={wallColor} />
          </>
        )}

        {/* Solo/Brickbreaker's far wall - unconditional (not gated by showWalls above), since it
            replaces P2's own edge/paddle rather than being a cosmetic desktop-web extra: without it
            the far edge would look identical to a normal scoring edge and the new bounce behavior
            there would make no visual sense. Same shape AirHockey uses for its own side walls. */}
        {soloMode && <ObstacleRect x={x + width} y={y - wallThickness} width={wallThickness} height={height + wallThickness * 2} color={wallColor} />}

        {/* Bricks - destructible, filtered before mapping so a destroyed one simply stops
            rendering. Same fleet idiom AirHockey/BoxHockey use for their own (permanent) Obstacle
            arrays, reusing the neutral wallColor rather than a separate palette. Keyed by position
            (fixed for a brick's whole lifetime), not array index - filtering destroyed ones out
            shifts later bricks' indices, which would otherwise make React reuse a Skia node across
            two different bricks and read as one brick jumping to another's spot. */}
        {bricks
          .filter((b) => !b.destroyed)
          .map((b) => (
            <ObstacleRect key={`${b.x}-${b.y}`} x={b.x} y={b.y} width={b.width} height={b.height} color={wallColor} />
          ))}

        {/* Paddles - bars, not discs (see BoardLayout's own paddleWidth/paddleHeight doc comment in
            types/index.ts): each only ever moves on Y, drawn centered on paddles[player].y at its
            fixed board.paddleX[player]. P2 doesn't exist in solo - see soloMode above. */}
        <RoundedRect x={paddles[1].x - paddleWidth / 2} y={paddles[1].y - paddleHeight / 2} width={paddleWidth} height={paddleHeight} r={paddleCornerRadius} color={p1Color} />
        {!soloMode && <RoundedRect x={paddles[2].x - paddleWidth / 2} y={paddles[2].y - paddleHeight / 2} width={paddleWidth} height={paddleHeight} r={paddleCornerRadius} color={p2Color} />}

        {/* The ball, drawn as a puck (PuckTastic's paddle games): Air Hockey's flat black puck with
            a white ring, so it reads on either theme, softly pulsing while waiting to go live. The
            physics still call it the ball. */}
        <Disc x={ball.x} y={ball.y} radius={ballRadius} color='#000000' ringColor='#FFFFFF' opacity={ballOpacity} />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }
})
