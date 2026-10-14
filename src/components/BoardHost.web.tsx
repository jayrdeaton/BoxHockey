import { loadSkiaWeb } from '@tastic/hud'
import { lazy, Suspense } from 'react'

import { BoardProps } from './Board'

// Skia's web target renders through CanvasKit, a WASM build of Skia - and Board.tsx's own `Skia`
// import binds to `global.CanvasKit` once, synchronously, at MODULE-EVALUATION time (see
// @shopify/react-native-skia's Skia.web.ts: `export const Skia = JsiSkApi(global.CanvasKit)`) - not
// lazily, and not reactively. A plain `import Board from './Board'` here would already have
// evaluated that binding (against a not-yet-loaded, undefined CanvasKit) before ANY component in the
// app renders at all, since Metro evaluates the whole static import graph up front. A dynamic import
// is the one thing that actually defers module evaluation to runtime, so this only imports Board.tsx
// (and therefore @shopify/react-native-skia) AFTER loadSkiaWeb() has resolved and set
// global.CanvasKit for real.
const LazyBoard = lazy(() => loadSkiaWeb().then(() => import('./Board')))

export default function BoardHost(props: BoardProps) {
  return (
    <Suspense fallback={null}>
      <LazyBoard {...props} />
    </Suspense>
  )
}
