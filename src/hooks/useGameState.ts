import { useCallback, useEffect, useReducer, useRef } from 'react'

import { MAX_DRAG_PIXELS, MAX_SPEED, MIN_SHOOT_DRAG, PUCK_HIT_MULTIPLIER } from '@/constants/game'
import { BoardLayout, GameState, Player, PuckState } from '@/types'
import { centerPuck } from '@/utils/board'
import { computeAimVector, stepPhysics } from '@/utils/physics'

type Action =
  | { type: 'AIM_START'; x: number; y: number }
  | { type: 'AIM_UPDATE'; x: number; y: number }
  | { type: 'AIM_CANCEL' }
  | { type: 'SHOOT'; vx: number; vy: number }
  | { type: 'PHYSICS_STEP'; board: BoardLayout; dt: number }
  | { type: 'NEXT_ROUND'; board: BoardLayout }
  | { type: 'RESET'; board: BoardLayout }

function otherPlayer(p: Player): Player {
  return p === 1 ? 2 : 1
}

function makeInitialState(board: BoardLayout): GameState {
  return {
    phase: 'idle',
    currentPlayer: 1,
    scores: [0, 0],
    puck: { ...centerPuck(board), vx: 0, vy: 0 },
    aim: null,
    bounceCount: 0,
    lastScoredGoal: null
  }
}

function makeReducer(scoreToWin: number) {
  return function reducer(state: GameState, action: Action): GameState {
    switch (action.type) {
      case 'AIM_START':
        if (state.phase !== 'idle') return state
        return { ...state, phase: 'aiming', aim: { startX: action.x, startY: action.y, currentX: action.x, currentY: action.y } }

      case 'AIM_UPDATE':
        if (state.phase !== 'aiming' || !state.aim) return state
        return { ...state, aim: { ...state.aim, currentX: action.x, currentY: action.y } }

      case 'AIM_CANCEL':
        if (state.phase !== 'aiming') return state
        return { ...state, phase: 'idle', aim: null }

      case 'SHOOT':
        if (state.phase !== 'aiming') return state
        return { ...state, phase: 'simulating', aim: null, puck: { ...state.puck, vx: action.vx, vy: action.vy } }

      case 'PHYSICS_STEP': {
        if (state.phase !== 'simulating') return state
        const result = stepPhysics(state.puck, action.board, action.dt)

        if (result.scored !== null) {
          const scores: [number, number] = [state.scores[0], state.scores[1]]
          scores[result.scored - 1]++
          const puck: PuckState = { x: result.x, y: result.y, vx: 0, vy: 0 }
          const lastScoredGoal = result.scored === 1 ? 'top' : 'bottom'
          if (scores[result.scored - 1] >= scoreToWin) {
            return { ...state, phase: 'gameOver', scores, puck, lastScoredGoal }
          }
          return { ...state, phase: 'scored', scores, puck, lastScoredGoal, currentPlayer: otherPlayer(state.currentPlayer) }
        }

        if (result.stopped) {
          return { ...state, phase: 'idle', currentPlayer: otherPlayer(state.currentPlayer), puck: { ...result, vx: 0, vy: 0 } }
        }

        return { ...state, puck: result, bounceCount: result.bounced ? state.bounceCount + 1 : state.bounceCount }
      }

      case 'NEXT_ROUND':
        return { ...state, phase: 'idle', puck: { ...centerPuck(action.board), vx: 0, vy: 0 }, aim: null, lastScoredGoal: null }

      case 'RESET':
        return makeInitialState(action.board)

      default:
        return state
    }
  }
}

export function useGameState(board: BoardLayout, scoreToWin: number) {
  const reducerRef = useRef(makeReducer(scoreToWin))
  reducerRef.current = makeReducer(scoreToWin)

  const [state, dispatch] = useReducer(
    (s: GameState, a: Action) => reducerRef.current(s, a),
    { board, scoreToWin },
    (init) => makeInitialState(init.board)
  )

  const boardRef = useRef(board)
  boardRef.current = board
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const activeRef = useRef(false)
  const lastTimestampRef = useRef<number | null>(null)

  useEffect(() => {
    if (state.phase !== 'simulating') return

    activeRef.current = true
    lastTimestampRef.current = null

    const step = (timestamp: number) => {
      if (!activeRef.current) return
      const dt = lastTimestampRef.current !== null ? Math.min((timestamp - lastTimestampRef.current) / 16.67, 2.5) : 1
      lastTimestampRef.current = timestamp
      dispatch({ type: 'PHYSICS_STEP', board: boardRef.current, dt })
      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)

    return () => {
      activeRef.current = false
      lastTimestampRef.current = null
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [state.phase])

  const tryAimStart = useCallback((touchX: number, touchY: number, puck: PuckState, puckRadius: number) => {
    const dx = touchX - puck.x
    const dy = touchY - puck.y
    if (Math.sqrt(dx * dx + dy * dy) > puckRadius * PUCK_HIT_MULTIPLIER) return false
    dispatch({ type: 'AIM_START', x: touchX, y: touchY })
    return true
  }, [])

  const aimUpdate = useCallback((x: number, y: number) => {
    dispatch({ type: 'AIM_UPDATE', x, y })
  }, [])

  const aimCancel = useCallback(() => {
    dispatch({ type: 'AIM_CANCEL' })
  }, [])

  const shoot = useCallback((dx: number, dy: number) => {
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < MIN_SHOOT_DRAG) { dispatch({ type: 'AIM_CANCEL' }); return }
    const { vx, vy } = computeAimVector(dx, dy, MAX_DRAG_PIXELS, MAX_SPEED)
    dispatch({ type: 'SHOOT', vx, vy })
  }, [])

  const nextRound = useCallback((currentBoard: BoardLayout) => {
    dispatch({ type: 'NEXT_ROUND', board: currentBoard })
  }, [])

  const resetGame = useCallback((currentBoard: BoardLayout) => {
    activeRef.current = false
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    dispatch({ type: 'RESET', board: currentBoard })
  }, [])

  return { state, tryAimStart, aimUpdate, aimCancel, shoot, nextRound, resetGame }
}
