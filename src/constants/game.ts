export const FRICTION = 0.986
export const WALL_RESTITUTION = 0.72
export const MAX_SPEED = 22
export const MAX_DRAG_PIXELS = 160
export const MIN_SHOOT_DRAG = 12
export const PUCK_RADIUS_RATIO = 0.058
export const GOAL_WIDTH_RATIO = 0.27
export const WALL_THICKNESS = 10
export const STOP_THRESHOLD = 0.12
export const SCORE_TO_WIN = 5
export const PUCK_HIT_MULTIPLIER = 2.2

export const BOARD_MARGIN = 14
export const SCORE_BAR_HEIGHT = 76

export const COLORS = {
  boardBg: '#0D1F3C',
  boardSurface: '#0F2447',
  wall: '#C8D8F0',
  wallGlow: 'rgba(200, 216, 240, 0.15)',
  goalOpening: '#1A3B6E',
  goalLine: 'rgba(100, 180, 255, 0.6)',
  centerLine: 'rgba(100, 180, 255, 0.15)',
  p1: '#3B82F6',
  p1Light: '#93C5FD',
  p1Dark: '#1D4ED8',
  p2: '#EF4444',
  p2Light: '#FCA5A5',
  p2Dark: '#B91C1C',
  aimLine: 'rgba(255, 255, 255, 0.55)',
  aimArrow: 'rgba(255, 255, 255, 0.9)',
  powerLow: 'rgba(100, 255, 100, 0.8)',
  powerHigh: 'rgba(255, 100, 100, 0.8)'
} as const
