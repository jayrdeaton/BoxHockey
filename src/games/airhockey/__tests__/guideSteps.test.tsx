import { DirectionKeysHint, type SeatDevice, SeatDevicesHint, SwipeHint } from '@tastic/hud/guide'

import { GuideScoreArcs } from '@/games/airhockey/components/GuideArt'
import { getGuideSteps } from '@/games/airhockey/constants/guideSteps'
import { DEFAULT_SETTINGS } from '@/games/airhockey/redux/settingsSlice'
import type { ControlScheme, Player } from '@/games/airhockey/types'

const DEFAULT_SCHEMES = DEFAULT_SETTINGS.controlScheme
const ALL_SCHEMES: ControlScheme[] = ['mouse', 'wasd', 'arrows', 'ijkl', 'numpad']
const SCORE_OPTIONS = [3, 5, 7, 10]
// The expected prose for each scheme, written out here rather than imported so a changed phrase
// shows up as a failing test. Keeps this game's own "the numpad", and the mouse is "the mouse".
const PHRASE: Record<ControlScheme, string> = { mouse: 'the mouse', wasd: 'WASD', arrows: 'the arrow keys', ijkl: 'IJKL', numpad: 'the numpad' }
const DEVICE: Record<ControlScheme, SeatDevice> = { mouse: 'mouse', wasd: 'keyboard', arrows: 'keyboard', ijkl: 'keyboard', numpad: 'keyboard' }

function steps(touch: boolean, controlScheme: Record<Player, ControlScheme> = DEFAULT_SCHEMES, scoreToWin = DEFAULT_SETTINGS.scoreToWin) {
  return getGuideSteps({ touch, controlScheme, scoreToWin })
}

function textOf(touch: boolean, controlScheme?: Record<Player, ControlScheme>) {
  return steps(touch, controlScheme)
    .map((step) => `${step.title} ${step.body}`)
    .join(' ')
}

