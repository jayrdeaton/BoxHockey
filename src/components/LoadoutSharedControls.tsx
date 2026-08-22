import { StyleSheet, View } from 'react-native'

import { IconDropdown, IconDropdownOption } from '@/components/IconDropdown'
import { PopoverHost, usePopoverHost } from '@/hooks/usePopoverHost'
import { BoardVariant, FrictionLevel, PuckSizeLevel, ShotPreviewLength, TipoffMode } from '@/types'

interface Props {
  // Shared popover host — see PlayerSetupPanel's identical `host` prop. Passed in vs-CPU mode so
  // board variant/score/difficulty are mutually exclusive with the player panels' own color
  // pickers too (there's only one human driving the whole screen there, so simultaneity across
  // every picker just adds clutter). Omit to fall back to this component's own independent host.
  host?: PopoverHost
  boardVariant: BoardVariant
  boardVariantOptions: IconDropdownOption<BoardVariant>[]
  onBoardVariantChange: (value: BoardVariant) => void
  friction: FrictionLevel
  frictionOptions: IconDropdownOption<FrictionLevel>[]
  onFrictionChange: (value: FrictionLevel) => void
  puckSize: PuckSizeLevel
  puckSizeOptions: IconDropdownOption<PuckSizeLevel>[]
  onPuckSizeChange: (value: PuckSizeLevel) => void
  scoreToWin: number
  scoreToWinOptions: IconDropdownOption<number>[]
  onScoreToWinChange: (value: number) => void
  shotPreviewLength: ShotPreviewLength
  shotPreviewLengthOptions: IconDropdownOption<ShotPreviewLength>[]
  onShotPreviewLengthChange: (value: ShotPreviewLength) => void
  tipoffMode: TipoffMode
  tipoffModeOptions: IconDropdownOption<TipoffMode>[]
  onTipoffModeChange: (value: TipoffMode) => void
  // Omitted entirely for two-player — there's no CPU to tune the difficulty of.
  aiDifficulty?: 'easy' | 'medium' | 'hard'
  aiDifficultyOptions?: IconDropdownOption<'easy' | 'medium' | 'hard'>[]
  onAiDifficultyChange?: (value: 'easy' | 'medium' | 'hard') => void
  accentColor: string
  mutedColor: string
  dark: boolean
}

// Always-upright row of shared (not per-player) settings in the loadout screen. Owns its own
// popover host, independent from either player's own panel, unless a `host` is passed in to share
// with the player panels instead (vs-CPU mode).
const OWN_IDS = ['boardVariant', 'friction', 'puckSize', 'scoreToWin', 'shotPreviewLength', 'tipoffMode', 'aiDifficulty']

export function LoadoutSharedControls({ host: sharedHost, boardVariant, boardVariantOptions, onBoardVariantChange, friction, frictionOptions, onFrictionChange, puckSize, puckSizeOptions, onPuckSizeChange, scoreToWin, scoreToWinOptions, onScoreToWinChange, shotPreviewLength, shotPreviewLengthOptions, onShotPreviewLengthChange, tipoffMode, tipoffModeOptions, onTipoffModeChange, aiDifficulty, aiDifficultyOptions, onAiDifficultyChange, accentColor, mutedColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See PlayerSetupPanel's identical ownPopoverOpen comment — elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && OWN_IDS.includes(host.openId)
  // Unlike aiDifficulty, tip-off applies in both game modes — it's the rightmost (and so
  // right-anchored, like aiDifficulty normally is) only when aiDifficulty isn't also rendered
  // (two-player mode), otherwise it sits ahead of aiDifficulty in the row instead.
  const showAiDifficulty = !!(aiDifficulty && aiDifficultyOptions && onAiDifficultyChange)

  return (
    <View style={[styles.row, ownPopoverOpen && styles.rowOpen]}>
      <IconDropdown id='boardVariant' host={host} icon='view-grid-outline' accessibilityLabel='Board' options={boardVariantOptions} value={boardVariant} onChange={onBoardVariantChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} align='left' />

      <IconDropdown id='friction' host={host} icon='speedometer-medium' accessibilityLabel='Friction' options={frictionOptions} value={friction} onChange={onFrictionChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />

      <IconDropdown id='puckSize' host={host} icon='diameter-variant' accessibilityLabel='Puck size' options={puckSizeOptions} value={puckSize} onChange={onPuckSizeChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />

      <IconDropdown id='scoreToWin' host={host} icon='flag-checkered' accessibilityLabel='Score to win' options={scoreToWinOptions} value={scoreToWin} onChange={onScoreToWinChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />

      <IconDropdown id='shotPreviewLength' host={host} icon='ray-start-arrow' accessibilityLabel='Shot preview length' options={shotPreviewLengthOptions} value={shotPreviewLength} onChange={onShotPreviewLengthChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />

      <IconDropdown id='tipoffMode' host={host} icon='hockey-puck' accessibilityLabel='Tip-off' options={tipoffModeOptions} value={tipoffMode} onChange={onTipoffModeChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} align={showAiDifficulty ? undefined : 'right'} />

      {showAiDifficulty && (
        // Rightmost of the row — left-anchored would overflow off the screen's right edge.
        <IconDropdown id='aiDifficulty' host={host} icon='chip' accessibilityLabel='CPU difficulty' options={aiDifficultyOptions!} value={aiDifficulty!} onChange={onAiDifficultyChange!} accentColor={accentColor} mutedColor={mutedColor} dark={dark} align='right' />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center'
  },
  // See IconDropdown's anchorOpen comment — this row is itself a sibling of the player panels in
  // loadout.tsx, and React Native Web's per-view stacking contexts mean a popover escaping this
  // row's bounds needs the row itself elevated, not just the popover content, to paint above a
  // later sibling panel.
  rowOpen: {
    zIndex: 100
  }
})
