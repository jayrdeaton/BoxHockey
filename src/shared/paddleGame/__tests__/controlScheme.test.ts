import { assignSeatScheme } from '@tastic/input'

import { resolveControlSchemeDirection } from '@/shared/controlScheme'
import { DEFAULT_SETTINGS } from '@/shared/paddleGame/settings'
import type { ControlScheme } from '@/shared/paddleGame/types'

describe('resolveControlSchemeDirection', () => {
  it('returns null for the mouse scheme regardless of key', () => {
    expect(resolveControlSchemeDirection({ key: 'w', code: 'KeyW' }, 'mouse')).toBeNull()
    expect(resolveControlSchemeDirection({ key: 'ArrowUp', code: 'ArrowUp' }, 'mouse')).toBeNull()
  })

  it('resolves wasd by key', () => {
    expect(resolveControlSchemeDirection({ key: 'w', code: 'KeyW' }, 'wasd')).toBe('up')
    expect(resolveControlSchemeDirection({ key: 's', code: 'KeyS' }, 'wasd')).toBe('down')
  })

  it('resolves arrows by key', () => {
    expect(resolveControlSchemeDirection({ key: 'ArrowUp', code: 'ArrowUp' }, 'arrows')).toBe('up')
    expect(resolveControlSchemeDirection({ key: 'ArrowDown', code: 'ArrowDown' }, 'arrows')).toBe('down')
  })

  it('resolves ijkl by key', () => {
    expect(resolveControlSchemeDirection({ key: 'i', code: 'KeyI' }, 'ijkl')).toBe('up')
    expect(resolveControlSchemeDirection({ key: 'k', code: 'KeyK' }, 'ijkl')).toBe('down')
  })

  it('resolves numpad by code, independent of NumLock (.key may read as a digit or an arrow name)', () => {
    expect(resolveControlSchemeDirection({ key: '8', code: 'Numpad8' }, 'numpad')).toBe('up')
    expect(resolveControlSchemeDirection({ key: 'ArrowDown', code: 'Numpad2' }, 'numpad')).toBe('down')
  })

  it('returns null for a key not in the given scheme', () => {
    expect(resolveControlSchemeDirection({ key: 'q', code: 'KeyQ' }, 'wasd')).toBeNull()
  })
})

// The loadout's two pickers write through assignSeatScheme (see loadout.tsx).
describe('loadout control scheme picks', () => {
  const ALL_SCHEMES: ControlScheme[] = ['mouse', 'wasd', 'arrows', 'ijkl', 'numpad']

  // Regression: a 1 Player pick of seat 2's scheme left both seats on it, and KeyboardInputLayer
  // then sent every one of those keys to seat 1 in a later 2 Player game.
  it("hands seat 2 seat 1's old scheme when seat 1 picks seat 2's", () => {
    expect(assignSeatScheme(DEFAULT_SETTINGS.controlScheme, 1, 'wasd')).toEqual({ 1: 'wasd', 2: 'mouse' })
  })

  it('never leaves both seats on one scheme, from any setup a pick can reach', () => {
    const setups = ALL_SCHEMES.flatMap((p1) => ALL_SCHEMES.filter((p2) => p2 !== p1).map((p2) => ({ 1: p1, 2: p2 })))
    for (const current of setups) {
      for (const seat of [1, 2] as const) {
        for (const scheme of ALL_SCHEMES) {
          const next = assignSeatScheme(current, seat, scheme)
          expect(next[seat]).toBe(scheme)
          expect(next[1]).not.toBe(next[2])
        }
      }
    }
  })
})
