import { getBlendedColor } from '@rific/auto-paper'
import { IconButton, TouchableRipple } from '@rific/feedback-press'
import { StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import { PopoverBody } from '@/components/PopoverBody'
import { MONO_FONT } from '@/constants/fonts'
import { PopoverHost } from '@/hooks/usePopoverHost'

const MENU_BORDER_WIDTH = 1
// Matches triggerBox's own height/width below — passed to PopoverBody so its caret can point at
// this trigger's actual center for 'left'/'right' align, not the (usually wider) menu's midpoint.
const TRIGGER_SIZE = 44
const MENU_MIN_WIDTH = 160
const MENU_ITEM_ICON_SIZE = 18
// Tuned by eye: wide enough that a short one-word-ish label stays on one line, narrow enough that
// a sentence-length description reliably wraps onto a second line instead.
const MENU_ITEM_LABEL_MAX_WIDTH = 130

export interface IconDropdownOption<T extends string | number> {
  value: T
  label: string
  description?: string
  // Optional per-option icon — when every option has one, the trigger shows the currently
  // selected option's icon instead of the static fallback below, so the value is readable at a
  // glance without opening the dropdown.
  icon?: string
  iconSize?: number
}

interface Props<T extends string | number> {
  id: string
  host: PopoverHost
  // Static fallback trigger icon, used when the selected option has no `icon` of its own.
  icon: string
  accessibilityLabel: string
  options: IconDropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  accentColor: string
  mutedColor: string
  dark: boolean
  // See PopoverBody's align prop — pass 'right' for a trigger that sits near the screen's right
  // edge (e.g. the rightmost of a row of icons), so its popover grows leftward instead of
  // overflowing off-screen.
  align?: 'left' | 'right' | 'center'
}

// Icon-button trigger + attached option list, replacing a full chip row so this picker takes a
// fraction of the space. Reused for board variant, score-to-win, AI difficulty, and orientation.
export function IconDropdown<T extends string | number>({ id, host, icon, accessibilityLabel, options, value, onChange, accentColor, mutedColor, dark, align }: Props<T>) {
  const menuBg = dark ? '#000000' : '#FFFFFF'
  const menuBorderColor = getBlendedColor(mutedColor, menuBg, 0.5)

  const open = host.openId === id
  const selectedOption = options.find((o) => o.value === value)
  const triggerIcon = selectedOption?.icon ?? icon
  const triggerIconSize = selectedOption?.iconSize ?? 22

  return (
    <View style={[styles.anchor, open && styles.anchorOpen]}>
      <View style={styles.triggerBox}>
        <IconButton icon={triggerIcon} iconColor={mutedColor} size={triggerIconSize} accessibilityLabel={accessibilityLabel} onPress={() => host.toggle(id)} />
      </View>

      <PopoverBody visible={open} align={align} caretColor={menuBg} caretBorderColor={menuBorderColor} caretBorderWidth={MENU_BORDER_WIDTH} triggerSize={TRIGGER_SIZE}>
        <View style={[styles.menu, { backgroundColor: menuBg, borderColor: menuBorderColor }]}>
          {options.map((option) => {
            const selected = option.value === value
            const rowColor = selected ? '#000000' : mutedColor
            return (
              <TouchableRipple
                key={option.value}
                onPress={() => {
                  onChange(option.value)
                  host.close()
                }}
                style={[styles.item, selected && { backgroundColor: accentColor }]}
              >
                <View style={styles.itemRow}>
                  {option.icon && <Icon source={option.icon} size={MENU_ITEM_ICON_SIZE} color={rowColor} />}
                  <View style={styles.itemLabelColumn}>
                    <Text variant='labelLarge' style={[{ fontFamily: MONO_FONT }, { color: rowColor, fontWeight: selected ? 'bold' : 'normal' }]}>
                      {option.label}
                    </Text>
                    {option.description && (
                      <Text variant='labelSmall' style={[{ fontFamily: MONO_FONT }, { color: rowColor }]}>
                        {option.description}
                      </Text>
                    )}
                  </View>
                </View>
              </TouchableRipple>
            )
          })}
        </View>
      </PopoverBody>
    </View>
  )
}

const styles = StyleSheet.create({
  anchor: {
    position: 'relative'
  },
  // React Native Web gives every position:'relative' view an explicit zIndex (0, not 'auto'),
  // which makes each one its own stacking context — so a zIndex set only on the popover content
  // below only wins comparisons within this anchor's own box, not against this anchor's own later
  // siblings, which are otherwise painted on top by DOM-order tiebreak. Elevating the anchor
  // itself, only while its popover is open, fixes that at the right level.
  anchorOpen: {
    zIndex: 100
  },
  item: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  itemLabelColumn: {
    maxWidth: MENU_ITEM_LABEL_MAX_WIDTH
  },
  itemRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  menu: {
    borderRadius: 12,
    borderWidth: MENU_BORDER_WIDTH,
    elevation: 8,
    gap: 4,
    minWidth: MENU_MIN_WIDTH,
    padding: 6,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8
  },
  // Fixed hit-area regardless of the current option's iconSize, so a small-vs-large trigger icon
  // doesn't shift this picker's position within its row.
  triggerBox: {
    alignItems: 'center',
    height: TRIGGER_SIZE,
    justifyContent: 'center',
    width: TRIGGER_SIZE
  }
})
