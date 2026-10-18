import { render } from '@testing-library/react-native'
import { View } from 'react-native'

import { getGuideSteps } from '@/constants/guideSteps'
import { DEFAULT_SETTINGS } from '@/redux/settingsSlice'
import type { ControlScheme, GameMode, Player, TipoffMode } from '@/types'

// SwipeHint's own rendering is @tastic/hud's to test (it needs Reanimated's useReducedMotion, which
// this app's Reanimated mock doesn't stub). A plain View stands in for it, so the app-local art
// around it still renders for real below.
jest.mock('@tastic/hud/guide', () => ({ SwipeHint: () => require('react').createElement(require('react-native').View) }))

const SCHEMES: ControlScheme[] = ['flick', 'stick', 'push', 'pull']
const TIPOFFS: TipoffMode[] = ['faceoff', 'coinFlip', 'tripleTap']
const MODES: GameMode[] = ['twoPlayer', 'vsCpu']

// A fresh install's live settings: what the auto-shown guide is actually built from.
const DEFAULTS = { mode: DEFAULT_SETTINGS.gameMode, controls: DEFAULT_SETTINGS.controlScheme, tipoff: DEFAULT_SETTINGS.tipoffMode, scoreToWin: DEFAULT_SETTINGS.scoreToWin }

function stepsFor(touch: boolean, overrides: Partial<typeof DEFAULTS> = {}) {
  return getGuideSteps({ touch, ...DEFAULTS, ...overrides })
}

// Every combination of live settings a replay can be built from, on both kinds of device.
function everyGuide() {
  const guides: { touch: boolean; mode: GameMode; controls: Record<Player, ControlScheme>; tipoff: TipoffMode }[] = []
  for (const touch of [true, false]) {
    for (const mode of MODES) {
      for (const p1 of SCHEMES) {
        for (const p2 of SCHEMES) {
          for (const tipoff of TIPOFFS) guides.push({ touch, mode, controls: { 1: p1, 2: p2 }, tipoff })
        }
      }
    }
  }
  return guides.map((input) => ({ ...input, steps: getGuideSteps({ ...input, scoreToWin: 10 }) }))
}

function textOf(steps: ReturnType<typeof getGuideSteps>) {
  return steps.map((step) => `${step.title} ${step.body}`).join(' ')
}

const SMALL_WORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'in', 'on'])

