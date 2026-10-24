import { useGameLoop } from '@tastic/core'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { GOAL_SERVE_PAUSE_MS, PADDLE_VELOCITY_SMOOTHING_FRAMES } from '@/games/airhockey/constants/game'
import { BoardLayout, GameState, GoalSide, PaddleState, Player, PuckState } from '@/games/airhockey/types'
import { centerPaddle, centerPuck, clampToOwnHalf, faceoffZoneCenter } from '@/games/airhockey/utils/board'
import { applyPaddleCollision, clampPaddleSpeed, computePaddleVelocity, stepPhysics } from '@/games/airhockey/utils/physics'

type PaddleTargets = Record<Player, { x: number; y: number }>

type Action = { type: 'TICK'; board: BoardLayout; dt: number; targets: PaddleTargets } | { type: 'START' } | { type: 'GOAL_SERVE'; board: BoardLayout; zoneIndex: 0 | 1 } | { type: 'RESET'; board: BoardLayout } | { type: 'RESCALE'; prevBoard: BoardLayout; board: BoardLayout }

// Puck/paddle positions are stored in absolute pixels tied to a specific BoardLayout, but board
// itself can change at any moment - not just once at mount: useSafeAreaInsets/useOrientationState
// both resolve asynchronously after game.tsx's first paint, a live browser/window resize can fire at
// any time, and rotating the device mid-rally genuinely changes GoalAxis. Remaps a point by its
// FRACTIONAL position within the old board's playing field onto the same fraction of the new
// one (and scales velocity by the same ratio, so an in-flight puck's speed stays proportionally
// consistent) - this is what actually keeps the puck/paddles sane across every one of those
// cases, in every phase, rather than only patching the pre-game settling window.
function rescalePoint<T extends { x: number; y: number; vx: number; vy: number }>(point: T, prevBoard: BoardLayout, board: BoardLayout): T {
  // A degenerate zero-sized prevBoard (e.g. web's very first render, before hydration has a real
  // window size to measure) has nothing sane to compute a fraction FROM - fall back to dead
  // center rather than dividing by zero into NaN.
  const degenerate = prevBoard.width <= 0 || prevBoard.height <= 0
  const fx = degenerate ? 0.5 : (point.x - prevBoard.x) / prevBoard.width
  const fy = degenerate ? 0.5 : (point.y - prevBoard.y) / prevBoard.height
  const scaleX = degenerate ? 1 : board.width / prevBoard.width
  const scaleY = degenerate ? 1 : board.height / prevBoard.height
  return { ...point, x: board.x + fx * board.width, y: board.y + fy * board.height, vx: point.vx * scaleX, vy: point.vy * scaleY }
}

function makeInitialState(board: BoardLayout): GameState {
  const puckPos = centerPuck(board)
  const p1 = centerPaddle(board, 1)
  const p2 = centerPaddle(board, 2)
  return {
    phase: 'idle',
    scores: [0, 0],
    puck: { ...puckPos, vx: 0, vy: 0 },
    paddles: { 1: { ...p1, vx: 0, vy: 0 }, 2: { ...p2, vx: 0, vy: 0 } },
    lastScoredGoal: null,
    bounceCount: 0,
    goalDoorHitCount: 0,
    lastGoalDoorSide: null,
    pocketDoorHit: null
  }
}

// The pocket the puck sits fully inside (entirely past that goal line), or null. No paddle can
// ever reach it there: clampToOwnHalf stops every paddle at the line.
function pocketSide(puck: PuckState, board: BoardLayout): GoalSide | null {
  if (puck.y + board.puckRadius < board.y) return 'top'
  if (puck.y - board.puckRadius > board.y + board.height) return 'bottom'
  return null
}

