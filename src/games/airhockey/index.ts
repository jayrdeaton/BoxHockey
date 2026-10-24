import { ControlScheme } from '@/games/airhockey/types'
import type { GameDefinition } from '@/shell/types'

import { getGuideSteps } from './constants/guideSteps'
import { achievementsActions, achievementsReducer, GameStatsProvider } from './hooks/useGameStats'
import PlayScreen from './PlayScreen'
import guide, { GUIDE_VERSION, guideActions, selectGuideVersionSeen } from './redux/guideSlice'
import { playerSettings } from './redux/settingsSlice'
import { AchievementList, StatsSections } from './StatsSections'
import { useLoadout } from './useLoadout'

// What Air Hockey's How to Play cards are built from (see getGuideSteps), flat so the guide's
// shallow compare sees no change while none of them change.
interface GuideInput {
  control1: ControlScheme
  control2: ControlScheme
  scoreToWin: number
}

// Air Hockey, from the AirHockey repo (never released on its own). Its store keys are its own
// (airhockeySettings, airhockeyControls, airhockeyAchievements, airhockeyGuide).
export const airHockey: GameDefinition = {
  id: 'airhockey',
  title: 'Air Hockey',
  blurb: 'The arcade table classic. Guard your goal and fire back.',
  icon: { light: require('./art/icon-light.png'), dark: require('./art/icon-dark.png') },
  seatTwo: ['cpu', 'person'],
  // Face to face on a phone, never flipped for an upside-down hold; on the web a window seats the
  // two players by its own shape (see the play screen's fixedSeats).
  twoPlayerSeats: { faceToFaceOnWeb: false, followUpsideDown: false },
  reducers: { ...playerSettings.reducers, airhockeyAchievements: achievementsReducer, airhockeyGuide: guide },
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
      return { control1: s.controlScheme[1], control2: s.controlScheme[2], scoreToWin: s.scoreToWin }
    },
    getSteps: (input, { touch }) => {
      const { control1, control2, scoreToWin } = input as GuideInput
      return getGuideSteps({ touch, controlScheme: { 1: control1, 2: control2 }, scoreToWin })
    }
  }
}
