import { Direction, KeyScheme, resolveSchemeDirection } from '@tastic/input'

// Which physical input drives a seat's paddle or mallet on desktop web: the mouse (dragging, through
// the game's TouchInputLayer) or one of @tastic/input's key clusters (through its
// KeyboardInputLayer). Air Hockey and Paddles/Breaker share it.
export type ControlScheme = KeyScheme | 'mouse'

// The one entry point a KeyboardInputLayer routes every keydown/keyup through. 'mouse' (the scheme
// with no keys of its own) always resolves to null; every other scheme is a KeyScheme, resolved by
// @tastic/input's own resolveSchemeDirection (which already knows numpad's NumLock-independent
// .code quirk - see that package's own doc).
export function resolveControlSchemeDirection(event: Pick<KeyboardEvent, 'key' | 'code'>, scheme: ControlScheme): Direction | null {
  if (scheme === 'mouse') return null
  return resolveSchemeDirection(event, scheme)
}
