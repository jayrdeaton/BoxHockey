import type { ImageSourcePropType } from 'react-native'

import { getGuideSteps } from '@/shared/paddleGame/constants/guideSteps'
import { PaddlePlayScreen } from '@/shared/paddleGame/PlayScreen'
import { createPaddleSettings, DEFAULT_SETTINGS } from '@/shared/paddleGame/settings'
import { createPaddleGameStats } from '@/shared/paddleGame/stats'
import type { ControlScheme, Player, Settings } from '@/shared/paddleGame/types'
import { usePaddleLoadout } from '@/shared/paddleGame/usePaddleLoadout'
import { createGameGuideSlice } from '@/shell/redux/gameGuideSlice'
import type { GameDefinition, RoundMode } from '@/shell/types'

interface PaddleGameOptions {
  id: string
  title: string
  blurb: string
  icon: { light: ImageSourcePropType; dark: ImageSourcePropType }
  // A brick field every round, and a solo round with seat 2 set to Nobody (Breaker), or neither
  // (Paddles).
  hasBricks: boolean
  // The version of the game's How to Play cards. Bump it ONLY when a controls or rules change would
  // leave the cards teaching something wrong: every player sees them once more after a bump.
  guideVersion: number
}

// What a paddle game's How to Play cards are built from (see getGuideSteps).
interface GuideInput {
  controls: Record<Player, ControlScheme>
  scoreToWin: number
}

// One of the pack's paddle games (Paddles and Breaker, both from Pong): one engine, one play screen,
// one stats shape, with the game's own store keys (`<id>Settings`, `<id>Achievements`,
// `<id>Guide`) so each keeps its own settings, stats, achievements and How to Play.
export function createPaddleGame({ id, title, blurb, icon, hasBricks, guideVersion }: PaddleGameOptions): GameDefinition {
  const settingsKey = `${id}Settings`
  const settings = createPaddleSettings(settingsKey)
  const stats = createPaddleGameStats({ key: `${id}Achievements`, hasBricks })
  const guide = createGameGuideSlice(`${id}Guide`)

  function useLoadout(mode: RoundMode) {
    const { settings: current, setSettings } = settings.useSettings()
    return usePaddleLoadout(mode, current, setSettings)
  }

  function PlayScreen() {
    const { recordMatchOutcome, recordSoloOutcome } = stats.useGameStats()
    return <PaddlePlayScreen game={id} defaults={DEFAULT_SETTINGS} hasBricks={hasBricks} recordMatchOutcome={recordMatchOutcome} recordSoloOutcome={recordSoloOutcome} />
  }

  return {
    id,
    title,
    blurb,
    icon,
    seatTwo: hasBricks ? ['cpu', 'person', 'nobody'] : ['cpu', 'person'],
    // Face to face on a phone, P1 at the bottom unless the phone is held upside down; on the web a
    // window seats the two players by its own shape (see the play screen's fixedSeats).
    twoPlayerSeats: { faceToFaceOnWeb: false, followUpsideDown: true },
    reducers: { [settingsKey]: settings.reducer, [`${id}Achievements`]: stats.reducer, [`${id}Guide`]: guide.reducer },
    Provider: stats.Provider,
    useLoadout,
    PlayScreen,
    StatsSections: stats.StatsSections,
    AchievementList: stats.AchievementList,
    resetStats: stats.actions.reset,
    guide: {
      version: guideVersion,
      selectVersionSeen: (state) => guide.selectVersionSeen(state),
      markSeen: guide.actions.markSeen,
      selectInput: (state): GuideInput => {
        const s = (state as unknown as Record<string, Settings | undefined>)[settingsKey] ?? DEFAULT_SETTINGS
        return { controls: s.controlScheme, scoreToWin: s.scoreToWin }
      },
      getSteps: (input, { touch }) => getGuideSteps({ touch, hasBricks, ...(input as GuideInput) })
    }
  }
}
