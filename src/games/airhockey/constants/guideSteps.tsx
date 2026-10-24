import { type DirectionKeyLabels, DirectionKeysHint, type GuideStep, type SeatDevice, SeatDevicesHint, SeatDiagram, SwipeHint } from '@tastic/hud/guide'
import type { KeyScheme } from '@tastic/input'

import { GuideScoreArcs } from '@/games/airhockey/components/GuideArt'
import type { ControlScheme, Player } from '@/games/airhockey/types'

// How each control scheme reads in a sentence, and on DirectionKeysHint's caps (undefined = draw the
// arrow keys as arrows). Deliberately not the loadout's own CONTROL_SCHEME_OPTIONS labels ('Arrows',
// 'Numpad'), which are picker labels, not prose. Numpad's caps are the digits @tastic/input's
// KEY_SCHEMES.numpad actually reads (Numpad8/4/2/6).
const SCHEME_PHRASE: Record<ControlScheme, string> = { mouse: 'the mouse', wasd: 'WASD', arrows: 'the arrow keys', ijkl: 'IJKL', numpad: 'the numpad' }
const KEY_CAPS: Record<KeyScheme, DirectionKeyLabels | undefined> = {
  wasd: { up: 'W', left: 'A', down: 'S', right: 'D' },
  arrows: undefined,
  ijkl: { up: 'I', left: 'J', down: 'K', right: 'L' },
  numpad: { up: '8', left: '4', down: '2', right: '6' }
}

interface GuideStepsInput {
  // A touch screen vs. a desktop browser (useIsTouchPrimaryDevice, the same gate @tastic/hud's
  // ControlSchemePicker uses, so desktop copy shows exactly where a seat can pick keys): a phone
  // moves the paddle by finger, a desktop by mouse or key.
  touch: boolean
  // Each seat's live settings.controlScheme, only read on desktop. Seats pick their own in the
  // loadout, so a replayed guide has to name the real ones, not the defaults (P1 mouse, P2 WASD).
  controlScheme: Record<Player, ControlScheme>
  // Live settings.scoreToWin (3/5/7/10, default 5): the win card's headline and its arc count.
  scoreToWin: number
}

function controlsStep(touch: boolean, scheme: ControlScheme): GuideStep {
  const title = 'Move Your Paddle'
  if (touch) return { title, body: 'Your paddle follows your finger. Swipe fast to hit the puck harder.', art: <SwipeHint direction='up' /> }
  // The pointer drives every seat (TouchInputLayer is always on), so the mouse copy can say "your".
  if (scheme === 'mouse') return { title, body: 'Click and drag. Your paddle follows the pointer. Drag fast to hit harder.', art: <SwipeHint pointer='mouse' direction='up' /> }
  // A key scheme is player 1's alone, and in two-player the pickers never let player 2 share it, so
  // "your paddle" would be false for player 2. Naming player 1 stays true in solo too: the solo human
  // is always seat 1 (humanPlayersFor).
  return { title, body: `Player 1 moves with ${SCHEME_PHRASE[scheme]}. Moving into the puck hits it harder.`, art: <DirectionKeysHint labels={KEY_CAPS[scheme]} /> }
}

// What SeatDevicesHint draws for a seat: every key scheme is the one keyboard, 'mouse' is the mouse.
function seatDevice(scheme: ControlScheme): SeatDevice {
  return scheme === 'mouse' ? 'mouse' : 'keyboard'
}

// The fleet's one desktop two-player wording, kept identical across the games that have this card:
// the title says what the two players share, the body names each seat's live scheme, then either how
// the mouse seat plays (only its own half of the table moves its paddle, TouchInputLayer's two zones)
// or, keys only, that the schemes can be changed (the loadout's pickers).
function twoPlayerStep(touch: boolean, controlScheme: Record<Player, ControlScheme>): GuideStep {
  if (touch) return { title: 'Two Players, One Phone', body: 'Sit across from each other and keep your finger in your own half.', art: <SeatDiagram /> }
  const anyMouse = controlScheme[1] === 'mouse' || controlScheme[2] === 'mouse'
  // Both seats on the mouse is said once ("Both players use the mouse.") instead of twice. The
  // loadout's pickers can't produce that pair (assignSeatScheme swaps), so only settings saved
  // before they did still reach this branch.
  const who = controlScheme[1] === 'mouse' && controlScheme[2] === 'mouse' ? 'Both players use the mouse.' : `Player 1 uses ${SCHEME_PHRASE[controlScheme[1]]}, player 2 uses ${SCHEME_PHRASE[controlScheme[2]]}.`
  return {
    // "One Keyboard" is only true when neither seat is on the mouse, and by default player 1 is.
    title: anyMouse ? 'Two Players, One Computer' : 'Two Players, One Keyboard',
    body: `${who} ${anyMouse ? 'Drag in your own half.' : 'Change them before a match.'}`,
    art: <SeatDevicesHint devices={[seatDevice(controlScheme[1]), seatDevice(controlScheme[2])]} />
  }
}

// The three cards of AirHockey's how-to-play flow. Pure and hook-free so it's trivially testable;
// GuideHost feeds it useIsTouchPrimaryDevice() and the live settings, and memoizes the result.
//
// What's here is what a first-time player cannot work out alone: you don't have to grab your paddle
// (it jumps to your finger or pointer, TouchInputLayer + useGameState's setPaddleTarget) and a faster
// swing hits harder (applyPaddleCollision adds the paddle's velocity to the puck); the score is never
// a number during play, only arcs lit in front of each player's OWN goal (Board.tsx's ScoreWedges);
// and in two-player one phone is shared face to face, each player touching only their own half
// (TouchInputLayer's two zones). Copy rules (Jay, 2026-09-24): Title Case titles, short bodies, and
// only say what's true in every mode. "Your own half" is only a touch rule in two-player (solo
// touches anywhere on the table), so it lives on the two-player card, not the controls one. There's no
// card explaining One Player vs Two Player: those buttons are right behind the dialog. The desktop
// copy names each seat's live scheme, including 'mouse', and never says swipe or finger.
export function getGuideSteps({ touch, controlScheme, scoreToWin }: GuideStepsInput): GuideStep[] {
  return [
    controlsStep(touch, controlScheme[1]),
    {
      // Same headline as BoxHockey's, the other hockey game. "At your end": Board.tsx draws each
      // player's score in their OWN crease (scores[0] at player 1's bottom goal).
      title: `First to ${scoreToWin} Goals Wins`,
      body: 'Each goal you score lights up one arc at your end.',
      art: <GuideScoreArcs count={scoreToWin} filled={Math.min(2, scoreToWin - 1)} />
    },
    twoPlayerStep(touch, controlScheme)
  ]
}
