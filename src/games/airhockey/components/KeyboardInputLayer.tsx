import { Direction } from '@tastic/input'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import { MAX_PADDLE_SPEED } from '@/games/airhockey/constants/game'
import { ControlScheme, Player } from '@/games/airhockey/types'
import { resolveControlSchemeDirection } from '@/shared/controlScheme'

export interface KeyboardInputLayerProps {
  enabled: boolean
  humanPlayers: Player[]
  controlScheme: Record<Player, ControlScheme>
  // Each player's CURRENT paddle position, read fresh every frame (via the ref below) as the
  // baseline held keys nudge from - NOT a live prop this component reacts to render-to-render, the
  // same way TouchInputLayer's own onPaddleTarget calls never wait for a render either.
  paddlePos: Record<Player, { x: number; y: number }>
  onPaddleTarget: (player: Player, x: number, y: number) => void
}

// Web-only, and purely additive on top of TouchInputLayer's own always-on drag input - never
// disables it, same "scheme only ever ADDS a key mapping, never removes the pointer path" principle
// Snake's identically-named component documents. A seat left on 'mouse' (the default, see
// redux/settingsSlice.ts) is simply never read from below.
//
// Structurally different from Snake's/LightCycles' own KeyboardInputLayer despite the shared name:
// those resolve one keydown into one DISCRETE turn; a mallet instead needs CONTINUOUS motion for as
// long as a direction key stays HELD, since it's a drag-to-position paddle, not a turn-and-commit
// snake. So this tracks a live held-key SET per player (keydown adds, keyup removes) and drives it
// through its OWN plain requestAnimationFrame loop - deliberately NOT @tastic/core's useGameLoop,
// which (confirmed directly against Pong's identically-shaped component, in the browser, not just in
// theory) silently never ticks when a SECOND independent caller mounts it alongside useGameState's
// own internal one in the same tree; a bare rAF loop reading straight from refs sidesteps whatever
// that interaction is. Same nominal-frame-normalized `dt` convention useGameState's own tick loop
// uses (dt ≈ 1 for a normal ~16.7ms frame), so MAX_PADDLE_SPEED (a px-per-nominal-frame constant)
// means the same thing here as it does there - computing a fresh target position every frame from
// the paddle's own current position rather than the touch model's "finger position IS the target"
// mapping. This loop and useGameState's own tick loop are independent (uncorrelated rAF callbacks,
// same as touch's own async gesture stream already is relative to the physics tick), which is fine:
// onPaddleTarget is a plain ref write, read once per *its own* frame, regardless of which source
// last wrote it.
//
// Up/Down/Left/Right always drive local Y-/Y+/X-/X+ directly - the SAME absolute direction for
// BOTH seats, never flipped per player's own facing/goal side (player 1 defends local bottom,
// player 2 local top - see GoalSide's own doc comment in types/index.ts). This is deliberate, not
// an oversight: two people sharing one keyboard sit side by side looking at the SAME (possibly
// board-rotated) screen, so "up" reads the same physical way to both of them, exactly like any
// other shared-screen local-multiplayer game's screen-relative controls - there is no sense in
// which player 2's "up" should mean something different from player 1's "up" on the one screen
// they're both looking at. A held diagonal (e.g. Up+Left together) is normalized to the same speed
// as a single axis - otherwise it would cover sqrt(2)x the distance per frame.
//
// Deliberately NOT rotation-aware (unlike TouchInputLayer's screenToLocal): unlike Pong's paddle
// (a single degree of freedom), a mallet genuinely has both local axes to move on, so a rotation-
// aware remap IS geometrically possible here - but still skipped, for the same ergonomic reason
// Pong's own KeyboardInputLayer skips it: a shared keyboard has no "far seat" a second player could
// physically reach from the opposite side of the device, so this only really gets used seated side
// by side, and the local-axis mapping above already reads correctly there without any inversion.
const NOMINAL_FRAME_MS = 1000 / 60
const MAX_DT = 2.5
const DIAGONAL_SCALE = Math.SQRT1_2

export default function KeyboardInputLayer({ enabled, humanPlayers, controlScheme, paddlePos, onPaddleTarget }: KeyboardInputLayerProps) {
  const heldRef = useRef<Record<Player, Set<Direction>>>({ 1: new Set(), 2: new Set() })
  const latestRef = useRef({ humanPlayers, controlScheme, paddlePos, onPaddleTarget })
  useEffect(() => {
    latestRef.current = { humanPlayers, controlScheme, paddlePos, onPaddleTarget }
  })

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web') return

    // Captured once - heldRef.current's own identity never actually changes after the useRef
    // initializer (only the Sets it points at are mutated in place, via .add/.delete/.clear), but
    // this is what lets the cleanup below reference it without the linter having to take that on
    // faith.
    const held = heldRef.current

    const handleKeyDown = (e: KeyboardEvent) => {
      const { humanPlayers, controlScheme } = latestRef.current
      for (const player of humanPlayers) {
        const direction = resolveControlSchemeDirection(e, controlScheme[player])
        if (!direction) continue
        e.preventDefault()
        held[player].add(direction)
        return
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const { humanPlayers, controlScheme } = latestRef.current
      for (const player of humanPlayers) {
        const direction = resolveControlSchemeDirection(e, controlScheme[player])
        if (!direction) continue
        held[player].delete(direction)
        return
      }
    }

    // A held key's release never reaches us if focus leaves the page first (alt-tab, a devtools
    // click, ...) - window never gets the keyup at all. Left unhandled, that key would read as
    // "held" forever, driving the paddle in one direction with no way to stop it short of pressing
    // and releasing that exact key again. Clearing on blur is the standard fix for this whole class
    // of held-key bug.
    const handleBlur = () => {
      held[1].clear()
      held[2].clear()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      held[1].clear()
      held[2].clear()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web') return

    let rafId: number | null = null
    let active = true
    let lastTimestamp: number | null = null

    const step = (timestamp: number) => {
      if (!active) return
      const dt = lastTimestamp === null ? 1 : Math.min(MAX_DT, Math.max(0, (timestamp - lastTimestamp) / NOMINAL_FRAME_MS))
      lastTimestamp = timestamp

      const { humanPlayers, controlScheme, paddlePos, onPaddleTarget } = latestRef.current
      for (const player of humanPlayers) {
        if (controlScheme[player] === 'mouse') continue
        const held = heldRef.current[player]
        let axisX = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
        let axisY = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)
        if (axisX === 0 && axisY === 0) continue
        if (axisX !== 0 && axisY !== 0) {
          axisX *= DIAGONAL_SCALE
          axisY *= DIAGONAL_SCALE
        }
        const pos = paddlePos[player]
        onPaddleTarget(player, pos.x + axisX * MAX_PADDLE_SPEED * dt, pos.y + axisY * MAX_PADDLE_SPEED * dt)
      }

      rafId = requestAnimationFrame(step)
    }

    rafId = requestAnimationFrame(step)
    return () => {
      active = false
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [enabled])

  return null
}
