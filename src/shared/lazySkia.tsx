import { loadSkiaWeb } from '@tastic/hud/skia'
import { type ComponentType, lazy, Suspense } from 'react'

// A Skia board for the web (every game's BoardHost.web.tsx). Skia's web target renders through
// CanvasKit, a WASM build of Skia, and a board's own `Skia` import binds to `global.CanvasKit` once,
// synchronously, at module-evaluation time (see @shopify/react-native-skia's Skia.web.ts: `export
// const Skia = JsiSkApi(global.CanvasKit)`) - not lazily, and not reactively. A plain import of the
// board would evaluate that binding against a not-yet-loaded, undefined CanvasKit before anything
// renders, since Metro evaluates the whole static import graph up front. A dynamic import is the one
// thing that defers module evaluation to runtime, so the board module (and Skia with it) is only
// imported once loadSkiaWeb() has resolved and set global.CanvasKit for real. On native there's
// nothing to defer (JSI is ready before any JS runs), so each game's BoardHost.tsx just re-exports
// its board.
export function lazySkia<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  const LazyBoard = lazy(() => loadSkiaWeb().then(load))
  return function SkiaHost(props: P) {
    return (
      <Suspense fallback={null}>
        <LazyBoard {...props} />
      </Suspense>
    )
  }
}
