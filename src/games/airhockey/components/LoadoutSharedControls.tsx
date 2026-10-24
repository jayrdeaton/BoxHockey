import { IconButton } from '@rific/feedback-press'
import { MenuOption, PopoverHost, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { StyleSheet, View } from 'react-native'

import { FrictionLevel, PaddleSizeLevel, PuckSizeLevel } from '@/games/airhockey/types'

interface Props {
  // Shared popover host - see PlayerSetupPanel's identical `host` prop. loadout.tsx always passes
  // its own controlsHost here, in every game mode: this row sits in the same near/bottom zone as
  // P1's own panel, so board/puck/paddle physics/score/difficulty need to be mutually exclusive with
  // P1's color picker (only one of them can be open at a time), and - just as importantly - P1's
  // press-away overlay only watches controlsHost.openId, so a dropdown opened on any *other* host
  // would be invisible to it and never close on an outside tap. Omit only if some future caller
  // genuinely wants this row fully independent (own host, own press-away wiring it'd have to
  // provide itself).
  host?: PopoverHost
  // BoxHockey's rink toggle (see Settings.rink), as a one-item multi-select section: present in the
  // value array = on, which is what gives it the checkbox-style highlight-when-on look.
  rink: boolean
  rinkOption: MenuOption<'on'>
  onRinkChange: (value: boolean) => void
  friction: FrictionLevel
  frictionOptions: MenuOption<FrictionLevel>[]
  onFrictionChange: (value: FrictionLevel) => void
  puckSize: PuckSizeLevel
  puckSizeOptions: MenuOption<PuckSizeLevel>[]
  onPuckSizeChange: (value: PuckSizeLevel) => void
  paddleSize: PaddleSizeLevel
  paddleSizeOptions: MenuOption<PaddleSizeLevel>[]
  onPaddleSizeChange: (value: PaddleSizeLevel) => void
  scoreToWin: number
  scoreToWinOptions: MenuOption<number>[]
  onScoreToWinChange: (value: number) => void
  // Both one-shot actions on the settings above as a whole, not a value with a "current state" to
  // show - rendered as plain IconButtons in their own row above the trigger row (not a
  // SectionedDropdown trigger itself, which would misleadingly suggest a selected value to land
  // on). Optional (and always passed as a pair) - loadout.tsx's own showMetaInSharedBand case
  // renders these itself, inline in its merged back/dice/reset/settings header row, so this
  // component leaves its own row out entirely rather than showing the same two actions twice.
  onRandomize?: () => void
  onReset?: () => void
  accentColor: string
  mutedColor: string
  onAccentColor?: string
  dark: boolean
}

// Always-upright row of shared (not per-player) settings in the loadout screen. Shares P1's popover
// host (passed in by loadout.tsx in every game mode - see the `host` prop above) rather than owning
// an independent one, so this row participates in P1's mutual-exclusivity and press-away wiring the
// same way P1's own panel does. Pruned down from BoxHockey's version - no tipoffMode (no
// faceoff/coin-flip ceremony, the puck just re-serves - see GOAL_SERVE_PAUSE_MS), no
// shotPreviewLength (no aimed-shot preview at all), and no boardVariant (there's only one table
// layout), so BoxHockey's board popover keeps just its rink toggle here. Friction/puckSize/paddleSize
// each get their own trigger too, rather than sharing one bundled "puck physics" popover the way
// BoxHockey still does: with three real lists (plus rink/scoreToWin) all live at once in this
// app's loadout, a single combined popover buried unrelated settings behind one speedometer icon.
// aiDifficulty moved out to a per-seat picker (see PlayerSetupPanel), matching BoxHockey's/
// LightCycles' identical cross-app convention. Exported so loadout.tsx's own SharedActionBand
// wrapper can run this same "is one of my own popovers open" membership check on itself.
export const LOADOUT_SHARED_CONTROLS_IDS = ['board', 'friction', 'puckSize', 'paddleSize', 'scoreToWin']

export function LoadoutSharedControls({ host: sharedHost, rink, rinkOption, onRinkChange, friction, frictionOptions, onFrictionChange, puckSize, puckSizeOptions, onPuckSizeChange, paddleSize, paddleSizeOptions, onPaddleSizeChange, scoreToWin, scoreToWinOptions, onScoreToWinChange, onRandomize, onReset, accentColor, mutedColor, onAccentColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See PlayerSetupPanel's identical ownPopoverOpen comment - elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && LOADOUT_SHARED_CONTROLS_IDS.includes(host.openId)
  // Same fg convention as every other component keying off a `dark` prop - full-contrast, unlike
  // mutedColor/accentColor above, which are tuned for a TriggerGauge's own unselected/selected
  // states rather than a plain icon button. Matches BoxHockey's/LightCycles' identical actionsRow.
  const fg = dark ? '#FFFFFF' : '#000000'

  return (
    <View style={[styles.container, ownPopoverOpen && styles.containerOpen]}>
      {onRandomize && onReset && (
        <View style={styles.actionsRow}>
          <IconButton icon='dice-multiple' iconColor={fg} size={18} onPress={onRandomize} accessibilityLabel='Randomize match settings' />
          <IconButton icon='restore' iconColor={fg} size={18} onPress={onReset} accessibilityLabel='Reset match settings to defaults' />
        </View>
      )}

      <View style={styles.row}>
        {/* Board - BoxHockey's board popover (same icon and first-in-row placement), holding
      just its rink toggle since there's no board variant to pick. A table layout later is a
      single-select section added in front of it, not a UI reshuffle. */}
        <SectionedDropdown id='board' host={host} icon='view-grid-outline' accessibilityLabel='Board' sections={[{ kind: 'multi', id: 'rink', options: [rinkOption], value: rink ? ['on'] : [], onChange: (value) => onRinkChange(value.length > 0) }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        {/* Friction, puck size, and paddle size each get their own standalone trigger - previously
      bundled into one 'puckPhysics' popover (three sections behind a single speedometer icon), but
      that buried puck size/paddle size behind a menu literally labeled for speed, and made every
      one of the three an extra tap deep. Each is a real, independent match setting on par with
      scoreToWin below, so each gets the same standalone-trigger treatment scoreToWin already had. */}
        <SectionedDropdown id='friction' host={host} icon='speedometer-medium' accessibilityLabel='Puck speed' sections={[{ kind: 'single', id: 'friction', options: frictionOptions, value: friction, onChange: onFrictionChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        <SectionedDropdown id='puckSize' host={host} icon='hockey-puck' accessibilityLabel='Puck size' sections={[{ kind: 'single', id: 'puckSize', options: puckSizeOptions, value: puckSize, onChange: onPuckSizeChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        <SectionedDropdown id='paddleSize' host={host} icon='circle-double' accessibilityLabel='Paddle size' sections={[{ kind: 'single', id: 'paddleSize', options: paddleSizeOptions, value: paddleSize, onChange: onPaddleSizeChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        <SectionedDropdown id='scoreToWin' host={host} icon='flag-checkered' accessibilityLabel='Score to win' sections={[{ kind: 'single', id: 'scoreToWin', options: scoreToWinOptions, value: scoreToWin, onChange: onScoreToWinChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Above the trigger row - small, secondary-weight (size 18 vs. the triggers' own icon size) so
  // Randomize/Reset read as quick actions on the settings below rather than a third setting of
  // equal standing. On top (not below) to match loadout.tsx's own showMetaInSharedBand header row,
  // which folds these same two actions in with back/settings above the triggers there too.
  actionsRow: {
    flexDirection: 'row',
    gap: 12
  },
  container: {
    alignItems: 'center',
    gap: 4
  },
  // See SectionedDropdown's anchorOpen comment - this whole column is itself a sibling of the
  // player panels in loadout.tsx, and React Native Web's per-view stacking contexts mean a popover
  // escaping the row below needs this wrapper elevated, not just the popover content, to paint
  // above a later sibling panel.
  containerOpen: {
    zIndex: 100
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    // Safety net, not the primary fix - combining related pickers (see puckPhysics above) is what
    // actually keeps this row from feeling cramped. But nothing capped its width before this, and a
    // row of fixed-size triggers with no wrap just runs off the screen edge on a narrow device,
    // taking the last trigger or two with it - untappable, not just clipped. Wrap is what turns
    // that into "drops to a second centered line" instead.
    flexWrap: 'wrap',
    // Matches LightCycles' LobbySharedControls - wider than a plain icon row would need, to give
    // each trigger's TriggerGauge arc (pulled in close around the icon itself - see TriggerGauge's
    // own ARC_GAP) room to breathe against its neighbors instead of the arcs crowding each other.
    gap: 20,
    justifyContent: 'center'
  }
})
