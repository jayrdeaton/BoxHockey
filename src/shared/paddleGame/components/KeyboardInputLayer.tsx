import { Direction } from '@tastic/input'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import { resolveControlSchemeDirection } from '@/shared/controlScheme'
import { MAX_PADDLE_SPEED } from '@/shared/paddleGame/constants/game'
import { ControlScheme, Player } from '@/shared/paddleGame/types'

export interface KeyboardInputLayerProps {
  enabled: boolean
  humanPlayers: Player[]
  controlScheme: Record<Player, ControlScheme>
  // Each player's CURRENT paddle Y, read fresh every frame (via the ref below) as the baseline a
  // held key nudges from - NOT a live prop this component reacts to render-to-render, the same way
  // TouchInputLayer's own onPaddleTargetY calls never wait for a render either.
  paddleY: Record<Player, number>
  onPaddleTargetY: (player: Player, y: number) => void
}

// Web-only, and purely additive on top of TouchInputLayer's own always-on drag input - never
// disables it, same "scheme only ever ADDS a key mapping, never removes the pointer path" principle
// Snake's identically-named component documents. A seat left on 'mouse' (the default, see
// redux/settingsSlice.ts) is simply never read from below.
//
// Structurally different from Snake's/LightCycles' own KeyboardInputLayer despite the shared name:
// those resolve one keydown into one DISCRETE turn: Pong's paddle instead needs CONTINUOUS motion
// for as long as a direction key stays HELD, since it's a drag-to-position paddle, not a turn-and-
// commit snake. So this tracks a live held-key SET per player (keydown adds, keyup removes) and
// drives it through its OWN plain requestAnimationFrame loop (deliberately NOT @tastic/core's
// useGameLoop - this component's rAF callback needs the CURRENT paddle position and held-key set on
// every frame regardless of React's own render/effect cadence, and a bare rAF loop reading straight
// from refs is the simplest way to guarantee that; nothing here depends on useGameLoop's specific
// dt-smoothing beyond what computeClampedDt itself does, which the local nowMs-delta math below
// mirrors directly). Same nominal-frame-normalized `dt` convention useGameState's own tick loop uses
// (dt ≈ 1 for a normal ~16.7ms frame), so MAX_PADDLE_SPEED (a px-per-nominal-frame constant) means
// the same thing here as it does there - computing a fresh target Y every frame from the paddle's
// own current Y rather than the touch model's "finger position IS the target" mapping. This loop and
// useGameState's own tick loop are independent (uncorrelated rAF callbacks, same as touch's own
// async gesture stream already is relative to the physics tick), which is fine: onPaddleTargetY is a
// plain ref write, read once per *its own* frame, regardless of which source last wrote it.
//
// Deliberately NOT rotation-aware (unlike TouchInputLayer's screenToLocalY): a Pong paddle has
// exactly one degree of freedom (local Y), so there is no *other* local axis "real screen up" could
// ever be remapped onto if the board happens to be visually rotated (narrow-window faceToFace on
// web) - inverting the mapping there would only ever trade "moves, just rotated-feeling" for "dead
// keys", never an actual fix. Up/Down always drive local Y directly. Also not a realistic scenario
// to over-invest in: a shared *keyboard* (unlike a shared touchscreen) has no "far seat" a second
// player could physically reach from the opposite side of the device, so a keyboard scheme is
// really only ever used seated side by side - where Pong's board is unrotated anyway.
const NOMINAL_FRAME_MS = 1000 / 60
const MAX_DT = 2.5

export default function KeyboardInputLayer({ enabled, humanPlayers, controlScheme, paddleY, onPaddleTargetY }: KeyboardInputLayerProps) {
  const heldRef = useRef<Record<Player, Set<Direction>>>({ 1: new Set(), 2: new Set() })
  const latestRef = useRef({ humanPlayers, controlScheme, paddleY, onPaddleTargetY })
  useEffect(() => {
    latestRef.current = { humanPlayers, controlScheme, paddleY, onPaddleTargetY }
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

      const { humanPlayers, controlScheme, paddleY, onPaddleTargetY } = latestRef.current
      for (const player of humanPlayers) {
        if (controlScheme[player] === 'mouse') continue
        const held = heldRef.current[player]
        const axisY = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)
        if (axisY === 0) continue
        onPaddleTargetY(player, paddleY[player] + axisY * MAX_PADDLE_SPEED * dt)
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
