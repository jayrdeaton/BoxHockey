import { SeedColor } from '@rific/auto-paper'
import { InlineColorPicker, MenuOption, PopoverHost, ReadyButton, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

import { MONO_FONT } from '@/constants/fonts'
import { ControlScheme } from '@/types'

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
  // Per-player pull/push preference (see ControlScheme in types/index.ts) — omit all three
  // (options/onChange too) for a slot that shouldn't show the picker at all; it also only ever
  // renders for isHuman slots (a CPU has no touch input to have a "feel" for — see the render
  // below), mirroring LightCycles' identical isHuman gate on its own per-player keyScheme picker.
  controlScheme?: ControlScheme
  controlSchemeOptions?: MenuOption<ControlScheme>[]
  onControlSchemeChange?: (value: ControlScheme) => void
  ready?: boolean
  onToggleReady?: () => void
  dark: boolean
  // vs-CPU only has one human player, so the loadout screen renders its Ready toggle standalone,
  // centered below both slots, instead of embedded in this panel.
  showReadyButton?: boolean
  // Threaded through to the control-scheme dropdown only — InlineColorPicker (used for this
  // panel's other picker) derives its own trigger/border colors straight from the player's own
  // `color` instead, so it needs neither.
  accentColor?: string
  mutedColor?: string
}

// One panel per player slot in the loadout screen: a color picker (interactive for both human and
// CPU slots, matching the title screen's own past behavior of letting the CPU's color be chosen
// too) and a Ready toggle for human slots only. Owns its own popover host shared by its own color
// picker unless a `host` is passed in to share with another panel or the shared controls instead.
export function PlayerSetupPanel({ idPrefix, host, label, color, onColorChange, swatches, takenColor, allowSwapTaken, isHuman, controlScheme, controlSchemeOptions, onControlSchemeChange, ready, onToggleReady, dark, showReadyButton = true, accentColor, mutedColor }: PlayerSetupPanelProps) {
  const ownHost = usePopoverHost()
  const popover = host ?? ownHost
  // Checking *this panel's own* id, not just "is anything open on the host" — when `host` is
  // shared (vs-CPU), the other panel's or the shared controls' popovers also live on it, and
  // elevating this panel for those too would tie it with whichever of them actually has the open
  // popover, letting DOM order (wrongly) decide which one paints on top.
  const ownPopoverOpen = popover.openId === `${idPrefix}-color` || popover.openId === `${idPrefix}-controlScheme`
  const showControlScheme = isHuman && !!controlScheme && !!controlSchemeOptions && !!onControlSchemeChange && !!accentColor && !!mutedColor

  return (
    <View style={[styles.panel, ownPopoverOpen && styles.panelOpen]}>
      {label && (
        <Text variant='labelSmall' style={{ color, fontFamily: MONO_FONT }}>
          {label}
        </Text>
      )}

      <View style={styles.pickerRow}>
        {/* Human slots (which, in two-player mode, is both of them) get a face; vs-CPU's CPU slot
        gets a robot — this is what actually distinguishes "you" from "the CPU" now, not text. */}
        <InlineColorPicker id={`${idPrefix}-color`} host={popover} value={color} onChange={onColorChange} swatches={swatches} takenValue={takenColor} allowSwapTaken={allowSwapTaken} dark={dark} icon={isHuman ? 'face-man' : 'robot'} />

        {/* Pull/push control-scheme picker — human slots only, same reasoning InlineColorPicker's
        face/robot icon swap above already encodes: a CPU has no finger on the glass to have a
        "feel" preference about (see useAIOpponent.ts, which cancels this setting's sign back out
        regardless of what it's set to, so it's invisible to the CPU either way). Side by side with
        the color picker rather than stacked — the two are this one player's own settings, read as
        a pair rather than a vertical list of one. */}
        {showControlScheme && <SectionedDropdown id={`${idPrefix}-controlScheme`} host={popover} icon='arrow-collapse' accessibilityLabel='Controls' sections={[{ kind: 'single', id: 'controlScheme', options: controlSchemeOptions!, value: controlScheme!, onChange: onControlSchemeChange! }]} accentColor={accentColor!} mutedColor={mutedColor!} dark={dark} />}
      </View>

      {isHuman && showReadyButton && onToggleReady && <ReadyButton color={color} ready={ready ?? false} onToggleReady={onToggleReady} />}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    gap: 12
  },
  // See SectionedDropdown's anchorOpen comment — this panel is a sibling of the other player's
  // panel (and the shared-controls row) in loadout.tsx, so a popover escaping this panel's bounds
  // needs the panel itself elevated, not just the popover content, to paint above a later sibling.
  panelOpen: {
    zIndex: 100
  },
  // Same gap as `panel`'s own vertical rhythm, reused horizontally — color picker and control
  // scheme sit side by side within this row instead of stacked in the panel's own column. No
  // padding/minWidth trick for a CPU slot's lone color circle (a prior version of this tried
  // centering it within an artificial two-trigger-wide box) — that made its circle sit further
  // from the screen edge than a human slot's own color circle does, which is its own kind of
  // lopsided. See loadout.tsx's playersRow instead: matching *that* gap to this one is what
  // actually makes a human slot's pair and a CPU slot's single circle read as one evenly spaced
  // row rather than two independently-centered blocks.
  pickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  }
})
