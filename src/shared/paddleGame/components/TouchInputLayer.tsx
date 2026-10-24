import { callWorkletCallback, useWorkletCallback } from '@rific/core'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'

import { Player } from '@/shared/paddleGame/types'

export interface TouchInputLayerProps {
  // [1, 2] for two-player; [1] or [2] for vs-CPU, where the single human gets the whole board as
  // their own input area (see the solo branch below) rather than half of it.
  humanPlayers: Player[]
  enabled: boolean
  // The LOCAL (pre-rotation) container's own height - the same value game.tsx feeds as
  // computeBoardLayout's own screenHeight/screenWidth arg (whichever ends up "height" after the
  // orientation-driven swap - see game.tsx's own comment on containerWidth/containerHeight). Needed
  // to convert a touch's real screen position back into the local Y board.ts's paddleMinY/paddleMaxY
  // already assume - see screenToLocalY below.
  containerHeight: number
  // The SAME rotation game.tsx applies to the board's own container (0 for sideBySide, ±90 for
  // faceToFace - see game.tsx's own doc comment on why this is the mirror image of
  // @tastic/split-screen's own getFixedZoneRotation/getViewRotation convention). Needed to invert a
  // touch's real e.absoluteX/absoluteY back into this same local space by hand, since RNGH does not
  // correct for an ancestor View's rotation on its own.
  rotation: 0 | 90 | -90
  // Called with the LOCAL (board-space) Y only - a Pong paddle only ever moves on one axis (see
  // PaddleState's own doc comment in types/index.ts: x is permanently fixed by board.paddleX).
  onPaddleTargetY: (player: Player, y: number) => void
}

// Converts a real screen-space touch position back into the local board's Y coordinate by hand,
// using the exact inverse of the CSS rotation game.tsx applies to the board's own container.
// Mirrors AirHockey's old screenToLocal technique (see AirHockey/src/components/TouchInputLayer.tsx)
// - working from e.absoluteX/absoluteY (real, unambiguous screen position, independent of which
// transformed view the gesture is physically attached to) and inverting the KNOWN rotation
// explicitly, rather than trusting RNGH's own e.x/e.y to have already accounted for an ancestor's
// rotation (verified in AirHockey's own browser-preview testing that it does not). Only Y is
// extracted (unlike AirHockey, which needed both axes) since a Pong paddle never moves in X.
function screenToLocalY(absX: number, absY: number, screenCenterX: number, screenCenterY: number, rotation: 0 | 90 | -90, containerHeight: number): number {
  'worklet'
  const dx = absX - screenCenterX
  const dy = absY - screenCenterY
  let ly: number
  if (rotation === 90) ly = -dx
  else if (rotation === -90) ly = dx
  else ly = dy
  return containerHeight / 2 + ly
}

