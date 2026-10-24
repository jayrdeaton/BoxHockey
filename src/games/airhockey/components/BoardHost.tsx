// Native draws the board directly: Skia's native bindings are ready before any JS runs. The web
// version (BoardHost.web.tsx) waits for CanvasKit first.
export { default } from './Board'
