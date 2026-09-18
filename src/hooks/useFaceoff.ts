import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { FACEOFF_COUNTDOWN_STEP_MS, FACEOFF_HOLD_MAX_MS, FACEOFF_HOLD_MIN_MS, FACEOFF_TAP_TIMEOUT_MS } from '@/constants/game'
import { BoardLayout, GameState, Player } from '@/types'
import { AIDifficulty, randomFaceoffReactionMs, rollFaceoffWrongZone } from '@/utils/aiOpponent'
import { computeFaceoffKnock } from '@/utils/faceoff'

interface FaceoffControls {
  faceoffCount: (count: 2 | 1) => void
  faceoffHold: (goAt: number) => void
  faceoffLive: () => void
  faceoffReady: (player: Player) => void
  faceoffTap: (player: Player, atMs: number, zoneIndex: 0 | 1) => void
  faceoffTimeout: (player: Player) => void
  faceoffLaunch: (vx: number, vy: number) => void
  faceoffRestart: () => void
}

// Drives all 'faceoff'-mode timing (countdown, hold, live window, CPU reaction, human timeout,
// and the resolved-to-knock handoff) by dispatching through the plain callbacks above — no
// reducer or physics changes needed beyond what useGameState.ts already exposes, the same
// "controls object driven by a timer chain" shape useAIOpponent.ts uses for CPU shots. 'coinFlip'
// mode needs no timing at all — it's resolved synchronously inside the reducer itself (see
// useGameState.ts's RESET/NEXT_ROUND cases), so this hook has nothing to do for it. `paused`
// (settings/quit-confirm dialog open — see game.tsx) halts every timer below and restarts the
// current draw once it clears (see the pause-resume effect near the bottom).
export function useFaceoff(state: GameState, board: BoardLayout, aiPlayer: Player | null, difficulty: AIDifficulty, paused: boolean, controls: FaceoffControls): void {
  const { faceoffCount, faceoffHold, faceoffLive, faceoffReady, faceoffTap, faceoffTimeout, faceoffLaunch, faceoffRestart } = controls

  // Mirrors game.tsx's puckRef pattern — the timeout-check timer below fires long after this
  // effect's own closure was created, so it needs a way to read live tapAt rather than a stale
  // snapshot from when the countdown started.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  // True only on the game's first draw, before both players have signaled ready (see
  // FaceoffState's doc comment in types/index.ts) — a primitive boolean rather than the whole
  // `faceoff` object, so it only flips the two effects below when readiness itself actually
  // changes, not on every ordinary sub-action.
  const isReadyStage = state.faceoff?.stage === 'ready'

  // ─── CPU auto-ready ────────────────────────────────────────────────────────────────────────
  // The CPU can't tap a "ready" zone the way a human does — it just signals ready on its own
  // after a short beat, so a vs-CPU game's first draw doesn't hang forever waiting for a press
  // that will never come.
  useEffect(() => {
    if (state.phase !== 'faceoff' || !isReadyStage || aiPlayer === null || paused) return
    const t = setTimeout(() => faceoffReady(aiPlayer), 300 + Math.random() * 300)
    return () => clearTimeout(t)
  }, [state.phase, state.faceoffRound, isReadyStage, aiPlayer, faceoffReady, paused])

  // ─── Countdown → hold → live → (CPU tap / human timeout) ─────────────────────────────────────
  // Keyed on faceoffRound rather than `state.faceoff` itself: the latter is a new object on every
  // sub-action (each count tick, each tap), which would tear down and restart this whole chain
  // mid-flight. faceoffRound only bumps when a genuinely new draw begins (game start, post-goal
  // restart, or an app-backgrounding recovery — see the AppState effect below), so this effect
  // runs exactly once per draw. Also gated on !isReadyStage — on the game's first draw the
  // countdown must not start until FACEOFF_READY has flipped stage away from 'ready' (see
  // useGameState.ts), and isReadyStage flipping false is exactly what re-runs this effect at that
  // point, picking the chain up from a stage that's already 'countdown' with count reset to 3.
  // Also gated on `paused`: cancels every pending timer in this chain (cleanup below) rather than
  // letting the countdown/hold/live window tick, resolve, or forfeit unseen behind a dialog. See
  // the pause-resume effect further down for what happens when the dialog closes mid-draw.
  useEffect(() => {
    if (state.phase !== 'faceoff' || isReadyStage || paused) return

    const timers: ReturnType<typeof setTimeout>[] = []
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms))
    }

    after(FACEOFF_COUNTDOWN_STEP_MS, () => faceoffCount(2))
    after(FACEOFF_COUNTDOWN_STEP_MS * 2, () => faceoffCount(1))
    after(FACEOFF_COUNTDOWN_STEP_MS * 3, () => {
      const holdMs = FACEOFF_HOLD_MIN_MS + Math.random() * (FACEOFF_HOLD_MAX_MS - FACEOFF_HOLD_MIN_MS)
      const goAt = Date.now() + holdMs
      faceoffHold(goAt)

      after(holdMs, () => {
        faceoffLive()

        // The CPU doesn't get to "watch" the flash any more reliably than a human does — see
        // rollFaceoffWrongZone in aiOpponent.ts: Easy has a real chance of pressing the dot that
        // never colored, forfeiting exactly like a human who reacts to the wrong one. Reaction
        // *time* is still the separate axis below.
        if (aiPlayer !== null && state.faceoff) {
          const correctZone = state.faceoff.zones[aiPlayer - 1]
          const zoneIndex: 0 | 1 = rollFaceoffWrongZone(difficulty) ? (correctZone === 0 ? 1 : 0) : correctZone
          after(randomFaceoffReactionMs(difficulty), () => faceoffTap(aiPlayer, Date.now(), zoneIndex))
        }

        after(FACEOFF_TAP_TIMEOUT_MS, () => {
          const fo = stateRef.current.faceoff
          if (!fo || fo.stage === 'resolved') return
          if (fo.tapAt[0] === null) faceoffTimeout(1)
          else if (fo.tapAt[1] === null) faceoffTimeout(2)
        })
      })
    })

    return () => timers.forEach(clearTimeout)
    // state.faceoff is deliberately omitted: it's a new object on every sub-action (each count
    // tick, tap), and this effect is keyed on faceoffRound specifically so those sub-actions don't
    // tear down and reschedule the whole chain mid-flight (see this effect's own comment above).
    // The single state.faceoff read inside (line 87, for the CPU's correctZone) closes over the
    // value from the render that started this draw; zones don't change again until the next draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.faceoffRound, isReadyStage, aiPlayer, difficulty, faceoffCount, faceoffHold, faceoffLive, faceoffTap, faceoffTimeout, paused])

  // ─── Resolved → knock ──────────────────────────────────────────────────────────────────────
  // No announcement, no pause — the draw resolving launches the knock on the very next tick; the
  // puck's own movement is the only signal of who won (see game.tsx/Board.tsx's press-target
  // color flip). The loser always gets the next real turn off of it, hit or miss (see
  // FACEOFF_LAUNCH's own comment in useGameState.ts) — the knock itself is the winner's entire
  // reward for the draw.
  const result = state.faceoff?.result
  useEffect(() => {
    if (state.phase !== 'faceoff' || state.faceoff?.stage !== 'resolved' || !result) return
    const knock = computeFaceoffKnock(board, result.winner, result.marginMs, result.reactionMs)
    faceoffLaunch(knock.vx, knock.vy)
  }, [state.phase, state.faceoff?.stage, result, board, faceoffLaunch])

  // ─── Pause (settings/quit-confirm dialog) recovery ────────────────────────────────────────
  // Mirrors the backgrounding recovery below: the countdown-chain effect above already halts
  // while paused, but a suspended setTimeout chain can't be trusted to resume with correct
  // relative timing once the dialog closes, so restart the current draw from scratch instead of
  // trying to pick the old timers back up. Skipped while still in 'ready' (nothing was running to
  // interrupt — a dialog can't even open mid-drag/mid-press since it captures the whole screen)
  // and while 'resolved' (unreachable during a pause anyway, since the chain that would resolve it
  // never runs while paused).
  const prevPausedRef = useRef(paused)
  useEffect(() => {
    const wasPaused = prevPausedRef.current
    prevPausedRef.current = paused
    if (!wasPaused || paused) return
    const fo = stateRef.current.faceoff
    if (stateRef.current.phase === 'faceoff' && fo && fo.stage !== 'ready' && fo.stage !== 'resolved') faceoffRestart()
  }, [paused, faceoffRestart])

  // ─── Backgrounding recovery ────────────────────────────────────────────────────────────────
  // The screen stays mounted while backgrounded, so the unmount-cleanup above doesn't help here —
  // a suspended setTimeout chain resumes with no reliable relationship to real elapsed time (it
  // may fire in a burst, or with the human timeout landing the instant the app comes back
  // regardless of how long it was actually gone), which would wreck a millisecond-sensitive race.
  // Simplest reliable fix: just restart the current draw from scratch on return to foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      const fo = stateRef.current.faceoff
      if (stateRef.current.phase === 'faceoff' && fo && fo.stage !== 'resolved') faceoffRestart()
    })
    return () => sub.remove()
  }, [faceoffRestart])
}