// Commits one player's paddle from its raw target position into a real, velocity-bearing
// PaddleState - an EMA over the instantaneous per-tick velocity (rather than a plain moving-
// average ring buffer) so a single jittery touch sample can't read as a wild instantaneous
// velocity: PADDLE_VELOCITY_SMOOTHING_FRAMES doubles as the EMA's effective window, expressed
// purely as a function of the PREVIOUS committed paddle state (already itself smoothed from the
// tick before) - no separate history buffer needs to live anywhere.
function commitPaddle(prev: PaddleState, target: { x: number; y: number }, dt: number): PaddleState {
  const instant = computePaddleVelocity(prev.x, prev.y, target.x, target.y, dt)
  const alpha = 1 / PADDLE_VELOCITY_SMOOTHING_FRAMES
  const smoothed = clampPaddleSpeed(prev.vx + (instant.vx - prev.vx) * alpha, prev.vy + (instant.vy - prev.vy) * alpha)
  return { x: target.x, y: target.y, vx: smoothed.vx, vy: smoothed.vy }
}

export function makeReducer(scoreToWin: number, friction: number) {
  return function reducer(state: GameState, action: Action): GameState {
    switch (action.type) {
      // idle -> live: the "get ready" beat, same pause GOAL_SERVE gives after a goal (see
      // useGameState's own effect below). The puck is already on its spot (center from
      // makeInitialState, or a faceoff zone after TICK re-served a stranded puck), so this only has
      // to flip the phase, no repositioning needed.
      case 'START':
        if (state.phase !== 'idle') return state
        return { ...state, phase: 'live' }

      case 'TICK': {
        if (state.phase !== 'live') return state

        const paddles = {
          1: commitPaddle(state.paddles[1], action.targets[1], action.dt),
          2: commitPaddle(state.paddles[2], action.targets[2], action.dt)
        }

        let puck: PuckState = state.puck
        puck = applyPaddleCollision(puck, state.paddles[1], paddles[1], action.board.puckRadius, action.board.paddleRadius)
        puck = applyPaddleCollision(puck, state.paddles[2], paddles[2], action.board.puckRadius, action.board.paddleRadius)
        const result = stepPhysics(puck, action.board, action.dt, friction)

        // A puck rattling between a pocket's back wall and its one-way door hits the door again on
        // every lap: only the first hit of each pocket visit counts (the stat and Board's flash).
        const pocket = pocketSide(result, action.board)
        const goalDoorHit = result.goalDoorHit !== state.pocketDoorHit ? result.goalDoorHit : null
        const goalDoorHitCount = goalDoorHit ? state.goalDoorHitCount + 1 : state.goalDoorHitCount
        const lastGoalDoorSide = goalDoorHit ?? state.lastGoalDoorSide
        const pocketDoorHit = pocket === null ? null : (goalDoorHit ?? state.pocketDoorHit)

        if (result.scored !== null) {
          const scores: [number, number] = [state.scores[0], state.scores[1]]
          scores[result.scored - 1]++
          const nextPuck: PuckState = { x: result.x, y: result.y, vx: 0, vy: 0 }
          // Player 1 scores by entering the LOCAL TOP goal (player 2's own crease - see
          // playerGoalSide in utils/board.ts and stepPhysics' own scored:1/2 convention), so the
          // celebration's physical side is the inverse of the scoring player number.
          const lastScoredGoal = result.scored === 1 ? 'top' : 'bottom'
          if (scores[result.scored - 1] >= scoreToWin) {
            return { ...state, phase: 'gameOver', scores, puck: nextPuck, paddles, lastScoredGoal, goalDoorHitCount, lastGoalDoorSide, pocketDoorHit: null }
          }
          return { ...state, phase: 'goalScored', scores, puck: nextPuck, paddles, lastScoredGoal, goalDoorHitCount, lastGoalDoorSide, pocketDoorHit: null }
        }

        const bounceCount = result.bounced ? state.bounceCount + 1 : state.bounceCount

        // Unlike BoxHockey, a stopped puck does not end anything here - there is no turn to pass.
        // It simply sits there, mid-rally, until a paddle touches it again, same as a real table.
        // Except behind a goal line, where no paddle can follow it. Pucks back there skip friction
        // (see stepPhysicsOnce), but every bounce between the one-way door and the pocket's back
        // wall still costs WALL_RESTITUTION, so one with little sideways speed slows to a stop
        // without ever getting out. Re-serve it, with no goal, from the nearer faceoff zone in that
        // end (the top pocket sits behind player 2's goal, the same mapping GOAL_SERVE uses for the
        // scored-on player), after the usual 'idle' serve beat.
        if (result.stopped && pocket !== null) {
          const owner: Player = pocket === 'top' ? 2 : 1
          const goalCX = action.board.x + (action.board.goalStart + action.board.goalEnd) / 2
          const puckPos = faceoffZoneCenter(action.board, owner, result.x < goalCX ? 0 : 1)
          return { ...state, phase: 'idle', puck: { ...puckPos, vx: 0, vy: 0 }, paddles, bounceCount, goalDoorHitCount, lastGoalDoorSide, pocketDoorHit: null }
        }

        return { ...state, puck: result, paddles, bounceCount, goalDoorHitCount, lastGoalDoorSide, pocketDoorHit }
      }

      // Post-goal re-serve - see useGameState's own GOAL_SERVE_PAUSE_MS timer. Unlike BoxHockey
      // there's no possession/turn logic to resolve here (either player can go for the puck the
      // instant it lands), but the SPOT itself isn't neutral: the puck spawns at one of the
      // scored-on player's own rink faceoff zones (action.zoneIndex, randomized at the dispatch
      // site below - reducers stay pure) rather than dead center, the same way a real rink awards
      // the ensuing faceoff to whoever just conceded.
      case 'GOAL_SERVE': {
        if (state.phase !== 'goalScored') return state
        const scoredOnPlayer: Player = state.lastScoredGoal === 'top' ? 2 : 1
        const puckPos = faceoffZoneCenter(action.board, scoredOnPlayer, action.zoneIndex)
        const p1 = centerPaddle(action.board, 1)
        const p2 = centerPaddle(action.board, 2)
        return {
          ...state,
          phase: 'live',
          puck: { ...puckPos, vx: 0, vy: 0 },
          paddles: { 1: { ...p1, vx: 0, vy: 0 }, 2: { ...p2, vx: 0, vy: 0 } },
          lastScoredGoal: null
        }
      }

      case 'RESET':
        return makeInitialState(action.board)

      case 'RESCALE':
        return {
          ...state,
          puck: rescalePoint(state.puck, action.prevBoard, action.board),
          paddles: { 1: rescalePoint(state.paddles[1], action.prevBoard, action.board), 2: rescalePoint(state.paddles[2], action.prevBoard, action.board) }
        }

      default:
        return state
    }
  }
}

