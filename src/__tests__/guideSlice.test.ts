import { GUIDE_VERSION } from '@/games/boxhockey/constants/guide'
import reducer, { guideActions, selectGuideVersionSeen } from '@/games/boxhockey/redux/guideSlice'

const REHYDRATE = 'persist/REHYDRATE'

// Box Hockey's How to Play state, under its own key like every game's (shell/redux/gameGuideSlice.ts).
describe("Box Hockey's guide slice", () => {
  it('starts a fresh install as never seen, so the cards show on the first tap of the game', () => {
    expect(reducer(undefined, { type: REHYDRATE, payload: undefined }).versionSeen).toBe(0)
  })

  it('reads a saved store without its key as never seen', () => {
    expect(reducer(undefined, { type: REHYDRATE, payload: { theme: {}, profiles: {} } }).versionSeen).toBe(0)
  })

  it('keeps a version this player already finished or skipped, saved under boxhockeyGuide', () => {
    expect(reducer(undefined, { type: REHYDRATE, payload: { boxhockeyGuide: { versionSeen: GUIDE_VERSION } } }).versionSeen).toBe(GUIDE_VERSION)
  })

  it('ignores 1.0 guide state saved under the old `guide` key', () => {
    expect(reducer(undefined, { type: REHYDRATE, payload: { guide: { versionSeen: GUIDE_VERSION } } }).versionSeen).toBe(0)
  })

  it('records the version on finish or skip, and reads it back from the root state', () => {
    const state = reducer(undefined, guideActions.markSeen(GUIDE_VERSION))

    expect(state.versionSeen).toBe(GUIDE_VERSION)
    expect(selectGuideVersionSeen({ boxhockeyGuide: state })).toBe(GUIDE_VERSION)
  })
})
