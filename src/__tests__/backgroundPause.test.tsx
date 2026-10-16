import { useBackgroundPause } from '@tastic/core'
import { act, renderHook } from '@testing-library/react-native'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { FACEOFF_COUNTDOWN_STEP_MS, FRICTION_LEVELS, INTERCEPT_SPEED_THRESHOLDS } from '@/constants/game'
import { useAIOpponent } from '@/hooks/useAIOpponent'
import { useFaceoff } from '@/hooks/useFaceoff'
import { useGameState } from '@/hooks/useGameState'
import { DEFAULT_SETTINGS } from '@/redux/settingsSlice'
import { BoardLayout, Player, TipoffMode } from '@/types'

import { emitAppState } from '../testUtils/appState'

// Same synthetic board physics.test.ts uses.
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

const FRICTION = FRICTION_LEVELS[DEFAULT_SETTINGS.friction]
const INTERCEPT = INTERCEPT_SPEED_THRESHOLDS[DEFAULT_SETTINGS.interceptSpeed]
const CONTROLS = DEFAULT_SETTINGS.controlScheme

interface MatchProps {
  tipoffMode: TipoffMode
  aiPlayer: Player | null
  // game.tsx drops the aim the moment any pause lands (its aimCancel effect); false shows why it has to.
  cancelAimOnPause: boolean
  // Settings or Quit Match? open. On desktop web the corner buttons stay up mid-shot, so this can
  // land in the middle of a CPU windup too.
  dialogOpen?: boolean
}

// GameScreen's pause wiring in miniature: the same game hooks, fed `paused` from the real
// useBackgroundPause plus a dialog flag standing in for settingsOpen/confirmVisible.
function useMatch({ tipoffMode, aiPlayer, cancelAimOnPause, dialogOpen = false }: MatchProps) {
  const { backgroundPaused, resume } = useBackgroundPause(() => state.phase !== 'gameOver' && !dialogOpen)
  const paused = dialogOpen || backgroundPaused
  const controls = useGameState(board, DEFAULT_SETTINGS.scoreToWin, tipoffMode, FRICTION, CONTROLS, paused, INTERCEPT)
  const { state, aimCancel } = controls
  useAIOpponent(state, board, aiPlayer, 'hard', FRICTION, CONTROLS, paused, INTERCEPT, controls)
  useFaceoff(state, board, aiPlayer, 'hard', paused, controls)
  useEffect(() => {
    if (paused && cancelAimOnPause) aimCancel()
  }, [paused, cancelAimOnPause, aimCancel])
  return { ...controls, backgroundPaused, resume }
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

// Steps the clock in small slices until `done` holds, so a test can stop at the exact moment a
// randomized CPU delay lands instead of overshooting into the next step.
async function advanceUntil(done: () => boolean, maxMs = 5000) {
  for (let elapsed = 0; elapsed < maxMs && !done(); elapsed += 10) await advance(10)
}

// Each 10ms clock step is its own awaited act (testing-library 14 renders asynchronously), and a CPU
// windup can take a few hundred of them, so allow more than Jest's 5s default under a full parallel run.
jest.setTimeout(30000)

beforeEach(() => {
  jest.mocked(AppState.addEventListener).mockClear()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('pausing when the app leaves the foreground mid-match', () => {
  it('freezes a face-off countdown, keeps it frozen after the app comes back, and restarts the draw only on Resume', async () => {
    const { result } = await renderHook(useMatch, { initialProps: { tipoffMode: 'faceoff', aiPlayer: null, cancelAimOnPause: true } })
    await act(async () => {
      result.current.faceoffReady(1)
      result.current.faceoffReady(2)
    })
    await advance(FACEOFF_COUNTDOWN_STEP_MS)
    expect(result.current.state.faceoff).toMatchObject({ stage: 'countdown', count: 2 })
    const round = result.current.state.faceoffRound

    await act(async () => emitAppState('background'))
    expect(result.current.backgroundPaused).toBe(true)
    await advance(FACEOFF_COUNTDOWN_STEP_MS * 10)
    // Coming back doesn't lift the pause or touch the draw: the Paused dialog waits for Resume.
    await act(async () => emitAppState('active'))
    await advance(FACEOFF_COUNTDOWN_STEP_MS * 10)
    expect(result.current.backgroundPaused).toBe(true)
    expect(result.current.state.faceoff).toMatchObject({ stage: 'countdown', count: 2 })
    expect(result.current.state.faceoffRound).toBe(round)

    // Resume restarts the draw from the ready check, never mid-count.
    await act(async () => result.current.resume())
    expect(result.current.backgroundPaused).toBe(false)
    expect(result.current.state.faceoff).toMatchObject({ stage: 'ready', count: null })
    expect(result.current.state.faceoffRound).toBe(round + 1)
  })

  // Starts a vs-CPU coin-flip match with the CPU on whichever seat won the flip, and stops the clock
  // the moment the CPU commits to its windup (its release is still pending).
  async function startCpuWindup(cancelAimOnPause: boolean) {
    const { result, rerender } = await renderHook(useMatch, { initialProps: { tipoffMode: 'coinFlip', aiPlayer: null, cancelAimOnPause } })
    const aiPlayer = result.current.state.currentPlayer
    await rerender({ tipoffMode: 'coinFlip', aiPlayer, cancelAimOnPause })
    await act(async () => result.current.coinFlipDone())
    await advanceUntil(() => result.current.state.phase === 'aiming')
    expect(result.current.state.phase).toBe('aiming')
    return { result, setDialogOpen: async (dialogOpen: boolean) => rerender({ tipoffMode: 'coinFlip', aiPlayer, cancelAimOnPause, dialogOpen }) }
  }

  it('strands a CPU windup the pause interrupted in aiming if the aim is left alone', async () => {
    const { result } = await startCpuWindup(false)
    await act(async () => emitAppState('inactive'))
    await act(async () => emitAppState('active'))
    await act(async () => result.current.resume())
    await advance(5000)
    expect(result.current.state.phase).toBe('aiming')
  })

  it('drops a CPU windup the pause interrupted, so the CPU plans and takes a fresh shot after Resume', async () => {
    const { result } = await startCpuWindup(true)
    await act(async () => emitAppState('inactive'))
    expect(result.current.state.phase).toBe('idle')
    expect(result.current.state.aim).toBeNull()
    await act(async () => emitAppState('active'))
    await advance(5000)
    // Nothing moves until Resume.
    expect(result.current.state.phase).toBe('idle')

    await act(async () => result.current.resume())
    await advanceUntil(() => result.current.state.phase !== 'idle' && result.current.state.phase !== 'aiming')
    // A flick shot goes straight to 'simulating', a pull/push one through the 'striking' swing.
    expect(['striking', 'simulating']).toContain(result.current.state.phase)
  })

  it('drops a CPU windup a dialog opened over (desktop web), so the CPU takes a fresh shot once it closes', async () => {
    const { result, setDialogOpen } = await startCpuWindup(true)
    await setDialogOpen(true)
    expect(result.current.state.phase).toBe('idle')
    expect(result.current.state.aim).toBeNull()
    await advance(5000)
    // Nothing moves while the dialog is up.
    expect(result.current.state.phase).toBe('idle')

    await setDialogOpen(false)
    await advanceUntil(() => result.current.state.phase !== 'idle' && result.current.state.phase !== 'aiming')
    expect(['striking', 'simulating']).toContain(result.current.state.phase)
  })
})
