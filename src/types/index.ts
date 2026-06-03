export type Player = 1 | 2

export type GamePhase = 'idle' | 'aiming' | 'simulating' | 'scored' | 'gameOver'

export type BoardVariant = 'classic' | 'open' | 'gauntlet'

export interface Obstacle {
  x: number
  y: number
  width: number
  height: number
}

export interface BoardLayout {
  x: number
  y: number
  width: number
  height: number
  wallThickness: number
  goalWidth: number
  goalLeft: number
  goalRight: number
  puckRadius: number
  centerX: number
  centerY: number
  obstacles: Obstacle[]
}

export interface PuckState {
  x: number
  y: number
  vx: number
  vy: number
}

export interface AimIndicator {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export interface GameState {
  phase: GamePhase
  currentPlayer: Player
  scores: [number, number]
  puck: PuckState
  aim: AimIndicator | null
  bounceCount: number
  lastScoredGoal: 'top' | 'bottom' | null
}
