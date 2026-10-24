import type { Action } from 'redux'

const REHYDRATE = 'persist/REHYDRATE'

export interface GameGuideState {
  versionSeen: number
}

// Which version of one game's How to Play cards this player has finished or skipped, under the
// game's own store key. Unlike @tastic/hud's createGuideSlice, a saved store without this key reads
// as "not seen": a game added to a pack in an update is new to everyone, so its cards show on the
// first tap of its tile even for a player who has had the pack for months. (createGuideSlice reads
// the missing key as a returning player and stamps it seen, which is right only for a guide that
// ships with the app's first store.)
export function createGameGuideSlice(mountKey: string) {
  const MARK_SEEN = `${mountKey}/markSeen`
  const initialState: GameGuideState = { versionSeen: 0 }

  function markSeen(version: number) {
    return { type: MARK_SEEN, payload: version }
  }

  function reducer(state: GameGuideState = initialState, action: Action & { payload?: unknown }): GameGuideState {
    if (action.type === REHYDRATE) {
      const persisted = (action.payload as Record<string, { versionSeen?: unknown } | undefined> | undefined)?.[mountKey]
      return typeof persisted?.versionSeen === 'number' ? { versionSeen: persisted.versionSeen } : state
    }
    if (action.type === MARK_SEEN && typeof action.payload === 'number') {
      return { versionSeen: Math.max(state.versionSeen, action.payload) }
    }
    return state
  }

  function selectVersionSeen(rootState: object): number {
    return (rootState as Record<string, GameGuideState | undefined>)[mountKey]?.versionSeen ?? 0
  }

  return { actions: { markSeen }, reducer, selectVersionSeen }
}