describe('getGuideSteps', () => {
  it.each([
    ['touch', true],
    ['desktop', false]
  ])('gives a fresh %s install three complete, illustrated cards', (_name, touch) => {
    expect(stepsFor(touch)).toHaveLength(3)
  })

  it('keeps every card short, illustrated, Title Case and free of em dashes and questions, whatever the live settings', () => {
    for (const { steps } of everyGuide()) {
      for (const step of steps) {
        // A card a casual player reads in a glance, not a wall of text.
        expect(step.body.length).toBeLessThanOrEqual(90)
        // The pager sizes every page to the tallest, so a card without art leaves a visible gap.
        expect(step.art).toBeDefined()
        for (const word of step.title.split(/[\s-]+/)) {
          if (!SMALL_WORDS.has(word)) expect(word).toMatch(/^[A-Z0-9]/)
        }
        expect(`${step.title} ${step.body}`).not.toMatch(/[\u2014?]/)
      }
    }
  })

  it('never tells a desktop player to swipe, or a touch player to press keys, click or use a mouse', () => {
    for (const { touch, steps } of everyGuide()) {
      if (touch) expect(textOf(steps)).not.toMatch(/\b(press|key|keys|click|mouse)\b/i)
      else expect(textOf(steps)).not.toMatch(/swipe/i)
    }
  })

  it('states the win condition the game never prints: first to the live goal target, taking turns, and the only turn cue', () => {
    for (const touch of [true, false]) {
      const [, win] = stepsFor(touch)
      expect(win.title).toBe('First to 5 Goals Wins')
      expect(win.body).toMatch(/take turns/i)
      // Never "the far goal": on desktop both players face one upright screen, so player 2's far goal
      // is their own (player 1 scores through the top goal, player 2 through the bottom).
      expect(win.body).toMatch(/the other player’s goal/)
      expect(win.body).not.toMatch(/\bfar\b/i)
      expect(win.body).toMatch(/ring shows whose turn/i)
    }
    expect(stepsFor(true, { scoreToWin: 3 })[1].title).toBe('First to 3 Goals Wins')
  })

  it('teaches the default flick: start anywhere, swipe fast on touch, drag the mouse on desktop, and the puck flies that way', () => {
    const [touchShot] = stepsFor(true)
    const [desktopShot] = stepsFor(false)

    expect(touchShot.title).toBe('Shoot the Puck')
    expect(touchShot.body).toBe('Swipe fast from anywhere. The puck flies the way you swipe. Faster swipes hit harder.')
    expect(desktopShot.body).toBe('Drag the mouse fast from anywhere. The puck flies that way. Faster drags hit harder.')
  })

  it('names the direction by where the puck flies, never by a vague "shot" the puck could be mistaken for', () => {
    for (const { steps } of everyGuide()) expect(steps[0].body).not.toMatch(/\bshot\b/i)
  })

  it("describes each seat's live shooting style: a shared one in full, different ones per player", () => {
    expect(stepsFor(true, { controls: { 1: 'pull', 2: 'pull' } })[0].body).toBe('Drag from anywhere and let go. The puck flies the opposite way. Longer drags hit harder.')
    expect(stepsFor(true, { controls: { 1: 'push', 2: 'push' } })[0].body).toBe('Drag from anywhere and let go. The puck flies the way you drag. Longer drags hit harder.')
    expect(stepsFor(true, { controls: { 1: 'flick', 2: 'pull' } })[0].body).toBe('Start anywhere. The puck flies along player 1’s fast swipe and against player 2’s drag.')
    expect(stepsFor(false, { controls: { 1: 'push', 2: 'flick' } })[0].body).toBe('Start anywhere. The puck flies along player 1’s drag and along player 2’s fast drag.')
  })

  it("gives a solo player only their own shooting style, never the CPU's leftover one", () => {
    // vs-CPU has no player 2 picker (loadout.tsx), so controls[2] is whatever it last was.
    expect(stepsFor(true, { mode: 'vsCpu', controls: { 1: 'pull', 2: 'flick' } })[0].body).toBe('Drag from anywhere and let go. The puck flies the opposite way. Longer drags hit harder.')
    expect(stepsFor(false, { mode: 'vsCpu', controls: { 1: 'flick', 2: 'push' } })[0].body).toBe('Drag the mouse fast from anywhere. The puck flies that way. Faster drags hit harder.')
    for (const { mode, steps } of everyGuide()) {
      if (mode === 'vsCpu') expect(steps[0].body).not.toMatch(/player 2/i)
    }
  })

  it('teaches the default face-off, and only says "your own half" there (shots start anywhere)', () => {
    const [shot, win, faceoff] = stepsFor(true)

    expect(faceoff.title).toBe('Win the Face-Off')
    expect(faceoff.body).toMatch(/tap your own half to get ready/i)
    expect(faceoff.body).toMatch(/lights up, be first to tap it/i)
    expect(`${shot.body} ${win.body}`).not.toMatch(/half/i)
  })

  it("names each seat's face-off keys on desktop", () => {
    const [, , faceoff] = stepsFor(false)
    expect(faceoff.body).toMatch(/Press A or D \(player 2: ← or →\) to get ready/)
  })

  it('follows the live tip-off, and leaves out the one a desktop player cannot pick', () => {
    expect(stepsFor(true, { tipoff: 'coinFlip' })[2].body).toMatch(/^Tap anywhere to flip a coin/)
    expect(stepsFor(false, { tipoff: 'coinFlip' })[2].body).toMatch(/^Click anywhere to flip a coin/)
    expect(stepsFor(true, { tipoff: 'tripleTap' })[2].title).toBe('Tap Together, Then Swipe')
    expect(stepsFor(false, { tipoff: 'tripleTap' })).toHaveLength(2)
  })

  it("renders every card's art without crashing, whatever the live settings", async () => {
    for (const { steps } of everyGuide()) {
      for (const step of steps) {
        const view = await render(<View>{step.art}</View>)
        expect(() => view.unmount()).not.toThrow()
      }
    }
  })
})
