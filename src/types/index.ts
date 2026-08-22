export type Player = 1 | 2

export type GamePhase = 'idle' | 'aiming' | 'striking' | 'simulating' | 'scored' | 'gameOver'

export type BoardVariant = 'classic' | 'open' | 'gauntlet' | 'gravity'

export type GameMode = 'twoPlayer' | 'vsCpu'

// Seating arrangement for the loadout screen's player panels only — 'portrait' splits it into a
// face-to-face layout (P2's panel rotated 180° so it reads right-side-up from across the table),
// 'landscape' places both panels upright side by side. Has no effect on /game or the device's own
// (fixed-portrait, see app.json) orientation.
export type OrientationMode = 'portrait' | 'landscape'

export interface GameSettings {
  gameMode: GameMode
  boardVariant: BoardVariant
  scoreToWin: number
  aiDifficulty: 'easy' | 'medium' | 'hard'
  orientationMode: OrientationMode
}

export interface Obstacle {
  x: number
  y: number
  width: number
  height: number
}

export interface GravityWell {
  x: number
  y: number
  radius: number // influence radius (px); force is 0 at/beyond this distance
  strength: number // signed peak accel at well center; + = attract, − = repel
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
  gravityWells: GravityWell[]
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

export interface PendingShot {
  vx: number
  vy: number
}

export interface GameState {
  phase: GamePhase
  currentPlayer: Player
  scores: [number, number]
  puck: PuckState
  aim: AimIndicator | null
  pendingShot: PendingShot | null
  bounceCount: number
  lastScoredGoal: 'top' | 'bottom' | null
  wellEnterCount: number
  lastWellPolarity: 'attract' | 'repel' | null
}
