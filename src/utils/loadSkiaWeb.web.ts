import { LoadSkiaWeb } from '@shopify/react-native-skia/src/web'

// Skia's web target renders through CanvasKit, a WASM build of Skia fetched at runtime — nothing
// using @shopify/react-native-skia's React components can draw a single frame until this resolves.
// A thin wrapper (rather than importing LoadSkiaWeb directly at the call site) purely so this file's
// `.ts` counterpart, loadSkiaWeb.ts, gives native an identically-shaped async no-op — Metro's own
// platform-extension resolution then picks whichever one actually matches, with zero runtime
// branching and no risk of canvaskit-wasm's own web-only code ending up in the native bundle at all.
export function loadSkiaWeb(): Promise<void> {
  return LoadSkiaWeb()
}