export function useGameState(board: BoardLayout, scoreToWin: number, friction: number, paused: boolean) {
  // Passing a freshly-made reducer on every render (rather than memoizing it) is safe and
  // intentional: React always uses the CURRENT render's reducer argument to process any pending
  // dispatch, and dispatch's own identity stays stable regardless - so scoreToWin/friction changes
  // are picked up immediately, with no stale-closure ref indirection needed.
  const [state, dispatch] = useReducer(makeReducer(scoreToWin, friction), board, makeInitialState)

  const boardRef = useRef(board)
  useEffect(() => {
    boardRef.current = board
  })

  // Raw, unthrottled paddle targets - written every touch sample (TouchInputLayer) or AI decision
  // (useAIOpponent) via setPaddleTarget below, WITHOUT dispatching (a dispatch per touch sample
  // would re-render well over 60 times a second on some devices). The physics tick reads whatever
  // this ref currently holds once per animation frame - the same cadence stepPhysics itself runs
  // at - and folds the read into the SAME TICK dispatch that also steps the puck, so a player's
  // and the AI's target both flow through this identical commit path (see commitPaddle above).
  const paddleTargetsRef = useRef<PaddleTargets>({ 1: centerPaddle(board, 1), 2: centerPaddle(board, 2) })

  const setPaddleTarget = useCallback((player: Player, x: number, y: number) => {
    const clamped = clampToOwnHalf(x, y, boardRef.current, player, boardRef.current.paddleRadius)
    paddleTargetsRef.current = { ...paddleTargetsRef.current, [player]: clamped }
  }, [])

  useGameLoop((dt) => dispatch({ type: 'TICK', board: boardRef.current, dt, targets: paddleTargetsRef.current }), { enabled: state.phase === 'live' && !paused, maxDt: 2.5 })

  // useReducer's lazy init (the `board` argument passed to useReducer below) only ever runs ONCE,
  // at this hook's very first mount - but `board` itself can change again at any later point too:
  // useSafeAreaInsets/useOrientationState both resolve asynchronously after game.tsx's first paint, a
  // live window resize can fire at any time, and rotating the device mid-rally genuinely changes
  // GoalAxis. Rescaling on every board change (see rescalePoint above), not just while idle, is
  // what actually keeps the puck/paddles' absolute-pixel positions sane across all of those -
  // including the pre-game settling window, where it's simply invisible since nothing's moved yet.
  const prevBoardRef = useRef(board)
  useEffect(() => {
    const prevBoard = prevBoardRef.current
    if (board === prevBoard) return
    prevBoardRef.current = board
    // A degenerate zero-sized prevBoard (web's very first render, before hydration has a real
    // window size to measure) can only ever be true right at mount - real gameplay can't have
    // happened against a board with 0 width. Re-centering fresh (each point at its OWN correct
    // spot) rather than fractionally rescaling from it is what actually matters here: rescalePoint
    // treats a degenerate prevBoard as "everything was at the 0.5,0.5 fraction" (its own last-
    // resort anti-NaN fallback), which would collapse the puck AND BOTH paddles onto the exact
    // same center point instead of each landing at its own distinct starting position.
    if (prevBoard.width <= 0 || prevBoard.height <= 0) {
      paddleTargetsRef.current = { 1: centerPaddle(board, 1), 2: centerPaddle(board, 2) }
      dispatch({ type: 'RESET', board })
      return
    }
    paddleTargetsRef.current = { 1: rescalePoint({ ...paddleTargetsRef.current[1], vx: 0, vy: 0 }, prevBoard, board), 2: rescalePoint({ ...paddleTargetsRef.current[2], vx: 0, vy: 0 }, prevBoard, board) }
    dispatch({ type: 'RESCALE', prevBoard, board })
  }, [board])

  // Owns the idle->live and goalScored->live pauses itself, rather than pushing timer bookkeeping
  // out to game.tsx - this is the game's own internal rhythm, not something the screen layer
  // needs to orchestrate. Re-runs (and so restarts the pause from scratch) whenever `paused`
  // toggles, so a settings/quit-confirm dialog opened mid-pause doesn't let the puck go live off
  // a stale timer that counted time the dialog was covering the board.
  useEffect(() => {
    if (paused) return
    if (state.phase === 'idle' || state.phase === 'goalScored') {
      const t = setTimeout(() => {
        if (state.phase === 'idle') dispatch({ type: 'START' })
        else dispatch({ type: 'GOAL_SERVE', board: boardRef.current, zoneIndex: Math.random() < 0.5 ? 0 : 1 })
      }, GOAL_SERVE_PAUSE_MS)
      return () => clearTimeout(t)
    }
    return undefined
  }, [state.phase, paused])

  const resetGame = useCallback((currentBoard: BoardLayout) => {
    paddleTargetsRef.current = { 1: centerPaddle(currentBoard, 1), 2: centerPaddle(currentBoard, 2) }
    dispatch({ type: 'RESET', board: currentBoard })
  }, [])

  return { state, setPaddleTarget, resetGame }
}
