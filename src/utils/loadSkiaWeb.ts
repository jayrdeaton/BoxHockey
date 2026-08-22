// Native counterpart to loadSkiaWeb.web.ts — Skia on native (via JSI, no WASM) is ready as soon as
// the app's native module is linked, so there's nothing to actually wait on here. Kept as a same-
// shaped async no-op so BoardHost can call this unconditionally without a Platform check of its own.
export function loadSkiaWeb(): Promise<void> {
  return Promise.resolve()
}
