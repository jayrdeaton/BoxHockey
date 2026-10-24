import { useSelector } from 'react-redux'

import type { ShellState } from '@/shell/redux/shellState'
import type { RoundMode } from '@/shell/types'

// The round a play screen is playing: committed by the loadout when every human player readied up
// (see liveplaySlice.ts). A play screen reached without one (a direct link, a web reload) plays its
// game's defaults against the CPU.
export function useActiveRound<S extends object>(game: string, defaults: S): { mode: RoundMode; settings: S } {
  const round = useSelector((state: ShellState) => state.liveplay.activeRound)
  if (!round || round.game !== game) return { mode: 'vsCpu', settings: defaults }
  return { mode: round.mode, settings: { ...defaults, ...(round.settings as Partial<S>) } }
}
