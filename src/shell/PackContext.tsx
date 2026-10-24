import { createContext, ReactNode, useContext } from 'react'

import type { GameDefinition, PackDefinition } from '@/shell/types'

// The pack the shell is running: handed in once at the root (see RootLayout), so nothing in shell/
// ever imports pack.ts or a game. Games reach the shell only through this registry.
const PackContext = createContext<PackDefinition | null>(null)

export function PackProvider({ pack, children }: { pack: PackDefinition; children: ReactNode }) {
  return <PackContext.Provider value={pack}>{children}</PackContext.Provider>
}

export function usePack(): PackDefinition {
  const pack = useContext(PackContext)
  if (!pack) throw new Error('usePack must be used within a PackProvider')
  return pack
}

// A game by id, or undefined for an id the pack doesn't have (a stale link).
export function usePackGame(id: string | undefined): GameDefinition | undefined {
  return usePack().games.find((g) => g.id === id)
}
