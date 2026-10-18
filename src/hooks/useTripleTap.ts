import { useEffect } from 'react'

import { TRIPLE_TAP_CLASH_WINDOW_MS, TRIPLE_TAP_TAPS } from '@/constants/game'
import { canTripleTap } from '@/hooks/useGameState'
import { GameState, Player } from '@/types'
import { AIDifficulty, planTripleTapSwipe, randomFaceoffReactionMs, randomTripleTapDragDurationMs } from '@/utils/aiOpponent'

interface TripleTapControls {
  tripleTapPress: (player: Player, atMs: number) => void
  tripleTapSwipe: (player: Player, dx: number, dy: number, vx: number, vy: number, atMs: number) => void
  tripleTapClashEnd: () => void
}

// Drives 'tripleTap'-mode timing (see TipoffMode's own doc comment in types/index.ts). A human
// player's own taps and swipe are dispatched directly by game.tsx's gesture handlers, never
// through this hook. Three jobs: the CPU seat's taps, kept in step with the human's (vsCpu only),
// the CPU's swipe once every tap is in, and closing the clash window after the first swipe.
//
// Pausing just halts the CPU timers (each effect depends on `paused`); resuming reschedules from
// the reducer's own state, which pausing never touches, so nothing needs a restart.
export function useTripleTap(state: GameState, aiPlayer: Player | null, difficulty: AIDifficulty, paused: boolean, controls: TripleTapControls): void {
  const { tripleTapPress, tripleTapSwipe, tripleTapClashEnd } = controls
  const tt = state.tripleTap
  const inDraw = state.phase === 'tripleTap' && tt !== null

  // ─── CPU taps ───────────────────────────────────────────────────────────────────────────────
  // Taps, after a reaction delay, whenever a tap would count (canTripleTap): keyed on both tap
  // counts, so the CPU waits on a human who's behind and follows one who's ahead, in step.
  const cpuCanTap = inDraw && aiPlayer !== null && canTripleTap(tt, aiPlayer)
  const cpuTaps = tt?.tapCount[aiPlayer === null ? 0 : aiPlayer - 1] ?? 0
  const humanTaps = tt?.tapCount[aiPlayer === 1 ? 1 : 0] ?? 0
  useEffect(() => {
    if (!cpuCanTap || aiPlayer === null || paused) return
    const timer = setTimeout(() => tripleTapPress(aiPlayer, Date.now()), randomFaceoffReactionMs(difficulty))
    return () => clearTimeout(timer)
  }, [cpuCanTap, cpuTaps, humanTaps, aiPlayer, difficulty, paused, state.tripleTapRound, tripleTapPress])

  // ─── CPU swipe ──────────────────────────────────────────────────────────────────────────────
  // Armed once both players have every tap in, and stays armed through the clash window if the
  // human swiped first (still a boolean `true`, so the timer isn't torn down by the launch). If
  // the timer lands after the window, the reducer ignores it.
  const cpuSwipeArmed = aiPlayer !== null && tt !== null && tt.swipe[aiPlayer - 1] === null && tt.tapCount[0] === TRIPLE_TAP_TAPS && tt.tapCount[1] === TRIPLE_TAP_TAPS && (state.phase === 'tripleTap' || tt.clashUntil !== null)
  useEffect(() => {
    if (!cpuSwipeArmed || aiPlayer === null || paused) return
    const timer = setTimeout(
      () => {
        const { dx, dy, vx, vy } = planTripleTapSwipe(aiPlayer, difficulty)
        tripleTapSwipe(aiPlayer, dx, dy, vx, vy, Date.now())
      },
      randomFaceoffReactionMs(difficulty) + randomTripleTapDragDurationMs()
    )
    return () => clearTimeout(timer)
  }, [cpuSwipeArmed, aiPlayer, difficulty, paused, state.tripleTapRound, tripleTapSwipe])

  // ─── Clash window → done ────────────────────────────────────────────────────────────────────
  // Once the puck's launched, drop the draw's leftover state after the window (a clash already
  // landed or not), so the trailing player's half stops catching touches meant for an intercept.
  const launched = tt !== null && state.phase !== 'tripleTap'
  useEffect(() => {
    if (!launched) return
    const timer = setTimeout(tripleTapClashEnd, TRIPLE_TAP_CLASH_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [launched, tripleTapClashEnd])
}
