import { createPaddleGame } from '@/shared/paddleGame/createPaddleGame'

// Breaker: Paddles with a field of bricks between the paddles, from Pong's Bricks toggle, and a
// round alone (seat 2 set to Nobody) that was Pong's Brickbreaker. Its icon is Pong's until Jay draws
// one of its own.
export const breaker = createPaddleGame({
  id: 'breaker',
  title: 'Breaker',
  blurb: 'The classic brick breaker, solo or head to head.',
  icon: { light: require('./art/icon-light.png'), dark: require('./art/icon-dark.png') },
  hasBricks: true,
  guideVersion: 1
})
