import { GameMode } from '@/shared/paddleGame/types'

// Whether a round has a brick field: always in solo (only Breaker has one: seat 2 set to Nobody),
// otherwise whatever the game says (Paddles never, Breaker always). Read by the play screen's board
// and state setup.
export function bricksActiveFor(gameMode: GameMode, gameHasBricks: boolean): boolean {
  return gameMode === 'solo' || gameHasBricks
}

// Whether a round's paddle can be steered by tilting the device: never with two people, who share
// one device through TouchInputLayer's split touch zones (one tilt reading can't steer two paddles).
// Read by the play screen (TiltInputLayer, and the orientation lock it forces) and the loadout
// (whether to show the toggle at all).
export function tiltControlActiveFor(gameMode: GameMode, tiltControlEnabled: boolean): boolean {
  return gameMode !== 'twoPlayer' && tiltControlEnabled
}
