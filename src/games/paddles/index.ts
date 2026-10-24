import { createPaddleGame } from '@/shared/paddleGame/createPaddleGame'

// Paddles: Pong with a puck, from the Pong repo (never released on its own). No bricks and no solo
// round; Breaker is the same game with them.
export const paddles = createPaddleGame({
  id: 'paddles',
  title: 'Paddles',
  blurb: 'The arcade original. Get the puck past their paddle.',
  icon: { light: require('./art/icon-light.png'), dark: require('./art/icon-dark.png') },
  hasBricks: false,
  guideVersion: 1
})
