import { bricksActiveFor, tiltControlActiveFor } from '@/shared/paddleGame/utils/gameMode'

describe('bricksActiveFor', () => {
  it('is unconditionally true for solo, whatever the game', () => {
    expect(bricksActiveFor('solo', false)).toBe(true)
    expect(bricksActiveFor('solo', true)).toBe(true)
  })

  it('follows the game for vsCpu and twoPlayer (Paddles none, Breaker always)', () => {
    expect(bricksActiveFor('vsCpu', false)).toBe(false)
    expect(bricksActiveFor('vsCpu', true)).toBe(true)
    expect(bricksActiveFor('twoPlayer', false)).toBe(false)
    expect(bricksActiveFor('twoPlayer', true)).toBe(true)
  })
})

describe('tiltControlActiveFor', () => {
  it('is unconditionally false for twoPlayer, regardless of the stored toggle', () => {
    expect(tiltControlActiveFor('twoPlayer', false)).toBe(false)
    expect(tiltControlActiveFor('twoPlayer', true)).toBe(false)
  })

  it('follows the toggle for vsCpu and solo', () => {
    expect(tiltControlActiveFor('vsCpu', false)).toBe(false)
    expect(tiltControlActiveFor('vsCpu', true)).toBe(true)
    expect(tiltControlActiveFor('solo', false)).toBe(false)
    expect(tiltControlActiveFor('solo', true)).toBe(true)
  })
})
