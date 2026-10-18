// 'stick' control scheme (see ControlScheme's own doc comment in types/index.ts): the finger is the
// stick blade and the shot is the contact (utils/stick.ts), checked in the reducer on every aim
// update, and on every physics step during an intercept.

import { FRICTION_LEVELS, MAX_SPEED, STICK_RESTITUTION, STICK_VELOCITY_SCALE } from '@/constants/game'
import { makeReducer } from '@/hooks/useGameState'
import { BoardLayout, ControlScheme, GameState, Player } from '@/types'
import { clampBladeToBoard, planStickSwing, resolveStickContact, stickBladeRadius } from '@/utils/stick'

// Same synthetic board the other reducer suites use.
const board: BoardLayout = {
  x: 10,
  y: 10,
  width: 300,
  height: 500,
  wallThickness: 8,
  goalWidth: 80,
  goalLeft: 110,
  goalRight: 190,
  puckRadius: 18,
  centerX: 160,
  centerY: 260,
  obstacles: [],
  gravityWells: [],
  goalPosts: [],
  wallPosts: [],
  cornerRadius: 0,
  behindGoalDepth: 0,
  faceoffOffsetYRatio: 0.42,
  boardMarginTop: 0
}
const R = board.puckRadius + stickBladeRadius(board)
const STICK: Record<Player, ControlScheme> = { 1: 'stick', 2: 'stick' }

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'idle',
    currentPlayer: 1,
    scores: [0, 0],
    puck: { x: board.centerX, y: board.centerY, vx: 0, vy: 0 },
    aim: null,
    interceptAim: null,
    pendingShot: null,
    bounceCount: 0,
    lastScoredGoal: null,
    wellEnterCount: 0,
    lastWellPolarity: null,
    goalDoorHitCount: 0,
    lastGoalDoorSide: null,
    faceoff: null,
    faceoffRound: 0,
    tripleTap: null,
    tripleTapRound: 0,
    ...overrides
  }
}

const atRest = (x: number, y: number) => ({ x, y })

describe('resolveStickContact', () => {
  const puck = atRest(160, 260)

  it('a square hit on a resting puck sends it straight along the swing at (1 + restitution) times the blade speed', () => {
    const hit = resolveStickContact({ bladeFrom: atRest(160, 260 + R + 20), bladeTo: atRest(160, 260 + R - 5), bladeVx: 0, bladeVy: -300, puckFrom: puck, puckTo: puck, puckVx: 0, puckVy: 0 }, board)
    expect(hit).not.toBeNull()
    expect(hit!.vx).toBeCloseTo(0)
    expect(hit!.vy).toBeCloseTo(-(1 + STICK_RESTITUTION) * 300 * STICK_VELOCITY_SCALE)
  })

  it('a glancing hit sends the puck off sideways and softer, away from the side the blade touched', () => {
    // Blade swinging straight up, but offset to the puck's right: it clips the right edge.
    const offset = R * 0.8
    const square = resolveStickContact({ bladeFrom: atRest(160, 260 + R + 30), bladeTo: atRest(160, 260), bladeVx: 0, bladeVy: -600, puckFrom: puck, puckTo: puck, puckVx: 0, puckVy: 0 }, board)!
    const glance = resolveStickContact({ bladeFrom: atRest(160 + offset, 260 + R + 30), bladeTo: atRest(160 + offset, 260), bladeVx: 0, bladeVy: -600, puckFrom: puck, puckTo: puck, puckVx: 0, puckVy: 0 }, board)!
    expect(glance.vx).toBeLessThan(0)
    expect(Math.abs(glance.vx)).toBeGreaterThan(Math.abs(glance.vy) * 0.5)
    expect(Math.hypot(glance.vx, glance.vy)).toBeLessThan(Math.hypot(square.vx, square.vy))
  })

  it('never exceeds MAX_SPEED', () => {
    const hit = resolveStickContact({ bladeFrom: atRest(160, 260 + R + 50), bladeTo: atRest(160, 260), bladeVx: 0, bladeVy: -50000, puckFrom: puck, puckTo: puck, puckVx: 0, puckVy: 0 }, board)!
    expect(Math.hypot(hit.vx, hit.vy)).toBeCloseTo(MAX_SPEED)
  })

  it('is no hit when the blade misses, moves away, barely moves into the puck, or starts on it', () => {
    const base = { puckFrom: puck, puckTo: puck, puckVx: 0, puckVy: 0 }
    expect(resolveStickContact({ ...base, bladeFrom: atRest(160 + R + 5, 300), bladeTo: atRest(160 + R + 5, 220), bladeVx: 0, bladeVy: -600 }, board)).toBeNull()
    expect(resolveStickContact({ ...base, bladeFrom: atRest(160, 260 + R + 20), bladeTo: atRest(160, 260 + R - 5), bladeVx: 0, bladeVy: 600 }, board)).toBeNull()
    expect(resolveStickContact({ ...base, bladeFrom: atRest(160, 260 + R + 20), bladeTo: atRest(160, 260 + R - 5), bladeVx: 0, bladeVy: -50 }, board)).toBeNull()
    expect(resolveStickContact({ ...base, bladeFrom: atRest(160, 265), bladeTo: atRest(160, 200), bladeVx: 0, bladeVy: -600 }, board)).toBeNull()
  })

  it('a blade held still in a moving puck’s path deflects it', () => {
    const blade = atRest(160, 200)
    // Puck sliding up at 6/step into the blade, crossing contact distance this step.
    const from = atRest(160, 200 + R + 3)
    const to = atRest(160, 200 + R - 3)
    const hit = resolveStickContact({ bladeFrom: blade, bladeTo: blade, bladeVx: 0, bladeVy: 0, puckFrom: from, puckTo: to, puckVx: 0, puckVy: -6 }, board)!
    expect(hit.vy).toBeGreaterThan(0)
    expect(hit.vy).toBeCloseTo(6 * STICK_RESTITUTION)
  })
})

