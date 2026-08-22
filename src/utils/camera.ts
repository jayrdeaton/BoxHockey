// Pure/worklet math for the board's pan/zoom camera. Keeping this separate from the gesture
// wiring (see useBoardCamera.ts) makes the actual transform math unit-testable without touching
// reanimated or react-native-gesture-handler.
//
// Convention: a camera is `{ scale, translateX, translateY }` mapping a board-space point (the
// same coordinate frame every game-logic value already lives in — BoardLayout, PuckState, aim)
// onto a screen-space point (the raw touch/render coordinate frame of the board's outer,
// untransformed container) via `screen = translate + board * scale`. Board.tsx and all of
// useGameState/physics stay entirely in board space — the camera only ever affects how that
// space is drawn (see the `transformOrigin: 'left top'` wrapper in game.tsx, which makes the
// board's rendered `transform: [{translateX},{translateY},{scale}]` match this exact formula)
// and how a raw touch maps back onto it.

export interface CameraState {
  scale: number
  translateX: number
  translateY: number
}

export function clampScale(scale: number, min: number, max: number): number {
  'worklet'
  return Math.min(Math.max(scale, min), max)
}

// Clamps pan to whichever behavior makes sense for the current scale:
//  - scale >= 1 (zoomed in): the scaled content is at least as big as the viewport, so it must
//    always fully COVER it — no empty margin can open up on any edge.
//  - scale < 1 (zoomed OUT): the scaled content is now smaller than the viewport by design — the
//    whole point is to open up empty margin around it (e.g. so a puck jammed against a wall has
//    physical screen space to drag into, see useGameState/game.tsx's aim gesture) — so instead
//    it's free to be positioned anywhere fully CONTAINED within the viewport, edge to edge.
// `boardEdge` is 0 at scale 1 either way (the board exactly fills the viewport, nothing to clamp);
// away from 1 it's negative for zoom-in (a "how far can content slide before revealing a gap"
// bound) and positive for zoom-out (a "how far can the smaller board slide before its far edge
// passes the viewport's" bound) — taking min/max of it against 0 covers both directions at once.
export function clampTranslate(translateX: number, translateY: number, scale: number, viewportWidth: number, viewportHeight: number): { x: number; y: number } {
  'worklet'
  const boardEdgeX = viewportWidth * (1 - scale)
  const boardEdgeY = viewportHeight * (1 - scale)
  const minX = Math.min(0, boardEdgeX)
  const maxX = Math.max(0, boardEdgeX)
  const minY = Math.min(0, boardEdgeY)
  const maxY = Math.max(0, boardEdgeY)
  return {
    x: Math.min(Math.max(translateX, minX), maxX),
    y: Math.min(Math.max(translateY, minY), maxY)
  }
}

// Converts a touch point from the board's outer (untransformed) container space into board
// space — i.e. undoes the camera. Used so aiming/hit-testing stays accurate at any zoom level.
export function screenToBoard(screenX: number, screenY: number, camera: CameraState): { x: number; y: number } {
  'worklet'
  return {
    x: (screenX - camera.translateX) / camera.scale,
    y: (screenY - camera.translateY) / camera.scale
  }
}

// Converts a screen-space delta (e.g. a drag's translationX/Y) into board space — only scale
// matters for a delta, translate cancels out.
export function screenDeltaToBoard(dx: number, dy: number, scale: number): { x: number; y: number } {
  'worklet'
  return { x: dx / scale, y: dy / scale }
}

// A pinch's focal point names a fixed board-space coordinate (captured once at gesture start,
// see useBoardCamera's onStart) that must stay under the fingers as they move — this recomputes
// the camera each frame so that point tracks the live focal. Two fingers moving together with no
// spread (scale staying ~1) still moves the focal, so this is also how two-finger panning works —
// there's no separate pan gesture.
export function pinchToCamera(focalX: number, focalY: number, focalBoardX: number, focalBoardY: number, nextScale: number, viewportWidth: number, viewportHeight: number): CameraState {
  'worklet'
  const rawX = focalX - focalBoardX * nextScale
  const rawY = focalY - focalBoardY * nextScale
  const clamped = clampTranslate(rawX, rawY, nextScale, viewportWidth, viewportHeight)
  return { scale: nextScale, translateX: clamped.x, translateY: clamped.y }
}

// A wheel event's multiplicative zoom step, clamped so a single large wheel notch (a mouse) or a
// fast trackpad pinch can't produce a jarring jump. deltaY follows the browser convention:
// negative = zoom in (scroll/pinch "up"), positive = zoom out.
export function wheelZoomFactor(deltaY: number, sensitivity: number): number {
  'worklet'
  const raw = Math.exp(-deltaY * sensitivity)
  return Math.min(Math.max(raw, 0.85), 1.18)
}
