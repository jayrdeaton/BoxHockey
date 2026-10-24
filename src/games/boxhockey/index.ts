import { ControlScheme, Player, Settings, TipoffMode } from '@/games/boxhockey/types'
import type { GameDefinition } from '@/shell/types'

import { GUIDE_VERSION } from './constants/guide'
import { getGuideSteps } from './constants/guideSteps'
import { achievementsActions, achievementsReducer as achievements, GameStatsProvider } from './hooks/useGameStats'
import PlayScreen from './PlayScreen'
import guide, { guideActions, selectGuideVersionSeen } from './redux/guideSlice'
import profileExtensions from './redux/profileExtensionsSlice'
import settings from './redux/settingsSlice'
import { AchievementList, StatsSections } from './StatsSections'
import { useLoadout } from './useLoadout'

// What Box Hockey's How to Play cards are built from (see getGuideSteps).
interface GuideInput {
  controls: Record<Player, ControlScheme>
  tipoff: TipoffMode
  scoreToWin: number
}

// Box Hockey, the pack's first game and the one BoxHockey 1.0 shipped as. Its store keys are its own
// (boxhockeySettings, boxhockeyAchievements, boxhockeyGuide, boxhockeyProfileExtensions), like every
// game's. 1.0's saved state is not read (see pack.ts).
export const boxHockey: GameDefinition = {
  id: 'boxhockey',
  title: 'Box Hockey',
  blurb: 'The classic wooden table game. Take turns shooting.',
  // The pack's own app icon is Box Hockey's, so its tile uses the app icon files.
  icon: { light: require('../../../assets/images/icon-light.png'), dark: require('../../../assets/images/icon-dark.png') },
  seatTwo: ['cpu', 'person'],
  // The board never turns a quarter turn, only flips upside down, on every platform.
  twoPlayerSeats: { faceToFaceOnWeb: true, followUpsideDown: true },
  reducers: { boxhockeySettings: settings, boxhockeyAchievements: achievements, boxhockeyGuide: guide, boxhockeyProfileExtensions: profileExtensions },
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
      const s = (state as unknown as { boxhockeySettings: Settings }).boxhockeySettings
      return { controls: s.controlScheme, tipoff: s.tipoffMode, scoreToWin: s.scoreToWin }
    },
    getSteps: (input, { touch, mode }) => getGuideSteps({ touch, mode: mode === 'twoPlayer' ? 'twoPlayer' : 'vsCpu', ...(input as GuideInput) })
  }
}