describe('clampBladeToBoard', () => {
  it('keeps the blade inside the walls', () => {
    const rb = stickBladeRadius(board)
    expect(clampBladeToBoard(-100, -100, board)).toEqual({ x: board.x + rb, y: board.y + rb })
    expect(clampBladeToBoard(1000, 1000, board)).toEqual({ x: board.x + board.width - rb, y: board.y + board.height - rb })
    expect(clampBladeToBoard(100, 100, board)).toEqual({ x: 100, y: 100 })
  })

  it('follows a rounded corner’s curve when the rink is on', () => {
    const rink: BoardLayout = { ...board, cornerRadius: 60 }
    const p = clampBladeToBoard(board.x, board.y, rink)
    const arcCenter = { x: board.x + 60, y: board.y + 60 }
    expect(Math.hypot(p.x - arcCenter.x, p.y - arcCenter.y)).toBeCloseTo(60 - stickBladeRadius(board))
  })
})

describe('stick reducer', () => {
  const reducer = makeReducer(5, 'coinFlip', FRICTION_LEVELS.medium, STICK, 0)
  const swingUpThrough = (s: GameState, x: number, fromY: number, toY: number, vy = -600, steps = 4): GameState => {
    for (let i = 1; i <= steps; i++) s = reducer(s, { type: 'AIM_UPDATE', x, y: fromY + ((toY - fromY) * i) / steps, vx: 0, vy, board })
    return s
  }

  it('a swing through the puck is the shot: straight into play, still the shooter’s turn until it stops', () => {
    let s = reducer(makeState(), { type: 'AIM_START', x: 160, y: 360 })
    s = swingUpThrough(s, 160, 360, 250)
    expect(s.phase).toBe('simulating')
    expect(s.aim).toBeNull()
    expect(s.currentPlayer).toBe(1)
    expect(s.puck.vy).toBeLessThan(0)
    expect(s.puck.vx).toBeCloseTo(0)
  })

  it('letting go without a hit is a whiff: back to idle, same player, and a fresh puck reference for the CPU', () => {
    const start = makeState()
    let s = reducer(start, { type: 'AIM_START', x: 60, y: 400 })
    s = reducer(s, { type: 'AIM_UPDATE', x: 60, y: 350, vx: 0, vy: -600, board })
    s = reducer(s, { type: 'STRIKE', dx: 0, dy: -50, vx: 0, vy: -600 })
    expect(s.phase).toBe('idle')
    expect(s.currentPlayer).toBe(1)
    expect(s.puck).toEqual(start.puck)
    expect(s.puck).not.toBe(start.puck)
  })

  it('a blade that lands on the puck has to leave it before it can hit', () => {
    let s = reducer(makeState(), { type: 'AIM_START', x: 160, y: 262 })
    // Touch down on the puck and drag up through it: nothing.
    s = swingUpThrough(s, 160, 262, 240)
    expect(s.phase).toBe('aiming')
    // Leave (below), then swing back up into it: a hit.
    s = reducer(s, { type: 'AIM_UPDATE', x: 160, y: 340, vx: 0, vy: 600, board })
    expect(s.aim?.stickClear).toBe(true)
    s = swingUpThrough(s, 160, 340, 250)
    expect(s.phase).toBe('simulating')
  })

  it('a cornered puck can’t be hit from behind the wall, only dug out from the open side', () => {
    const r = board.puckRadius
    const cornered = { x: board.x + r, y: board.y + r, vx: 0, vy: 0 }
    // Reaching in from past the left wall: the blade is held to the ice, already touching the puck,
    // so dragging along the wall never counts as a hit.
    let s = reducer(makeState({ puck: cornered }), { type: 'AIM_START', x: board.x - 40, y: cornered.y })
    s = reducer(s, { type: 'AIM_UPDATE', x: board.x - 40, y: cornered.y, vx: 600, vy: 0, board })
    for (let i = 1; i <= 4; i++) s = reducer(s, { type: 'AIM_UPDATE', x: board.x - 40 + i * 30, y: cornered.y, vx: 600, vy: 0, board })
    expect(s.phase).toBe('aiming')
    // From the open diagonal, swinging toward the corner: a hit, driven into both walls, and it
    // bounces back out of the corner.
    s = reducer(makeState({ puck: cornered }), { type: 'AIM_START', x: cornered.x + 60, y: cornered.y + 60 })
    for (let i = 1; i <= 6; i++) s = reducer(s, { type: 'AIM_UPDATE', x: cornered.x + 60 - i * 10, y: cornered.y + 60 - i * 10, vx: -500, vy: -500, board })
    expect(s.phase).toBe('simulating')
    expect(s.puck.vx).toBeLessThan(0)
    expect(s.puck.vy).toBeLessThan(0)
    for (let i = 0; i < 20 && s.phase === 'simulating'; i++) s = reducer(s, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: null })
    expect(s.puck.x).toBeGreaterThan(cornered.x + r)
    expect(s.puck.y).toBeGreaterThan(cornered.y + r)
  })

  it('an intercept: a blade held in a sliding puck’s path deflects it and takes the turn', () => {
    const interceptReducer = makeReducer(5, 'coinFlip', 1, STICK, 10)
    // P1 shot; P2 holds a blade above the puck as it slides up into it.
    let s = makeState({ phase: 'simulating', currentPlayer: 1, puck: { x: 160, y: 300, vx: 0, vy: -4 } })
    s = interceptReducer(s, { type: 'AIM_START', x: 160, y: 240 })
    expect(s.interceptAim).not.toBeNull()
    for (let i = 0; i < 40 && s.interceptAim; i++) s = interceptReducer(s, { type: 'PHYSICS_STEP', board, dt: 1, interceptTouch: { x: 160, y: 240, vx: 0, vy: 0 } })
    expect(s.interceptAim).toBeNull()
    expect(s.currentPlayer).toBe(2)
    expect(s.puck.vy).toBeGreaterThan(0)
  })
})

