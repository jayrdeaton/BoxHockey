/* global jest */
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Jest's manual __mocks__ auto-pickup doesn't reliably apply to a deep subpath import like this
// one — the adjacent src/__mocks__/@expo/vector-icons/createIconSet.ts needs an explicit
// registration to actually be used. See Hangman's jest.setup.cjs / Jest-Config's CLAUDE.md.
jest.mock('@expo/vector-icons/createIconSet')

// useGameSound.ts and Feedback.tsx both import this exact subpath directly
// (`@rific/feedback-press/audio`) — no bare `@rific/feedback-press` mock covers a deep subpath
// import (see the comment block above / Hangman's jest.setup.cjs), so it would load for real,
// completely unmocked, the moment any test reached one of these two files. Confirmed dormant, not
// live: a fleet-wide audit's console.warn probe planted in the real, resolved
// `@rific/feedback-press/audio` file never fired during this app's existing suite — neither
// useGameSound nor Feedback is currently reached by any test — so this registers the same
// already-proven-safe stub used identically in Snake/Swirlio/Hangman/Pong for this package,
// purely to close the gap before a future test exercises that path.
jest.mock('@rific/feedback-press/audio', () => ({
  __esModule: true,
  useAudioPool: () => () => {}
}))

// loadSkiaWeb.web.ts imports LoadSkiaWeb directly from this subpath to fetch CanvasKit's WASM
// build at runtime — real, unmocked, it would reach the network the moment any test exercised
// the web loading path. Confirmed dormant, not live: the same audit's console.warn probe never
// fired for this file during this app's existing suite. LoadSkiaWeb is an async function
// resolving to void (see node_modules/@shopify/react-native-skia/src/web/LoadSkiaWeb.tsx), so the
// stub mirrors that exact shape as a no-op.
jest.mock('@shopify/react-native-skia/src/web', () => ({
  __esModule: true,
  LoadSkiaWeb: () => Promise.resolve()
}))

const handleUnhandledRejection = (reason) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection in tests:', reason)
}

const handleUncaughtException = (err) => {
  // eslint-disable-next-line no-console
  console.error('UncaughtException in tests:', err)
}

if (typeof process !== 'undefined' && process && process.on) {
  process.on('unhandledRejection', handleUnhandledRejection)
  process.on('uncaughtException', handleUncaughtException)
}

try {
  jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper')
} catch {
  // ignore if the path isn't present in this environment
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
}
