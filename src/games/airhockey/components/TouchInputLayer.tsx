import { callWorkletCallback, useWorkletCallback } from '@rific/core'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'

import { Player } from '@/games/airhockey/types'

export interface TouchInputLayerProps {
  // [1, 2] for two-player; [1] or [2] for vs-CPU, where the single human gets the whole board as
  // their own input area (see the solo branch below) rather than a half of it.
  humanPlayers: Player[]
  enabled: boolean
  // Local-space container size (see GoalSide's own doc comment in types/index.ts) - the SAME
  // full-screen local viewport BoardHost renders into, sized via computeLocalContainerSize in utils/board.ts.
  localWidth: number
  localHeight: number
  // The local container's own screen-space center (game.tsx's outer viewport is centered around
  // this same point, since the container is flex-centered within it) and the rotation game.tsx
  // applies to it (0 for face-to-face, ±90 for side-by-side - see game.tsx's own rotation
  // direction comment). Needed to convert a touch's e.absoluteX/absoluteY (real screen position)
  // back into local board coordinates by hand - see screenToLocal below for why this can't just
  // use a zone's own e.x/e.y.
  screenCenterX: number
  screenCenterY: number
  rotationDeg: 0 | 90 | -90
  // Called with LOCAL (board-space) coordinates.
  onPaddleTarget: (player: Player, x: number, y: number) => void
}

// Converts a real screen-space touch position back into local board coordinates by hand, using
// the exact inverse of the CSS rotation game.tsx applies to the local container for rendering.
// This turned out to be necessary (not just defensive) - verified directly in the browser
// preview: react-native-gesture-handler's web implementation reports a zone's own e.x/e.y as if
// no rotation had been applied to any ancestor at all (a dragging test at a fixed screen-Y moved
// the local coordinate along local-X, not local-Y, exactly the identity/no-rotation behavior),
// rather than correctly inverting it the way native touch delivery (or a browser's own DOM
// offsetX/Y) normally would for a transformed element. Working from e.absoluteX/absoluteY (real,
// unambiguous screen position, independent of which transformed view the gesture is attached to)
// and inverting the KNOWN rotation explicitly sidesteps that platform inconsistency entirely,
// rather than depending on it.
function screenToLocal(absX: number, absY: number, screenCenterX: number, screenCenterY: number, rotationDeg: 0 | 90 | -90, localWidth: number, localHeight: number): { x: number; y: number } {
  'worklet'
  const dx = absX - screenCenterX
  const dy = absY - screenCenterY
  let lx: number
  let ly: number
  if (rotationDeg === 90) {
    lx = dy
    ly = -dx
  } else if (rotationDeg === -90) {
    lx = -dy
    ly = dx
  } else {
    lx = dx
    ly = dy
  }
  return { x: localWidth / 2 + lx, y: localHeight / 2 + ly }
}

// Two independent single-finger Pan gestures, each on its OWN View (top half = player 2, bottom
// half = player 1 - always, regardless of GoalAxis: game.tsx rotates the whole local container
// ±90° for side-by-side landscape, so this same top/bottom split always ends up on the correct
// physical screen sides without this component ever branching on orientation itself for HIT-
// TESTING - DOM/native hit-testing already respects the rotation transform when deciding which
// zone a touch lands on, it's only the touch's own COORDINATE VALUE that needs the manual
// correction above) - modeled directly on LightCycles' TouchInputLayer, which deliberately does
// NOT use one shared view split via `hitSlop`: two fingers landing in the same native touch batch
// (a genuine simultaneous two-player touch, not two touches a few frames apart) raced on which
// recognizer claimed which pointer on a single shared view, and lost one or both. Two separate
// native views/recognizers have nothing left to race - each only ever sees the pointer that
// landed on it.
export default function TouchInputLayer({ humanPlayers, enabled, localWidth, localHeight, screenCenterX, screenCenterY, rotationDeg, onPaddleTarget }: TouchInputLayerProps) {
  const solo = humanPlayers.length === 1

  // Everything the gesture callbacks need, kept in a ref rather than closed over directly, so the
  // callbacks - and therefore the Gesture objects built from them below - stay referentially
  // stable across renders. See LightCycles' own TouchInputLayer for the original repro of what
  // goes wrong (dropped touches) when a Gesture object is rebuilt on every layout/state tick.
  const latestRef = useRef({ onPaddleTarget, localWidth, localHeight, screenCenterX, screenCenterY, rotationDeg })
  useEffect(() => {
    latestRef.current = { onPaddleTarget, localWidth, localHeight, screenCenterX, screenCenterY, rotationDeg }
  })

  const handleTouch = useCallback((player: Player, absX: number, absY: number) => {
    const { onPaddleTarget, localWidth, localHeight, screenCenterX, screenCenterY, rotationDeg } = latestRef.current
    const local = screenToLocal(absX, absY, screenCenterX, screenCenterY, rotationDeg, localWidth, localHeight)
    onPaddleTarget(player, local.x, local.y)
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
  const p1Gesture = useMemo(() => (solo ? null : makePlayerGesture(1)), [solo, makePlayerGesture])
  const p2Gesture = useMemo(() => (solo ? null : makePlayerGesture(2)), [solo, makePlayerGesture])

  if (solo) {
    return (
      <GestureDetector gesture={soloGesture!}>
        {/* collapsable={false}: without a prop that makes it stand out, RN's view-flattening
            optimization merges this plain View into its parent, and GestureDetector's ref then
            attaches to nothing - the gesture silently never receives a single touch. */}
        <View collapsable={false} style={[styles.zone, { width: localWidth, height: localHeight }]} />
      </GestureDetector>
    )
  }

  return (
    <View style={[styles.container, { width: localWidth, height: localHeight }]}>
      <GestureDetector gesture={p1Gesture!}>
        <View collapsable={false} style={[styles.zone, styles.zoneBottom]} />
      </GestureDetector>
      <GestureDetector gesture={p2Gesture!}>
        <View collapsable={false} style={[styles.zone, styles.zoneTop]} />
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { position: 'absolute' },
  zone: { position: 'absolute' },
  zoneBottom: { bottom: 0, left: 0, right: 0, top: '50%' },
  zoneTop: { bottom: '50%', left: 0, right: 0, top: 0 }
})
