import { ComponentRef, useEffect, useMemo, useRef } from 'react'
import { Platform, View } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { BOARD_DEFAULT_ZOOM, BOARD_MAX_ZOOM, BOARD_MIN_ZOOM, WHEEL_ZOOM_SENSITIVITY } from '@/constants/game'
import { clampScale, clampTranslate, pinchToCamera, screenToBoard, wheelZoomFactor } from '@/utils/camera'

// Owns the board's pan/zoom camera. Two gestures compose simultaneously over the same two-finger
// touch: Gesture.Pinch() drives scale, and a separate Gesture.Pan() (locked to exactly 2 pointers,
// averaged across both) drives translate. They're kept strictly separate — each writes only its
// own shared value — rather than having Pinch also recompute translate to keep a focal point
// anchored under the fingers, which an earlier draft of this did: that anchoring needs Pinch to
// overwrite translateX/Y from scratch every update, which would silently fight a simultaneously-
// active Pan gesture doing its own independent writes to the exact same values. That approach was
// abandoned after confirming (on an iOS Simulator, via injected two-finger touch events) that a
// pure two-finger drag with ~no spread produced no visible pan at all — consistent with iOS's
// UIPinchGestureRecognizer never beginning recognition without a distance change, meaning Pinch's
// onUpdate, the only thing touching translateX/Y at the time, never fired. The trade-off with this
// split design: a pinch with no accompanying drag now zooms anchored at the board's top-left
// corner (this wrapper's transformOrigin, see the animatedStyle comment below) rather than under
// the fingers — acceptable since panning to reposition afterward still works.
//
// The dedicated Pan gesture's own touch handling could not be re-verified in the simulator: its
// synthetic two-finger drag reliably drives Pinch (confirmed repeatedly) but never triggered this
// Pan's onUpdate in any tested configuration (with/without pointer limits, with/without
// averageTouches, fully isolated from Pinch and from the rest of the gesture tree) — most likely a
// gap in the simulator's multi-touch injection for Pan specifically, not a flaw in this code, but
// unconfirmed on a real device. If two-finger panning still doesn't respond on an actual phone,
// re-open this — the untested part is here, not the zoom half.
//
// Game logic never sees this: puck position, hit-testing, and physics all stay in board space
// (see camera.ts's header comment). This hook only exposes the live camera (scale/translateX/
// translateY, as SharedValues game.tsx reads inside its own aim-gesture worklets to convert
// touches back to board space) and the gesture + style needed to draw it.
//
// Extension point for the isometric view from PLAN.md: that's a distinct camera *mode* (an
// angled/extruded redraw of the board), deliberately not built here. But scale/translateX/
// translateY already fully describe the current 2D camera, so a future mode can sit alongside
// them without disturbing this — e.g. branching the two-finger pan below on whether the touches
// are dragging vertically to distinguish a tilt gesture (not yet built) from a plain pan.
export function useBoardCamera(viewportWidth: number, viewportHeight: number) {
  const scale = useSharedValue(BOARD_DEFAULT_ZOOM)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)

  const savedScale = useSharedValue(BOARD_DEFAULT_ZOOM)
  const savedTranslateX = useSharedValue(0)
  const savedTranslateY = useSharedValue(0)

  // Kept as SharedValues (synced from props via effect, not read directly) so the gesture worklet
  // below — created once via useMemo — always reads the current viewport size instead of a stale
  // value closed over at mount.
  const viewportWidthSV = useSharedValue(viewportWidth)
  const viewportHeightSV = useSharedValue(viewportHeight)
  useEffect(() => {
    viewportWidthSV.value = viewportWidth
    viewportHeightSV.value = viewportHeight
  }, [viewportWidth, viewportHeight, viewportWidthSV, viewportHeightSV])

  // Web only: a trackpad pinch (and Ctrl/Cmd+scroll on a mouse, the desktop equivalent) never
  // reaches react-native-gesture-handler's Pinch gesture below — browsers report both as `wheel`
  // events with ctrlKey true, not as the real multi-touch pointer contacts Pinch needs. Attached
  // as a native (non-passive) listener rather than React's onWheel prop, since React's synthetic
  // wheel handler is passive by default and silently ignores preventDefault — without that, the
  // browser's own page zoom would fire alongside this. react-native-web forwards a View's ref to
  // its underlying DOM node, which is all this needs; native ignores it (the ref never resolves to
  // a DOM element there, and the effect below no-ops off Platform.OS).
  const boardAreaRef = useRef<ComponentRef<typeof View>>(null)

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const node = boardAreaRef.current as unknown as HTMLElement | null
    if (!node) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = node.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top

      if (e.ctrlKey || e.metaKey) {
        const factor = wheelZoomFactor(e.deltaY, WHEEL_ZOOM_SENSITIVITY)
        const nextScale = clampScale(scale.value * factor, BOARD_MIN_ZOOM, BOARD_MAX_ZOOM)
        const anchor = screenToBoard(cursorX, cursorY, { scale: scale.value, translateX: translateX.value, translateY: translateY.value })
        const next = pinchToCamera(cursorX, cursorY, anchor.x, anchor.y, nextScale, viewportWidthSV.value, viewportHeightSV.value)
        scale.value = next.scale
        translateX.value = next.translateX
        translateY.value = next.translateY
      } else {
        const panned = clampTranslate(translateX.value - e.deltaX, translateY.value - e.deltaY, scale.value, viewportWidthSV.value, viewportHeightSV.value)
        translateX.value = panned.x
        translateY.value = panned.y
      }
    }

    node.addEventListener('wheel', handleWheel, { passive: false })
    return () => node.removeEventListener('wheel', handleWheel)
    // All of scale/translateX/translateY/viewportWidthSV/viewportHeightSV are stable SharedValue
    // references (same identity every render, like the pinchGesture memo above) — safe to omit;
    // this attaches the native listener once and it always reads/writes their live `.value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cameraGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart(() => {
        savedScale.value = scale.value
      })
      .onUpdate((e) => {
        scale.value = clampScale(savedScale.value * e.scale, BOARD_MIN_ZOOM, BOARD_MAX_ZOOM)
      })

    // Locked to exactly 2 pointers so this never fights the single-finger aim gesture in game.tsx
    // (raced separately there); averageTouches makes a 2-finger drag report the touches' shared
    // midpoint moving, which is what makes this feel like "drag the board" rather than "drag
    // whichever finger happened to land first" — RNGH's default for this already matches on iOS,
    // but Android defaults to tracking the leading pointer, so this has to be set explicitly.
    const pan = Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .averageTouches(true)
      .onStart(() => {
        savedTranslateX.value = translateX.value
        savedTranslateY.value = translateY.value
      })
      .onUpdate((e) => {
        const next = clampTranslate(savedTranslateX.value + e.translationX, savedTranslateY.value + e.translationY, scale.value, viewportWidthSV.value, viewportHeightSV.value)
        translateX.value = next.x
        translateY.value = next.y
      })

    return Gesture.Simultaneous(pinch, pan)
    // Shared values are stable references (same identity every render, like a ref) — safe to
    // omit from deps; the gesture is built once and always reads their live `.value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = () => {
    scale.value = withTiming(BOARD_DEFAULT_ZOOM)
    translateX.value = withTiming(0)
    translateY.value = withTiming(0)
  }

  // `transformOrigin: 'left top'` on the wrapper (set alongside this in game.tsx) pins the pivot
  // to (0,0), so this composes to exactly screen = translate + board*scale — the same convention
  // camera.ts's pure functions use — with no center-pivot compensation needed.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }]
  }))

  return { scale, translateX, translateY, cameraGesture, animatedStyle, reset, boardAreaRef }
}
