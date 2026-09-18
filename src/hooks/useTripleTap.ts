import { useEffect, useRef } from 'react'

import { BoardLayout, GameState, Player } from '@/types'
import { AIDifficulty, planTripleTapSwipe, randomFaceoffReactionMs, randomTripleTapDragDurationMs } from '@/utils/aiOpponent'

interface TripleTapControls {
  tripleTapPress: (player: Player, atMs: number) => void
  tripleTapSwipeStart: (player: Player, atMs: number) => void
  tripleTapSwipeEnd: (player: Player, dx: number, dy: number) => void
  tripleTapLaunch: (vx: number, vy: number) => void
}

// Drives 'tripleTap'-mode timing — dramatically simpler than useFaceoff.ts, since this mode has no
// shared countdown/hold/live gate and no timeout (see TipoffMode's own doc comment in
// types/index.ts): a human player's own taps/swipe are dispatched directly by game.tsx's gesture
// handlers, never through this hook. Just two jobs: simulate the CPU seat's own tap-tap-swipe
// sequence (vsCpu only), and fire the launch the instant both players' swipes are in.
//
// No restart/recovery effect (unlike useFaceoff.ts's pause/backgrounding handling): there's no
// in-flight HUMAN timer chain a pause could corrupt — a settings/quit-confirm dialog captures the
// whole screen, so a drag can't survive across it anyway, and a player's own tapCount/swipe
// progress lives in reducer state, untouched by pausing. The only timer here is the CPU chain
// below, which just needs to halt while paused (see its own dependency on `paused`) — resuming
// simply restarts the CPU's own sequence from scratch, which is unobservable to a human opponent
// and self-heals against a mid-sequence pause via the reducer's own idempotency guards (a replayed
// TRIPLE_TAP_PRESS past tapCount 2, or a replayed TRIPLE_TAP_SWIPE_START once already started, is
// simply a no-op — see useGameState.ts's own cases).
export function useTripleTap(state: GameState, board: BoardLayout, aiPlayer: Player | null, difficulty: AIDifficulty, paused: boolean, controls: TripleTapControls): void {
  const { tripleTapPress, tripleTapSwipeStart, tripleTapSwipeEnd, tripleTapLaunch } = controls

  // Mirrors useGameState.ts's own boardRef pattern — `board` is a fresh object on many renders
  // (useSafeAreaInsets doesn't guarantee a stable reference even when the actual inset VALUES are
  // unchanged), so depending on it directly in the timer-chain effect below would tear the whole
  // chain down and restart it on every one of those renders, never giving any setTimeout a real
  // chance to fire — exactly the class of bug faceoffRef/tripleTapRef/boardRef elsewhere in this
  // app exist to avoid. Read via ref instead, kept out of that effect's own dependency array.
  const boardRef = useRef(board)
  useEffect(() => {
    boardRef.current = board
  })

  // ─── CPU tap/swipe simulation ──────────────────────────────────────────────────────────────
  // Keyed on tripleTapRound (not `state.tripleTap` itself, which is a new object on every
  // sub-action) — same discipline as useFaceoff.ts's own countdown-chain effect, so a human
  // player's own presses landing mid-sequence don't tear down and restart this timer chain.
  useEffect(() => {
    if (state.phase !== 'tripleTap' || aiPlayer === null || paused) return
    const timers: ReturnType<typeof setTimeout>[] = []
    let cumulativeMs = 0
    const after = (ms: number, fn: () => void) => {
      cumulativeMs += ms
      timers.push(setTimeout(fn, cumulativeMs))
    }
    after(randomFaceoffReactionMs(difficulty), () => tripleTapPress(aiPlayer, Date.now()))
    after(randomFaceoffReactionMs(difficulty), () => tripleTapPress(aiPlayer, Date.now()))
    after(randomFaceoffReactionMs(difficulty), () => tripleTapSwipeStart(aiPlayer, Date.now()))
    after(randomTripleTapDragDurationMs(), () => {
      const { dx, dy } = planTripleTapSwipe(boardRef.current, aiPlayer, difficulty)
      tripleTapSwipeEnd(aiPlayer, dx, dy)
    })
    return () => timers.forEach(clearTimeout)
    // board is deliberately omitted — see boardRef's own comment above.
  }, [state.phase, state.tripleTapRound, aiPlayer, difficulty, paused, tripleTapPress, tripleTapSwipeStart, tripleTapSwipeEnd])

  // ─── Resolved → launch ──────────────────────────────────────────────────────────────────────
  // No announcement, no pause — same "the puck's own movement is the only signal" treatment
  // useFaceoff.ts's own resolved-to-knock effect uses. TRIPLE_TAP_SWIPE_END already computes the
  // final combined vector inline (see useGameState.ts), so this is just the dispatch.
  const result = state.tripleTap?.result
  useEffect(() => {
    if (state.phase !== 'tripleTap' || !result) return
    tripleTapLaunch(result.vx, result.vy)
  }, [state.phase, result, tripleTapLaunch])
}
