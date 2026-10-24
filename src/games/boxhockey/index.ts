import { ControlScheme, TipoffMode } from '@/games/boxhockey/types'
import type { GameDefinition } from '@/shell/types'

import { GUIDE_VERSION } from './constants/guide'
import { getGuideSteps } from './constants/guideSteps'
import { achievementsActions, achievementsReducer as achievements, GameStatsProvider } from './hooks/useGameStats'
import PlayScreen from './PlayScreen'
import guide, { guideActions, selectGuideVersionSeen } from './redux/guideSlice'
import { playerSettings } from './redux/settingsSlice'
import { AchievementList, StatsSections } from './StatsSections'
import { useLoadout } from './useLoadout'

// What Box Hockey's How to Play cards are built from (see getGuideSteps), flat so the guide's
// shallow compare sees no change while none of them change.
interface GuideInput {
  control1: ControlScheme
  control2: ControlScheme
  tipoff: TipoffMode
  scoreToWin: number
}

// Box Hockey, the pack's first game and the one BoxHockey 1.0 shipped as. Its store keys are its own
// (boxhockeySettings, boxhockeyControls, boxhockeyAchievements, boxhockeyGuide), like every game's.
// A 1.0 save is imported once (importBoxHockey1.ts).
export const boxHockey: GameDefinition = {
  id: 'boxhockey',
  title: 'Box Hockey',
  blurb: 'The classic wooden table game. Take turns shooting.',
  // The pack's own app icon is Box Hockey's, so its tile uses the app icon files.
  icon: { light: require('../../../assets/images/icon-light.png'), dark: require('../../../assets/images/icon-dark.png') },
  seatTwo: ['cpu', 'person'],
  // The board never turns a quarter turn, only flips upside down, on every platform.
  twoPlayerSeats: { faceToFaceOnWeb: true, followUpsideDown: true },
  reducers: { ...playerSettings.reducers, boxhockeyAchievements: achievements, boxhockeyGuide: guide },
  Provider: GameStatsProvider,
  useLoadout,
  PlayScreen,
  StatsSections,
  AchievementList,
  resetStats: achievementsActions.reset,
  guide: {
    version: GUIDE_VERSION,
    selectVersionSeen: (state) => selectGuideVersionSeen(state),
    markSeen: guideActions.markSeen,
    selectInput: (state): GuideInput => {
      const s = playerSettings.select(state)
      return { control1: s.controlScheme[1], control2: s.controlScheme[2], tipoff: s.tipoffMode, scoreToWin: s.scoreToWin }
    },
    getSteps: (input, { touch, mode }) => {
      const { control1, control2, tipoff, scoreToWin } = input as GuideInput
      return getGuideSteps({ touch, mode: mode === 'twoPlayer' ? 'twoPlayer' : 'vsCpu', controls: { 1: control1, 2: control2 }, tipoff, scoreToWin })
    }
  }
}
