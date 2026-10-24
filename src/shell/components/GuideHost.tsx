import { useIsTouchPrimaryDevice, useRotation } from '@tastic/core'
import { GuideProvider, useGuide } from '@tastic/hud/guide'
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { shallowEqual, useDispatch, useSelector, useStore } from 'react-redux'

import { usePack } from '@/shell/PackContext'
import type { ShellState } from '@/shell/redux/shellState'
import { roundModeFor, type SeatTwo } from '@/shell/types'

interface GameGuideContextValue {
  // Shows a game's How to Play cards if this player hasn't finished or skipped this version yet,
  // then runs `next` once they close; runs `next` at once otherwise. Home calls it on a tile tap, so
  // a game's cards show the first time it's picked, before its loadout opens.
  openFirstTime: (gameId: string, next: () => void) => void
  // Shows a game's cards now, seen or not (a tile's rules button, a loadout's How to Play row).
  openFor: (gameId: string) => void
}

const GameGuideContext = createContext<GameGuideContextValue | null>(null)

// The seat-2 choice the cards describe: the one the player last picked, or the CPU in a game that
// has no room for it (a saved 'nobody' in a game without a solo mode).
function seatTwoIn(seatTwo: SeatTwo, choices: readonly SeatTwo[]): SeatTwo {
  return choices.includes(seatTwo) ? seatTwo : 'cpu'
}

interface Props {
  children: ReactNode
}

// One @tastic/hud GuideProvider for the whole pack, showing whichever game's cards were asked for
// last. Each game's cards come from its own registry entry (GameDefinition.guide), built from the
// live settings and seat 2 so a replay after any loadout change describes the next match. Mounted
// around the stack in RootLayout, inside the toast provider and OrientationBridge because the card
// renders through a Portal and turns with the shared reading (`rotation`, the same one Home hands
// its Settings dialog), and inside the profiles gate so it mounts together with Home.
export function GuideHost({ children }: Props) {
  const pack = usePack()
  const [gameId, setGameId] = useState(pack.games[0].id)
  const game = pack.games.find((g) => g.id === gameId) ?? pack.games[0]

  const rotation = useRotation()
  const touch = useIsTouchPrimaryDevice()
  const seatTwo = useSelector((state: ShellState) => state.opponent.seatTwo)
  const input = useSelector((state: ShellState) => game.guide.selectInput(state), shallowEqual)
  const seenVersion = useSelector((state: ShellState) => game.guide.selectVersionSeen(state))
  const dispatch = useDispatch()

  const mode = roundModeFor(seatTwoIn(seatTwo, game.seatTwo))
  const steps = useMemo(() => game.guide.getSteps(input, { touch, mode }), [game, input, touch, mode])
  const onSeen = useCallback((version: number) => dispatch(game.guide.markSeen(version)), [dispatch, game])

  return (
    <GuideProvider steps={steps} currentVersion={game.guide.version} seenVersion={seenVersion} onSeen={onSeen} rotation={rotation}>
      <GameGuideBridge onPick={setGameId}>{children}</GameGuideBridge>
    </GuideProvider>
  )
}

// Inside GuideProvider, so it can open the dialog and watch it close.
function GameGuideBridge({ onPick, children }: { onPick: (gameId: string) => void; children: ReactNode }) {
  const pack = usePack()
  const store = useStore<ShellState>()
  const { isOpen, open } = useGuide()
  const pendingNext = useRef<(() => void) | null>(null)
  const wasOpen = useRef(false)

  // When cards opened by openFirstTime close (finished, skipped or dismissed), carry on to where the
  // tap was going.
  useEffect(() => {
    if (wasOpen.current && !isOpen && pendingNext.current) {
      const next = pendingNext.current
      pendingNext.current = null
      next()
    }
    wasOpen.current = isOpen
  }, [isOpen])

  const openFor = useCallback(
    (gameId: string) => {
      onPick(gameId)
      open()
    },
    [onPick, open]
  )

  const openFirstTime = useCallback(
    (gameId: string, next: () => void) => {
      const game = pack.games.find((g) => g.id === gameId)
      if (!game || game.guide.selectVersionSeen(store.getState()) >= game.guide.version) {
        next()
        return
      }
      pendingNext.current = next
      openFor(gameId)
    },
    [pack, store, openFor]
  )

  const value = useMemo(() => ({ openFirstTime, openFor }), [openFirstTime, openFor])
  return <GameGuideContext.Provider value={value}>{children}</GameGuideContext.Provider>
}

export function useGameGuide(): GameGuideContextValue {
  const ctx = useContext(GameGuideContext)
  if (!ctx) throw new Error('useGameGuide must be used within a GuideHost')
  return ctx
}
