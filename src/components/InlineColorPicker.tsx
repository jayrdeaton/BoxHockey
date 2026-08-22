import { defaultColors, getContrastColor, SeedColor } from '@rific/auto-paper'
import { TouchableRipple } from '@rific/feedback-press'
import { StyleSheet, View } from 'react-native'
import { Icon } from 'react-native-paper'

import { PopoverBody } from '@/components/PopoverBody'
import { PopoverHost } from '@/hooks/usePopoverHost'

const SIZE = 48
const SWATCH_SIZE = 28
const SWATCHES_PADDING = 8
const SWATCHES_GAP = 6
const SWATCHES_BORDER_WIDTH = 2

interface Props {
  id: string
  host: PopoverHost
  value: string
  onChange: (hex: string) => void
  swatches?: SeedColor[]
  // The other player's current color, if any — stays visible in the grid (so the full palette
  // reads consistently for both players) but renders disabled with an X, rather than being
  // silently removed from the list. Unless allowSwapTaken is set — see that prop.
  takenValue?: string
  // Lets a tap on the taken swatch swap the two colors (this picker takes it, the other slot takes
  // this picker's old color) instead of being disabled — vs-CPU passes this, since the "other"
  // color there is only ever the CPU's, not a second real person's choice to step on. Two-player
  // leaves this unset: swapping a human opponent's color out from under them without their input
  // isn't the same tradeoff.
  allowSwapTaken?: boolean
  dark: boolean
  // See PopoverBody's align prop — pass 'right' for a trigger that sits near the screen's right
  // edge, so its popover grows leftward instead of overflowing off-screen.
  align?: 'left' | 'right' | 'center'
  // Trigger glyph — defaults to a plain palette. Vs-CPU passes a distinct icon per slot (a face for
  // the human, a robot for the CPU) so identity is conveyed by the icon itself.
  icon?: string
}

// Renders inline rather than as a full-screen modal (unlike @rific/auto-paper's own ColorPicker),
// scoped to its own panel — a modal picker would block the whole screen for one player while the
// other can't touch their own panel at the same time.
export function InlineColorPicker({ id, host, value, onChange, swatches = defaultColors, takenValue, allowSwapTaken, dark, align, icon = 'palette' }: Props) {
  const menuBg = dark ? '#000000' : '#FFFFFF'

  const open = host.openId === id

  return (
    <View style={[styles.anchor, open && styles.anchorOpen]}>
      <TouchableRipple onPress={() => host.toggle(id)} borderless style={[styles.trigger, { backgroundColor: value }]}>
        <Icon source={icon} size={20} color={getContrastColor(value)} />
      </TouchableRipple>

      <PopoverBody visible={open} align={align} caretColor={menuBg} caretBorderColor={value} caretBorderWidth={SWATCHES_BORDER_WIDTH} triggerSize={SIZE}>
        {/* Border matches this trigger's own current color (not a neutral gray) — two triggers can
        sit close together, so the popover needs a clear visual tie back to which one opened it,
        not just its screen position. */}
        <View style={[styles.swatches, { backgroundColor: menuBg, borderColor: value }]}>
          {swatches.map((swatch) => {
            const selected = swatch.value.toLowerCase() === value.toLowerCase()
            const taken = !selected && !!takenValue && swatch.value.toLowerCase() === takenValue.toLowerCase()
            const swappable = taken && allowSwapTaken
            return (
              <TouchableRipple
                key={swatch.value}
                disabled={taken && !swappable}
                onPress={() => {
                  onChange(swatch.value)
                  host.close()
                }}
                borderless
                style={[styles.swatch, { backgroundColor: swatch.value }, selected && styles.swatchSelected, taken && !swappable && styles.swatchTaken]}
              >
                {selected ? <Icon source='check' size={16} color={getContrastColor(swatch.value)} /> : swappable ? <Icon source='swap-horizontal' size={16} color={getContrastColor(swatch.value)} /> : taken ? <Icon source='close' size={16} color={getContrastColor(swatch.value)} /> : <View />}
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
  // React Native Web gives every position:'relative' view its own stacking context, so the
  // elevation has to live on the anchor itself, not just the popover content nested inside it, to
  // correctly paint above this anchor's own later siblings.
  anchorOpen: {
    zIndex: 100
  },
  swatch: {
    alignItems: 'center',
    borderRadius: SWATCH_SIZE / 2,
    height: SWATCH_SIZE,
    justifyContent: 'center',
    width: SWATCH_SIZE
  },
  swatchSelected: {
    borderColor: '#ffffff',
    borderWidth: 2
  },
  swatchTaken: {
    opacity: 0.35
  },
  swatches: {
    borderRadius: 12,
    borderWidth: SWATCHES_BORDER_WIDTH,
    elevation: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SWATCHES_GAP,
    padding: SWATCHES_PADDING,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    // Exact width for 4 columns: border-box sizing means `width` has to include the border too
    // (2*SWATCHES_BORDER_WIDTH), not just padding+content — omitting it left exactly enough room
    // short that the 4th column silently wrapped to a new row every time. Anything wider than this
    // exact sum just shows as dead space on the right edge of each row instead.
    width: SWATCHES_BORDER_WIDTH * 2 + SWATCHES_PADDING * 2 + SWATCH_SIZE * 4 + SWATCHES_GAP * 3
  },
  trigger: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: SIZE / 2,
    height: SIZE,
    justifyContent: 'center',
    width: SIZE
  }
})
