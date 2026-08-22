import { clampScale, clampTranslate, pinchToCamera, screenDeltaToBoard, screenToBoard, wheelZoomFactor } from '@/utils/camera'

describe('clampScale', () => {
  it('passes values inside the range through unchanged', () => {
    expect(clampScale(2, 1, 3)).toBe(2)
  })

  it('clamps below the minimum', () => {
    expect(clampScale(0.4, 1, 3)).toBe(1)
  })

  it('clamps above the maximum', () => {
    expect(clampScale(5, 1, 3)).toBe(3)
  })
})

describe('clampTranslate', () => {
  it('forces translate to (0,0) at scale 1 — nowhere to pan to', () => {
    expect(clampTranslate(50, -50, 1, 400, 800)).toEqual({ x: 0, y: 0 })
  })

  it('keeps the scaled content covering the viewport at scale > 1', () => {
    // viewport 400x800, scale 2 -> scaled content is 800x1600, so translate must stay within
    // [-400, 0] x [-800, 0] for the viewport to never see empty margin.
    expect(clampTranslate(0, 0, 2, 400, 800)).toEqual({ x: 0, y: 0 })
    expect(clampTranslate(-1000, -2000, 2, 400, 800)).toEqual({ x: -400, y: -800 })
    expect(clampTranslate(1000, 2000, 2, 400, 800)).toEqual({ x: 0, y: 0 })
  })

  it('passes an in-range translate through unchanged', () => {
    expect(clampTranslate(-100, -200, 2, 400, 800)).toEqual({ x: -100, y: -200 })
  })

  it('lets a zoomed-out board be freely positioned within the viewport, not forced to (0,0)', () => {
    // viewport 400x800, scale 0.5 -> scaled content is 200x400, so it can slide anywhere from
    // top-left-aligned (0,0) to bottom-right-aligned (200,400) without leaving the viewport.
    expect(clampTranslate(0, 0, 0.5, 400, 800)).toEqual({ x: 0, y: 0 })
    expect(clampTranslate(200, 400, 0.5, 400, 800)).toEqual({ x: 200, y: 400 })
    expect(clampTranslate(80, 150, 0.5, 400, 800)).toEqual({ x: 80, y: 150 })
  })

  it('still keeps a zoomed-out board from being dragged off the viewport entirely', () => {
    expect(clampTranslate(-500, -500, 0.5, 400, 800)).toEqual({ x: 0, y: 0 })
    expect(clampTranslate(5000, 5000, 0.5, 400, 800)).toEqual({ x: 200, y: 400 })
  })
})

describe('screenToBoard / screenDeltaToBoard', () => {
  it('is the identity at the default camera (scale 1, no pan)', () => {
    expect(screenToBoard(123, 456, { scale: 1, translateX: 0, translateY: 0 })).toEqual({ x: 123, y: 456 })
  })

  it('undoes a pan + zoom camera', () => {
    // screen = translate + board*scale  =>  board = (screen - translate) / scale
    const camera = { scale: 2, translateX: -50, translateY: -30 }
    expect(screenToBoard(150, 170, camera)).toEqual({ x: 100, y: 100 })
  })

  it('round-trips an arbitrary board point through the forward transform', () => {
    const camera = { scale: 1.75, translateX: 40, translateY: -12 }
    const boardPoint = { x: 88, y: 210 }
    const screenPoint = { x: camera.translateX + boardPoint.x * camera.scale, y: camera.translateY + boardPoint.y * camera.scale }
    expect(screenToBoard(screenPoint.x, screenPoint.y, camera)).toEqual(boardPoint)
  })

  it('scales a screen-space delta down to board space, ignoring translate', () => {
    expect(screenDeltaToBoard(40, -20, 2)).toEqual({ x: 20, y: -10 })
    expect(screenDeltaToBoard(40, -20, 1)).toEqual({ x: 40, y: -20 })
  })
})

describe('pinchToCamera', () => {
  it('keeps the board point that was under the focal fixed under the (possibly moved) focal', () => {
    // Anchor: board point (100, 200) was under the focal at gesture start (an identity camera,
    // where board and screen space coincide). The fingers then spread to 2x roughly in place —
    // focal stays at screen (100, 200) — and the resulting camera must still map (100,200) back
    // to board (100,200), i.e. that point stays visually pinned under the fingers.
    const focalBoardX = 100
    const focalBoardY = 200
    const camera = pinchToCamera(100, 200, focalBoardX, focalBoardY, 2, 400, 800)
    expect(camera.scale).toBe(2)
    expect(screenToBoard(100, 200, camera)).toEqual({ x: focalBoardX, y: focalBoardY })
  })

  it('clamps the resulting pan so the content still covers the viewport', () => {
    // Zooming from a focal near the top-left corner would otherwise want to pull translate far
    // positive (revealing empty space above/left of the board) — clamping must prevent that.
    const camera = pinchToCamera(5, 5, 5, 5, 3, 400, 800)
    expect(camera.translateX).toBeLessThanOrEqual(0)
    expect(camera.translateY).toBeLessThanOrEqual(0)
    expect(camera.translateX).toBeGreaterThanOrEqual(400 * (1 - 3))
    expect(camera.translateY).toBeGreaterThanOrEqual(800 * (1 - 3))
  })

  it('supports zooming OUT and panning the shrunk board toward the top wall — opening drag room below a puck stuck against it', () => {
    // A puck sitting flush against the board's top edge, in a viewport with no margin (see
    // BOARD_MARGIN), has nowhere to drag a pull-back into. Pinching to 0.5x with the focal near
    // the top of the viewport should pin the (now-smaller) board near its top-aligned position —
    // translateY near 0, its minimum at this scale — opening empty screen space below it, not get
    // forced back to exactly 0 just because it's < 1x (the old, broken behavior).
    const anchorBoardX = 100
    const anchorBoardY = 50 // near the board's own top edge
    const camera = pinchToCamera(150, 40, anchorBoardX, anchorBoardY, 0.5, 400, 800)
    expect(camera.scale).toBe(0.5)
    // valid range at this scale is [0 (top-aligned), 400 (bottom-aligned)] — anchoring near the
    // viewport's own top pins it near the top-aligned end.
    expect(camera.translateY).toBeGreaterThanOrEqual(0)
    expect(camera.translateY).toBeLessThan(800 * (1 - 0.5))
    // the anchored board point still tracks the focal exactly, same invariant as the zoom-in case
    expect(screenToBoard(150, 40, camera)).toEqual({ x: anchorBoardX, y: anchorBoardY })
  })
})

describe('wheelZoomFactor', () => {
  it('is 1 (no change) at deltaY 0', () => {
    expect(wheelZoomFactor(0, 0.01)).toBe(1)
  })

  it('is > 1 (zoom in) for negative deltaY — scroll/pinch "up"', () => {
    expect(wheelZoomFactor(-10, 0.01)).toBeGreaterThan(1)
  })

  it('is < 1 (zoom out) for positive deltaY — scroll/pinch "down"', () => {
    expect(wheelZoomFactor(10, 0.01)).toBeLessThan(1)
  })

  it('clamps an extreme single event to a bounded step', () => {
    expect(wheelZoomFactor(-10000, 0.01)).toBeLessThanOrEqual(1.18)
    expect(wheelZoomFactor(10000, 0.01)).toBeGreaterThanOrEqual(0.85)
  })
})
