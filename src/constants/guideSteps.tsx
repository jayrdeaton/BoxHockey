import type { GuideStep } from '@tastic/hud/guide'

import { GuideCoinArt, GuideFaceoffArt, GuideGoalArt, GuideShotArt, GuideTripleTapArt } from '@/components/GuideArt'
import { CONTROL_SCHEME_SIGN } from '@/constants/game'
import type { ControlScheme, GameMode, Player, TipoffMode } from '@/types'

// How to shoot, for one scheme (the default is 'flick' for both seats, see
// redux/settingsSlice.ts). Power model per resolveStrikeVelocity in useGameState.ts: 'flick' is
// speed-based, 'pull'/'push' distance-based up to MAX_STICK_PULLBACK_PIXELS. "From anywhere" because
// a shot starts wherever the finger or mouse lands, never only on the puck (useGameState.ts's
// tryAimStart). The direction is stated as where the PUCK flies relative to the gesture, per
// CONTROL_SCHEME_SIGN (constants/game.ts): 'flick'/'push' fire along the drag, 'pull' opposite it.
// That's the non-obvious part (the gesture sets the direction; where the puck sits doesn't matter),
// so the copy avoids the loadout's "toward your shot", which can be misread as "toward the puck". A
// desktop player drags the mouse; they never swipe.
const SHOOT_BODY: Record<ControlScheme, { touch: string; desktop: string }> = {
  flick: {
    touch: 'Swipe fast from anywhere. The puck flies the way you swipe. Faster swipes hit harder.',
    desktop: 'Drag the mouse fast from anywhere. The puck flies that way. Faster drags hit harder.'
  },
  push: {
    touch: 'Drag from anywhere and let go. The puck flies the way you drag. Longer drags hit harder.',
    desktop: 'Drag from anywhere and let go. The puck flies the way you drag. Longer drags hit harder.'
  },
  pull: {
    touch: 'Drag from anywhere and let go. The puck flies the opposite way. Longer drags hit harder.',
    desktop: 'Drag from anywhere and let go. The puck flies the opposite way. Longer drags hit harder.'
  }
}

// Each seat's gesture, named for the mixed-scheme sentence below; its direction comes from
// CONTROL_SCHEME_SIGN, so this can't drift from the engine either.
const SHOOT_GESTURE: Record<ControlScheme, { touch: string; desktop: string }> = {
  flick: { touch: 'fast swipe', desktop: 'fast drag' },
  push: { touch: 'drag', desktop: 'drag' },
  pull: { touch: 'drag', desktop: 'drag' }
}

function seatShot(player: Player, scheme: ControlScheme, input: 'touch' | 'desktop'): string {
  return `${CONTROL_SCHEME_SIGN[scheme] > 0 ? 'along' : 'against'} player ${player}’s ${SHOOT_GESTURE[scheme][input]}`
}

// Solo, the reader is always player 1 (the CPU is player 2, utils/gameMode.ts) and has only player
// 1's picker in the loadout, so their own scheme is the whole story: the CPU's settings.controlScheme[2]
// is a leftover it never uses. Otherwise, one "you" sentence when both seats share a scheme, and a
// per-player one when they differ (each seat picks its own), since then no "you" sentence is true for
// both. gameMode is the persisted last pick (Home sets it before opening the loadout, index.tsx), so on
// the loadout it's exact; on Home it's the mode that was played last.
function shootBody(touch: boolean, controls: Record<Player, ControlScheme>, mode: GameMode): string {
  const input = touch ? 'touch' : 'desktop'
  if (mode === 'vsCpu' || controls[1] === controls[2]) return SHOOT_BODY[controls[1]][input]
  return `Start anywhere. The puck flies ${seatShot(1, controls[1], input)} and ${seatShot(2, controls[2], input)}.`
}

