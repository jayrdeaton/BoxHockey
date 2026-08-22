import { StyleSheet, View } from 'react-native'

import { IconDropdown, IconDropdownOption } from '@/components/IconDropdown'
import { PopoverHost, usePopoverHost } from '@/hooks/usePopoverHost'
import { BoardVariant, OrientationMode } from '@/types'

interface Props {
  // Shared popover host — see PlayerSetupPanel's identical `host` prop. Passed in vs-CPU mode so
  // board variant/score/difficulty are mutually exclusive with the player panels' own color
  // pickers too (there's only one human driving the whole screen there, so simultaneity across
  // every picker just adds clutter). Omit to fall back to this component's own independent host.
  host?: PopoverHost
  boardVariant: BoardVariant
  boardVariantOptions: IconDropdownOption<BoardVariant>[]
  onBoardVariantChange: (value: BoardVariant) => void
  scoreToWin: number
  scoreToWinOptions: IconDropdownOption<number>[]
  onScoreToWinChange: (value: number) => void
  // Omitted entirely for vs-CPU — there's no second physical player to lay the panels out for.
  orientationMode?: OrientationMode
  orientationModeOptions?: IconDropdownOption<OrientationMode>[]
  onOrientationModeChange?: (value: OrientationMode) => void
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
const OWN_IDS = ['boardVariant', 'scoreToWin', 'orientationMode', 'aiDifficulty']

export function LoadoutSharedControls({ host: sharedHost, boardVariant, boardVariantOptions, onBoardVariantChange, scoreToWin, scoreToWinOptions, onScoreToWinChange, orientationMode, orientationModeOptions, onOrientationModeChange, aiDifficulty, aiDifficultyOptions, onAiDifficultyChange, accentColor, mutedColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See PlayerSetupPanel's identical ownPopoverOpen comment — elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && OWN_IDS.includes(host.openId)

  return (
    <View style={[styles.row, ownPopoverOpen && styles.rowOpen]}>
      <IconDropdown id='boardVariant' host={host} icon='view-grid-outline' accessibilityLabel='Board' options={boardVariantOptions} value={boardVariant} onChange={onBoardVariantChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} align='left' />

      <IconDropdown id='scoreToWin' host={host} icon='flag-checkered' accessibilityLabel='Score to win' options={scoreToWinOptions} value={scoreToWin} onChange={onScoreToWinChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />

      {orientationMode && orientationModeOptions && onOrientationModeChange && (
        // Rightmost of the row, and its option text is the widest of the three — left-anchored, it
        // overflows off-screen on a narrow layout.
        <IconDropdown id='orientationMode' host={host} icon='crop-portrait' accessibilityLabel='Player layout' options={orientationModeOptions} value={orientationMode} onChange={onOrientationModeChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} align='right' />
      )}

      {aiDifficulty && aiDifficultyOptions && onAiDifficultyChange && (
        // Rightmost of the row (vs-CPU never renders orientationMode alongside it), same overflow
        // reasoning as above.
        <IconDropdown id='aiDifficulty' host={host} icon='chip' accessibilityLabel='CPU difficulty' options={aiDifficultyOptions} value={aiDifficulty} onChange={onAiDifficultyChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} align='right' />
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