describe('getGuideSteps', () => {
  it.each([
    ['touch', true],
    ['desktop', false]
  ])('gives the %s guide three complete, illustrated cards for every seat scheme and score setting', (_name, touch) => {
    for (const p1 of ALL_SCHEMES) {
      for (const p2 of ALL_SCHEMES) {
        for (const scoreToWin of SCORE_OPTIONS) {
          const cards = steps(touch, { 1: p1, 2: p2 }, scoreToWin)

          expect(cards).toHaveLength(3)
          for (const step of cards) {
            expect(step.title.trim().length).toBeGreaterThan(0)
            // A card a casual player reads in a glance, not a wall of text.
            expect(step.body.length).toBeLessThanOrEqual(90)
            // The pager sizes every page to the tallest, so a card without art leaves a visible gap.
            expect(step.art).toBeDefined()
            expect(step.body).not.toMatch(/\u2014/)
          }
        }
      }
    }
  })

  it('headlines the live win condition and explains the score arcs, the scoreboard the game never prints as a number', () => {
    for (const touch of [true, false]) {
      for (const scoreToWin of SCORE_OPTIONS) {
        const [, rules] = steps(touch, DEFAULT_SCHEMES, scoreToWin)
        // BoxHockey's headline: both hockey games score goals, not points.
        expect(rules.title).toBe(`First to ${scoreToWin} Goals Wins`)
        // Board.tsx lights the scorer's arc in their OWN crease (scores[0] at player 1's bottom goal).
        expect(rules.body).toBe('Each goal you score lights up one arc at your end.')
        // One arc per goal needed, exactly like Board.tsx's ScoreWedges.
        expect(rules.art).toMatchObject({ type: GuideScoreArcs, props: { count: scoreToWin } })
      }
    }
  })

  it('teaches finger control on touch, and only says "your own half" on the two-player card (solo touches the whole table)', () => {
    const [controls, , twoPlayer] = steps(true)

    expect(controls.body).toMatch(/finger/i)
    expect(controls.body).not.toMatch(/half/i)
    expect(twoPlayer.title).toBe('Two Players, One Phone')
    expect(twoPlayer.body).toMatch(/your own half/i)
    expect(textOf(true)).not.toMatch(/click|press|key|mouse|pointer|WASD/i)
  })

  it('never tells a desktop player to swipe, and describes the live scheme of player 1 on the controls card', () => {
    expect(textOf(false)).not.toMatch(/swipe|finger|phone/i)

    const [mouseControls] = steps(false, { 1: 'mouse', 2: 'wasd' })
    expect(mouseControls.body).toMatch(/^Click and drag/)
    // hud's shared mouse-drag picture, not a local copy.
    expect(mouseControls.art).toMatchObject({ type: SwipeHint, props: { pointer: 'mouse', direction: 'up' } })
    expect(steps(false, { 1: 'wasd', 2: 'mouse' })[0].art).toMatchObject({ type: DirectionKeysHint, props: { labels: { up: 'W', left: 'A', down: 'S', right: 'D' } } })
    expect(steps(false, { 1: 'wasd', 2: 'mouse' })[0].body).toMatch(/^Player 1 moves with WASD\./)
    expect(steps(false, { 1: 'arrows', 2: 'mouse' })[0].body).toMatch(/^Player 1 moves with the arrow keys\./)
    expect(steps(false, { 1: 'numpad', 2: 'mouse' })[0].body).toMatch(/^Player 1 moves with the numpad\./)
  })

  it("names player 1 on a key-scheme controls card, since player 2 reads it too and never shares player 1's keys", () => {
    for (const p1 of ALL_SCHEMES.filter((scheme) => scheme !== 'mouse')) {
      for (const p2 of ALL_SCHEMES.filter((scheme) => scheme !== p1)) {
        const [controls] = steps(false, { 1: p1, 2: p2 })
        expect(controls.body).toMatch(/^Player 1 /)
        expect(controls.body).not.toMatch(/\byour\b/i)
      }
    }
    expect(steps(false, { 1: 'ijkl', 2: 'wasd' })[0].body).toMatch(/^Player 1 moves with IJKL\./)
  })

  it('names what each seat actually plays with on desktop, in the fleet wording, and only says "One Keyboard" when nobody is on the mouse', () => {
    const [, , defaults] = steps(false)
    expect(defaults.title).toBe('Two Players, One Computer')
    expect(defaults.body).toBe('Player 1 uses the mouse, player 2 uses WASD. Drag in your own half.')

    const [, , keysOnly] = steps(false, { 1: 'ijkl', 2: 'arrows' })
    expect(keysOnly.title).toBe('Two Players, One Keyboard')
    expect(keysOnly.body).toBe('Player 1 uses IJKL, player 2 uses the arrow keys. Change them before a match.')

    const [, , bothMouse] = steps(false, { 1: 'mouse', 2: 'mouse' })
    expect(bothMouse.title).toBe('Two Players, One Computer')
    expect(bothMouse.body).toBe('Both players use the mouse. Drag in your own half.')
  })

  it("follows the fleet template for every desktop seat pair, within 90 characters, with hud's SeatDevicesHint showing each seat's device", () => {
    for (const p1 of ALL_SCHEMES) {
      for (const p2 of ALL_SCHEMES) {
        const [, , card] = steps(false, { 1: p1, 2: p2 })
        const seats: Record<Player, ControlScheme> = { 1: p1, 2: p2 }
        const anyMouse = seats[1] === 'mouse' || seats[2] === 'mouse'
        const bothMouse = seats[1] === 'mouse' && seats[2] === 'mouse'
        const tail = anyMouse ? ' Drag in your own half.' : ' Change them before a match.'

        expect(card.title).toBe(anyMouse ? 'Two Players, One Computer' : 'Two Players, One Keyboard')
        expect(card.body).toBe(bothMouse ? `Both players use the mouse.${tail}` : `Player 1 uses ${PHRASE[seats[1]]}, player 2 uses ${PHRASE[seats[2]]}.${tail}`)
        expect(card.body.length).toBeLessThanOrEqual(90)
        expect(card.art).toMatchObject({ type: SeatDevicesHint, props: { devices: [DEVICE[seats[1]], DEVICE[seats[2]]] } })
      }
    }
  })
})
