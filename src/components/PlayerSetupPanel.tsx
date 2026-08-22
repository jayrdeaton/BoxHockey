import { SeedColor } from '@rific/auto-paper'
import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

import { InlineColorPicker } from '@/components/InlineColorPicker'
import { ReadyButton } from '@/components/ReadyButton'
import { MONO_FONT } from '@/constants/fonts'
import { PopoverHost, usePopoverHost } from '@/hooks/usePopoverHost'

export interface PlayerSetupPanelProps {
  // Namespaces this panel's popover id so two panels can safely share one host (see `host` below)
  // without their ids colliding.
  idPrefix: string
  // Shared popover host, when this panel's color picker should be mutually exclusive with another
  // panel's or the shared controls' (vs-CPU: only one human is ever driving both slots, so having
  // both YOU's and CPU's pickers open at once is just clutter, not a useful simultaneous-edit
  // case). Omit to fall back to this panel's own independent host — the two-player case, where two
  // real people editing at once is the point.
  host?: PopoverHost
  label?: string
  color: string
  onColorChange: (hex: string) => void
  swatches: SeedColor[]
  // The other player's current color — stays visible in the swatch grid but disabled, rather than
  // removed from it entirely. Unless allowSwapTaken is set — see InlineColorPicker's own doc.
  takenColor?: string
  allowSwapTaken?: boolean
  isHuman: boolean
  ready?: boolean
  onToggleReady?: () => void
  dark: boolean
  // vs-CPU only has one human player, so the loadout screen renders its Ready toggle standalone,
  // centered below both slots, instead of embedded in this panel.
  showReadyButton?: boolean
  // See PopoverBody's align prop — pass 'right' for a panel that sits near the screen's right
  // edge, so its popover grows leftward instead of overflowing off-screen.
  align?: 'left' | 'right'
}

// One panel per player slot in the loadout screen: a color picker (interactive for both human and
// CPU slots, matching the title screen's own past behavior of letting the CPU's color be chosen
// too) and a Ready toggle for human slots only. Owns its own popover host shared by its own color
// picker unless a `host` is passed in to share with another panel or the shared controls instead.
export function PlayerSetupPanel({ idPrefix, host, label, color, onColorChange, swatches, takenColor, allowSwapTaken, isHuman, ready, onToggleReady, dark, showReadyButton = true, align }: PlayerSetupPanelProps) {
  const ownHost = usePopoverHost()
  const popover = host ?? ownHost
  // Checking *this panel's own* id, not just "is anything open on the host" — when `host` is
  // shared (vs-CPU), the other panel's or the shared controls' popovers also live on it, and
  // elevating this panel for those too would tie it with whichever of them actually has the open
  // popover, letting DOM order (wrongly) decide which one paints on top.
  const ownPopoverOpen = popover.openId === `${idPrefix}-color`

  return (
    <View style={[styles.panel, ownPopoverOpen && styles.panelOpen]}>
      {label && (
        <Text variant='labelSmall' style={{ color, fontFamily: MONO_FONT }}>
          {label}
        </Text>
      )}

      {/* Human slots (which, in two-player mode, is both of them) get a face; vs-CPU's CPU slot
      gets a robot — this is what actually distinguishes "you" from "the CPU" now, not text. */}
      <InlineColorPicker id={`${idPrefix}-color`} host={popover} value={color} onChange={onColorChange} swatches={swatches} takenValue={takenColor} allowSwapTaken={allowSwapTaken} dark={dark} align={align} icon={isHuman ? 'face-man' : 'robot'} />

      {isHuman && showReadyButton && onToggleReady && <ReadyButton color={color} ready={ready ?? false} onToggleReady={onToggleReady} />}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    gap: 12
  },
  // See IconDropdown's anchorOpen comment — this panel is a sibling of the other player's panel
  // (and the shared-controls row) in loadout.tsx, so a popover escaping this panel's bounds needs
  // the panel itself elevated, not just the popover content, to paint above a later sibling.
  panelOpen: {
    zIndex: 100
  }
})
