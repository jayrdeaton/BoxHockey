import { SeedColor } from '@rific/auto-paper'
import { InlineColorPicker, MenuOption, PopoverHost, ReadyButton, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { ProfilePicker } from '@tastic/profile'
import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

import { MONO_FONT } from '@/constants/fonts'
import { ControlScheme, Profile } from '@/types'

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
  profiles?: Profile[]
  selectedProfileId?: string | null
  takenProfileId?: string | null
  // What the name trigger shows before any profile's selected — this seat's own 'P1'/'P2' (see
  // ProfilePicker's own doc for why it's never "Player", the menu's own row for that state).
  // Required whenever profiles is provided, since the trigger always needs some idle text.
  guestLabel?: string
  onProfileSelect?: (profile: Profile | null) => void
  // Navigates to the profile-management screen — only ever provided for P1 (see ProfilePicker's
  // own doc for why: P2's rotated zone can't host a working text keyboard).
  onManageProfiles?: () => void
}

// One panel per player slot in the loadout screen: a name label (tap to switch profiles or create
// one, human slots only — falls back to the plain `label` text below when profiles isn't wired in),
// a color picker (interactive for both human and CPU slots, matching the title screen's own past
// behavior of letting the CPU's color be chosen too), and a Ready toggle for human slots only. Owns
// its own popover host shared by its own color/profile picker unless a `host` is passed in to share
// with another panel or the shared controls instead. Mirrors LightCycles' LobbyPlayerPanel.tsx for
// its profile-switcher slot; unlike that component there's no per-panel CPU-difficulty picker to
// swap in for the CPU slot (BoxHockey's aiDifficulty is a single shared-controls setting, not
// per-seat), so the CPU slot (and any human slot not wired with profiles) just keeps this panel's
// original plain-text `label`.
export function PlayerSetupPanel({ idPrefix, host, label, color, onColorChange, swatches, takenColor, allowSwapTaken, isHuman, controlScheme, controlSchemeOptions, onControlSchemeChange, ready, onToggleReady, dark, showReadyButton = true, accentColor, mutedColor, profiles, selectedProfileId, takenProfileId, guestLabel, onProfileSelect, onManageProfiles }: PlayerSetupPanelProps) {
  const ownHost = usePopoverHost()
  const popover = host ?? ownHost
  // Checking *this panel's own* id, not just "is anything open on the host" — when `host` is
  // shared (vs-CPU), the other panel's or the shared controls' popovers also live on it, and
  // elevating this panel for those too would tie it with whichever of them actually has the open
  // popover, letting DOM order (wrongly) decide which one paints on top.
  const ownPopoverOpen = popover.openId?.startsWith(`${idPrefix}-`) ?? false
  const showControlScheme = isHuman && !!controlScheme && !!controlSchemeOptions && !!onControlSchemeChange && !!accentColor && !!mutedColor
  const showProfilePicker = isHuman && profiles !== undefined && !!onProfileSelect
  // The color button's own tag display (see InlineColorPicker) — read live from the selected
  // profile rather than snapshotted at selection time, since there's no other editing surface for
  // it on this screen at all (see app/profiles.tsx's ProfilesManager, the only place a tag is
  // actually typed).
  const selectedProfile = profiles?.find((p) => p.id === selectedProfileId) ?? null
  // Pre-fills the seat's own control scheme from the selected profile at selection time — stays
  // fully editable afterward, and keeps syncing back for as long as the profile stays selected (see
  // loadout.tsx's own sync-back handler). Color isn't pre-filled here: unlike control scheme, a
  // seat's color while a profile's selected has to keep tracking that profile's own *current* saved
  // color for as long as it stays selected (not just snap once at selection time), including across
  // this screen's own mount — see loadout.tsx's own profile-color effect and Profile's own doc
  // comment in types/index.ts, both of which own that entirely now.
  const handleProfileSelect = useCallback(
    (profile: Profile | null) => {
      onProfileSelect?.(profile)
      if (profile) onControlSchemeChange?.(profile.controlScheme)
    },
    [onProfileSelect, onControlSchemeChange]
  )

  return (
    <View style={[styles.panel, ownPopoverOpen && styles.panelOpen]}>
      {showProfilePicker ? (
        <ProfilePicker idPrefix={idPrefix} host={popover} profiles={profiles!} selectedId={selectedProfileId ?? null} takenId={takenProfileId} color={color} dark={dark} guestLabel={guestLabel ?? 'GUEST'} onSelect={handleProfileSelect} onManage={onManageProfiles} />
      ) : (
        label && (
          <Text variant='labelSmall' style={{ color, fontFamily: MONO_FONT }}>
            {label}
          </Text>
        )
      )}

      <View style={styles.pickerRow}>
        {/* Human slots (which, in two-player mode, is both of them) show the selected profile's own
        tag when it has one, falling back to a face; vs-CPU's CPU slot always falls back to a robot
        (no profile concept there at all) — this is what actually distinguishes "you" from "the CPU"
        now, not a fixed icon. */}
        <InlineColorPicker id={`${idPrefix}-color`} host={popover} value={color} onChange={onColorChange} swatches={swatches} takenValue={takenColor} allowSwapTaken={allowSwapTaken} dark={dark} tag={isHuman ? selectedProfile?.tag : undefined} icon={isHuman ? 'face-man' : 'robot'} />

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