// Two independent single-finger Pan gestures, each on its OWN View - modeled directly on
// AirHockey's TouchInputLayer, which deliberately does NOT use one shared view split via `hitSlop`:
// two fingers landing in the same native touch batch (a genuine simultaneous two-player touch, not
// two touches a few frames apart) raced on which recognizer claimed which pointer on a single
// shared view, and lost one or both - a documented real bug. Two separate native views/recognizers
// have nothing left to race.
//
// Zones split the UNROTATED real screen (not the rotated local board space) - deliberately, and
// deliberately NOT always left/right: the split axis has to be whichever REAL axis stays
// PERPENDICULAR to the direction local Y ends up mapping onto once rotation is applied, or roughly
// half of each paddle's travel range becomes physically unreachable from its own zone. Concretely,
// for rotation === 0 (sideBySide), local Y maps straight onto real Y, so the two zones split real X
// (left/right - each paddle slides vertically within its own left-or-right half, the classic
// side-by-side arrangement). For rotation === ±90 (faceToFace), local Y maps onto real X instead, so
// the zones split real Y (top/bottom) - each paddle instead slides HORIZONTALLY within its own
// top-or-bottom half. Root causes traced by hand: with rotation === 90, local-left (paddle 1's own
// side) maps to a NEGATIVE real Y offset (near the screen's top), and rotation === -90 flips that to
// the bottom - so "zone A" (whichever physical half is assigned first) is always paddle 1's zone,
// and "zone B" is always paddle 2's, regardless of which real edge each one currently occupies.
//
// This part of the layout is a deliberate, worked-through departure from a plan note that described
// the split as unconditionally left/right - see game.tsx's/this phase's own report for the full
// reasoning (a literal always-left/right split leaves roughly half of each paddle's local-Y travel
// range unreachable once rotation !== 0).
export default function TouchInputLayer({ humanPlayers, enabled, containerHeight, rotation, onPaddleTargetY }: TouchInputLayerProps) {
  const solo = humanPlayers.length === 1
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()

  // Everything the gesture callbacks need, kept in a ref rather than closed over directly, so the
  // callbacks - and therefore the Gesture objects built from them below - stay referentially stable
  // across renders (a Gesture object rebuilt on every layout/state tick can silently drop touches -
  // see AirHockey's own TouchInputLayer for the original repro).
  const latestRef = useRef({ onPaddleTargetY, screenWidth, screenHeight, containerHeight, rotation })
  useEffect(() => {
    latestRef.current = { onPaddleTargetY, screenWidth, screenHeight, containerHeight, rotation }
  })

  const handleTouch = useCallback((player: Player, absX: number, absY: number) => {
    const { onPaddleTargetY, screenWidth, screenHeight, containerHeight, rotation } = latestRef.current
    const y = screenToLocalY(absX, absY, screenWidth / 2, screenHeight / 2, rotation, containerHeight)
    onPaddleTargetY(player, y)
  }, [])

  // The worklets below call handleTouch through a key and the module-level callWorkletCallback, never scheduleOnRN(handleTouch)
  // directly: native code holds a scheduleOnRN target for as long as the gesture's cached worklet lives, which would pin this
  // component in memory forever.
  const touchKey = useWorkletCallback(handleTouch)

  const makePlayerGesture = useCallback(
    (player: Player) =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(0)
        .hitSlop({})
        .enabled(enabled)
        .onStart((e) => {
          scheduleOnRN(callWorkletCallback, touchKey, player, e.absoluteX, e.absoluteY)
        })
        .onUpdate((e) => {
          scheduleOnRN(callWorkletCallback, touchKey, player, e.absoluteX, e.absoluteY)
        }),
    [enabled, touchKey]
  )

  const soloGesture = useMemo(() => (solo ? makePlayerGesture(humanPlayers[0]) : null), [solo, humanPlayers, makePlayerGesture])
  // zoneA is always player 1's zone, zoneB always player 2's - see the file-level comment above for
  // why the physical half each one occupies (not the assignment itself) is what varies with rotation.
  const zoneAGesture = useMemo(() => (solo ? null : makePlayerGesture(1)), [solo, makePlayerGesture])
  const zoneBGesture = useMemo(() => (solo ? null : makePlayerGesture(2)), [solo, makePlayerGesture])

  if (solo) {
    return (
      <GestureDetector gesture={soloGesture!}>
        {/* collapsable={false}: without a prop that makes it stand out, RN's view-flattening
            optimization merges this plain View into its parent, and GestureDetector's ref then
            attaches to nothing - the gesture silently never receives a single touch. */}
        <View collapsable={false} style={styles.zoneFull} />
      </GestureDetector>
    )
  }

  const zoneAStyle = rotation === 0 ? styles.zoneLeft : rotation === 90 ? styles.zoneTop : styles.zoneBottom
  const zoneBStyle = rotation === 0 ? styles.zoneRight : rotation === 90 ? styles.zoneBottom : styles.zoneTop

  return (
    <View style={styles.container} pointerEvents='box-none'>
      <GestureDetector gesture={zoneAGesture!}>
        <View collapsable={false} style={[styles.zone, zoneAStyle]} />
      </GestureDetector>
      <GestureDetector gesture={zoneBGesture!}>
        <View collapsable={false} style={[styles.zone, zoneBStyle]} />
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  zone: { position: 'absolute' },
  zoneBottom: { bottom: 0, height: '50%', left: 0, right: 0 },
  zoneFull: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  zoneLeft: { bottom: 0, left: 0, top: 0, width: '50%' },
  zoneRight: { bottom: 0, right: 0, top: 0, width: '50%' },
  zoneTop: { height: '50%', left: 0, right: 0, top: 0 }
})
