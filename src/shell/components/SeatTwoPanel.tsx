import type { SeedColor } from '@rific/auto-paper'
import { type MenuOption, type PopoverHost, ReadyButton, useZoneClampedAlign } from '@tastic/hud'
import { getOptionPickerContentSize, OptionPicker, type OptionPickerOption, type Profile, type ProfilePickerColorSection } from '@tastic/profile'
import { ReactNode, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import type { SeatTwo } from '@/shell/types'

// Seat 2's one button: who sits there (a CPU at a difficulty, nobody where the game has a solo
// mode, a guest, or a profile) and, on top, the seat's Color row. It replaces the choice between
// One Player and Two Player that Home used to ask before the loadout: picking a person here is what
// makes the round 2 Player, and the loadout turns to face both players.
//
// Built on @tastic/profile's OptionPicker, so it opens, places itself and closes like seat 1's
// ProfilePicker beside it; written so it can move into @tastic/hud's PlayerSetupPanel once the pack
// layout's shell moves into the shared packages (see the PuckTastic plan). Laid out like
// PlayerSetupPanel: the seat button, a person's controls picker under it, and their Ready button.

const CPU_PREFIX = 'cpu:'
const PROFILE_PREFIX = 'profile:'
const NOBODY = 'nobody'
const GUEST = 'guest'

const GUEST_ICON = 'account-outline'
const NOBODY_ICON = 'account-off-outline'
const CPU_ICON = 'robot'

export function getSeatTwoPopoverId(idPrefix: string): string {
  return `${idPrefix}-seat`
}

export interface SeatTwoPanelProps {
  idPrefix: string
  host: PopoverHost
  // Seat 2's choices in this game (GameDefinition.seatTwo), in menu order.
  choices: readonly SeatTwo[]
  seatTwo: SeatTwo
  onSeatTwoChange: (seatTwo: SeatTwo) => void
  cpuDifficulty: { value: string; options: MenuOption<string>[]; onChange: (value: string) => void }
  profiles: Profile[]
  selectedProfileId: string | null
  // Seat 1's profile: picking it here swaps the two seats (see @tastic/profile's select).
  onProfileSelect: (profileId: string | null) => void
  color: string
  onColorChange: (hex: string) => void
  swatches: SeedColor[]
  takenColor?: string
  allowSwapTaken?: boolean
  // Shown under the Color row while a profile is in the seat (its pick is kept for this pack only).
  colorCaption?: string
  dark: boolean
  // A person's controls picker (see GameLoadout.seatControl).
  secondPicker?: ReactNode
  secondPickerId?: string
  ready?: boolean
  onToggleReady?: () => void
  showReadyButton?: boolean
}

export function SeatTwoPanel({ idPrefix, host, choices, seatTwo, onSeatTwoChange, cpuDifficulty, profiles, selectedProfileId, onProfileSelect, color, onColorChange, swatches, takenColor, allowSwapTaken, colorCaption, dark, secondPicker, secondPickerId, ready, onToggleReady, showReadyButton = true }: SeatTwoPanelProps) {
  const isPerson = seatTwo === 'person'
  const selectedProfile = isPerson ? (profiles.find((p) => p.id === selectedProfileId) ?? null) : null

  const options = useMemo<OptionPickerOption<string>[]>(() => {
    const list: OptionPickerOption<string>[] = []
    if (choices.includes('cpu')) list.push(...cpuDifficulty.options.map((o) => ({ value: `${CPU_PREFIX}${o.value}`, label: o.label, icon: o.icon })))
    if (choices.includes('nobody')) list.push({ value: NOBODY, label: 'Nobody', icon: NOBODY_ICON })
    if (choices.includes('person')) {
      list.push({ value: GUEST, label: 'Player 2', icon: GUEST_ICON })
      list.push(...[...profiles].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: `${PROFILE_PREFIX}${p.id}`, label: p.name, icon: 'account', color: p.color })))
    }
    return list
  }, [choices, cpuDifficulty.options, profiles])

  const value = seatTwo === 'cpu' ? `${CPU_PREFIX}${cpuDifficulty.value}` : seatTwo === 'nobody' ? NOBODY : selectedProfile ? `${PROFILE_PREFIX}${selectedProfile.id}` : GUEST
  const icon = seatTwo === 'cpu' ? CPU_ICON : seatTwo === 'nobody' ? NOBODY_ICON : selectedProfile ? 'account' : GUEST_ICON

  const handleChange = (next: string) => {
    if (next.startsWith(CPU_PREFIX)) {
      cpuDifficulty.onChange(next.slice(CPU_PREFIX.length))
      onSeatTwoChange('cpu')
    } else if (next === NOBODY) {
      onSeatTwoChange('nobody')
    } else {
      onProfileSelect(next.startsWith(PROFILE_PREFIX) ? next.slice(PROFILE_PREFIX.length) : null)
      onSeatTwoChange('person')
    }
  }

  // Nobody has no color to pick: there's nothing of theirs on the board.
  const colorSection: ProfilePickerColorSection | undefined = seatTwo === 'nobody' ? undefined : { value: color, onChange: onColorChange, swatches, takenValue: takenColor, allowSwapTaken, caption: selectedProfile ? colorCaption : undefined }

  const pickerId = getSeatTwoPopoverId(idPrefix)
  const size = getOptionPickerContentSize(options.length, colorSection)
  // Kept inside this player's half in 2 Player, like PlayerSetupPanel's own seat button.
  const align = useZoneClampedAlign(host.openId === pickerId, size.width, size.height)

  const ownPopoverOpen = host.openId?.startsWith(`${idPrefix}-`) ?? false
  const pickerRowOpen = secondPickerId !== undefined && host.openId === secondPickerId

  return (
    <View style={[styles.panel, ownPopoverOpen && styles.panelOpen]}>
      <OptionPicker id={pickerId} host={host} options={options} value={value} onChange={handleChange} color={color} dark={dark} icon={icon} colorSection={colorSection} alignOverride={align} />
      {isPerson && secondPicker && <View style={[styles.pickerRow, pickerRowOpen && styles.pickerRowOpen]}>{secondPicker}</View>}
      {isPerson && showReadyButton && onToggleReady && <ReadyButton color={color} ready={ready ?? false} onToggleReady={onToggleReady} />}
    </View>
  )
}

// The same rhythm and stacking as @tastic/hud's PlayerSetupPanel, so seat 2 lines up with seat 1.
const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    gap: 12
  },
  // A popover escaping this panel needs the panel itself elevated to paint above a later sibling.
  panelOpen: {
    zIndex: 100
  },
  pickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  // Lifts the controls picker's popover above the Ready button below it (each View is its own
  // stacking context on the web).
  pickerRowOpen: {
    zIndex: 100
  }
})