// The tip-off card follows the live tipoffMode, since each one starts the game a different way and a
// replay from Settings has to describe the one the next match will actually use. Returns null for the
// one combination a player can't reach: Triple Tap on desktop web (loadout.tsx hides it on web).
function getTipoffStep(tipoff: TipoffMode, touch: boolean): GuideStep | null {
  switch (tipoff) {
    // The default, and the first thing every new player hits: nothing happens until both seats have
    // touched their own half (the CPU readies itself, see useFaceoff.ts), then a countdown, a random
    // hold, and one of each player's two circles lights up; first correct press wins the draw
    // (useGameState.ts's FACEOFF_READY/FACEOFF_TAP). Repeats after every goal. "Your own half" is
    // true solo too: the solo player is player 1, whose ready tap and circles are the bottom half
    // (game.tsx's p1TapGesture). That knowingly departs from @tastic/hud's README convention of saying
    // "your half" only on a two-player card (written for LightCycles, where it's false solo); see
    // .claude/CLAUDE.md's guide section. Desktop uses A/D and ←/→ (game.tsx's FACEOFF_KEY_HINTS) because two
    // people can't race on one mouse.
    case 'faceoff':
      return {
        title: 'Win the Face-Off',
        body: touch ? 'Tap your own half to get ready. When one of your circles lights up, be first to tap it.' : 'Press A or D (player 2: ← or →) to get ready. Be first to press your lit circle’s key.',
        art: <GuideFaceoffArt keys={!touch} />
      }
    // A tap anywhere spins the coin (game.tsx's coinFlipTapGesture covers the whole board); its winner
    // shoots first, and after a goal the player who was scored on gets the puck instead of a new flip
    // (useGameState.ts's makeInitialState and PHYSICS_STEP 'scored').
    case 'coinFlip':
      return {
        title: 'Flip for the First Shot',
        body: touch ? 'Tap anywhere to flip a coin. After a goal, the player who was scored on shoots next.' : 'Click anywhere to flip a coin. After a goal, the player who was scored on shoots next.',
        art: <GuideCoinArt />
      }
    // Two presses in your own half, then a swipe; once both players' swipes are in, their sum launches
    // the puck (useGameState.ts's TRIPLE_TAP_* cases).
    case 'tripleTap':
      return touch
        ? {
            title: 'Tap, Tap, Swipe',
            body: 'Tap your own half twice, then swipe. Both swipes add up to launch the puck.',
            art: <GuideTripleTapArt />
          }
        : null
  }
}

interface GuideStepsInput {
  // A touch screen vs. a desktop browser: a phone shoots by swiping or dragging a finger, a desktop by
  // dragging the mouse (and races face-offs on the keyboard).
  touch: boolean
  // The last-picked mode (settings.gameMode). Solo, only player 1's shooting style matters.
  mode: GameMode
  // Each seat's live shooting style (settings.controlScheme). Seats pick their own in the loadout,
  // so a replayed guide has to describe the real ones, not the defaults.
  controls: Record<Player, ControlScheme>
  // How the next match starts (settings.tipoffMode), Face-Off by default.
  tipoff: TipoffMode
  // Goals needed to win the next match (settings.scoreToWin): 5 by default, 3/5/7/10 in the loadout.
  scoreToWin: number
}

// The cards of BoxHockey's how-to-play flow. Pure and hook-free so it's trivially testable; GuideHost
// feeds it useIsTouchPrimaryDevice() and the live settings, and memoizes the result.
//
// What's here is what a first-time player cannot work out alone (none of it is printed anywhere in
// the game: Board.tsx draws no text, and the only words on screen during play are desktop web's
// face-off key letters): a shot starts anywhere, not on the puck, and the default Flick fires on
// speed, so a slow drag does nothing; it's turn-based, first to N goals, and the only turn cue is the
// puck's ring in the shooter's color; and every match (and every point after a goal) opens on an
// unlabeled face-off that waits for both players to tap their own half.
//
// The goal to shoot at is "the other player's goal", never "the far goal": player 1 scores through
// the top goal and player 2 through the bottom one (utils/physics.ts's stepPhysics), and on desktop
// web the board is never flipped for player 2 (both sit at one upright monitor, so the far goal is
// player 2's own), nor is it on a phone passed between players sitting side by side. Each goal's
// crease is tinted in its owner's color (Board.tsx), which is what makes "the other player's" readable.
//
// Three cards, like LightCycles, but the third is the tip-off rather than "Two Players, One Phone":
// that's the one thing here that blocks play until you know it, while the face-to-face seating is
// already shown by the two-player loadout (player 2's panel sits upside down, facing the far side)
// and by this card's own art. It's also the only place halves matter in this game (shots start
// anywhere on either side), so "your own half" lives here, and it's true solo too.
//
// Copy rules (Jay, 2026-09-24): Title Case titles, one-word buttons (the pager's defaults), short
// bodies, no em dashes or rhetorical questions, and only say what's true for every player who can see
// the card. No card explaining One Player vs Two Player: those buttons are right behind the dialog.
// Off-by-default extras (mid-slide steals, shot preview, board variants) are left out.
export function getGuideSteps({ touch, mode, controls, tipoff, scoreToWin }: GuideStepsInput): GuideStep[] {
  const steps: GuideStep[] = [
    {
      title: 'Shoot the Puck',
      body: shootBody(touch, controls, mode),
      art: <GuideShotArt scheme={controls[1]} touch={touch} />
    },
    {
      title: `First to ${scoreToWin} Goals Wins`,
      body: 'Take turns shooting into the other player’s goal. The puck’s ring shows whose turn it is.',
      art: <GuideGoalArt />
    }
  ]
  const tipoffStep = getTipoffStep(tipoff, touch)
  return tipoffStep ? [...steps, tipoffStep] : steps
}
