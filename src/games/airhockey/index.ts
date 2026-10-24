import { ControlScheme, Player, Settings } from '@/games/airhockey/types'
import type { GameDefinition } from '@/shell/types'

import { getGuideSteps } from './constants/guideSteps'
import { achievementsActions, achievementsReducer, GameStatsProvider } from './hooks/useGameStats'
import PlayScreen from './PlayScreen'
import guide, { GUIDE_VERSION, guideActions, selectGuideVersionSeen } from './redux/guideSlice'
import settings from './redux/settingsSlice'
import { AchievementList, StatsSections } from './StatsSections'
import { useLoadout } from './useLoadout'

// What Air Hockey's How to Play cards are built from (see getGuideSteps).
interface GuideInput {
  controlScheme: Record<Player, ControlScheme>
  scoreToWin: number
}

// Air Hockey, from the AirHockey repo (never released on its own). Its store keys are its own
// (airhockeySettings, airhockeyAchievements, airhockeyGuide).
export const airHockey: GameDefinition = {
  id: 'airhockey',
  title: 'Air Hockey',
  blurb: 'The arcade table classic. Guard your goal and fire back.',
  icon: { light: require('./art/icon-light.png'), dark: require('./art/icon-dark.png') },
  seatTwo: ['cpu', 'person'],
  // Face to face on a phone, never flipped for an upside-down hold; on the web a window seats the
  // two players by its own shape (see the play screen's fixedSeats).
  twoPlayerSeats: { faceToFaceOnWeb: false, followUpsideDown: false },
  reducers: { airhockeySettings: settings, airhockeyAchievements: achievementsReducer, airhockeyGuide: guide },
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
      const s = (state as unknown as { airhockeySettings: Settings }).airhockeySettings
      return { controlScheme: s.controlScheme, scoreToWin: s.scoreToWin }
    },
    getSteps: (input, { touch }) => getGuideSteps({ touch, ...(input as GuideInput) })
  }
}
