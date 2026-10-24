// Skia's native module can't initialize under Jest, and its own jestSetup needs CanvasKit's wasm in
// a custom test environment. Nothing in this app's suites draws a board: they only load the modules
// a board lives in (the pack's game registry imports every game's play screen). So every export is
// an inert stand-in: any property, call or `new` gives back another stand-in.
type Inert = ((...args: unknown[]) => Inert) & Record<string | symbol, unknown>

const inert: Inert = new Proxy(function () {} as unknown as Inert, {
  get: (_target, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => 0 : inert),
  apply: () => inert,
  construct: () => inert
})

module.exports = new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
  get: (target, prop) => (prop in target ? target[prop] : inert)
})