describe('planStickSwing (CPU)', () => {
  it('swings straight along the planned direction when the puck is in the open', () => {
    const plan = planStickSwing(atRest(160, 260), 0, -1, 15, board)
    expect(plan.dirX).toBeCloseTo(0)
    expect(plan.dirY).toBeCloseTo(-1)
    expect(plan.startY).toBeGreaterThan(260 + R)
  })

  it('for a cornered puck planned into the corner, picks a reachable direction out of it', () => {
    const r = board.puckRadius
    const cornered = atRest(board.x + r, board.y + r)
    // Planned shot: up-left, into the corner - its contact point is off the ice.
    const plan = planStickSwing(cornered, -Math.SQRT1_2, -Math.SQRT1_2, 15, board)
    const contact = { x: cornered.x - plan.dirX * R, y: cornered.y - plan.dirY * R }
    const clamped = clampBladeToBoard(contact.x, contact.y, board)
    expect(Math.hypot(clamped.x - contact.x, clamped.y - contact.y)).toBeLessThan(0.5)
  })

  it('played through the reducer like useAIOpponent does, the swing lands a hit', () => {
    const reducer = makeReducer(5, 'coinFlip', FRICTION_LEVELS.medium, STICK, 0)
    for (const [fx, fy, px, py] of [
      [0, -1, 160, 260],
      [0.6, -0.8, 160, 400],
      [-1, 0, 250, 100],
      [-Math.SQRT1_2, -Math.SQRT1_2, board.x + board.puckRadius, board.y + board.puckRadius]
    ]) {
      const puck = { x: px, y: py, vx: 0, vy: 0 }
      const plan = planStickSwing(puck, fx, fy, 15, board)
      let s = reducer(makeState({ puck }), { type: 'AIM_START', x: plan.startX, y: plan.startY })
      const stepPx = (plan.bladeSpeed * 16) / 1000
      for (let i = 1; i <= Math.ceil(plan.travel / stepPx); i++) {
        const t = Math.min(i * stepPx, plan.travel)
        s = reducer(s, { type: 'AIM_UPDATE', x: plan.startX + plan.dirX * t, y: plan.startY + plan.dirY * t, vx: plan.dirX * plan.bladeSpeed, vy: plan.dirY * plan.bladeSpeed, board })
      }
      expect(s.phase).toBe('simulating')
    }
  })
})
