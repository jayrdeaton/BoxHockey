import { MenuOption, PopoverHost, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { StyleSheet, View } from 'react-native'

import { BoardVariant, FrictionLevel, InterceptSpeed, PuckSizeLevel, ShotPreviewLength, TipoffMode } from '@/types'

interface Props {
  // Shared popover host — see PlayerSetupPanel's identical `host` prop. loadout.tsx always passes
  // its own controlsHost here, in every game mode: this row sits in the same near/bottom zone as
  // P1's own panel, so board variant/score/difficulty need to be mutually exclusive with P1's color
  // picker (only one of them can be open at a time), and — just as importantly — P1's press-away
  // overlay only watches controlsHost.openId, so a dropdown opened on any *other* host would be
  // invisible to it and never close on an outside tap. Omit only if some future caller genuinely
  // wants this row fully independent (own host, own press-away wiring it'd have to provide itself).
  host?: PopoverHost
  boardVariant: BoardVariant
  boardVariantOptions: MenuOption<BoardVariant>[]
  onBoardVariantChange: (value: BoardVariant) => void
  // Rides along in the same popover as boardVariant, as a second (multi-select, single-item)
  // section — see the render below. A real boolean now rather than an 'on' | 'off' string: that
  // encoding only existed because the old single-select row couldn't take a raw boolean value;
  // representing it as a one-item multi-select section instead (present in the value array = on)
  // needs no such workaround, and is what gives it the checkbox-style highlight-when-on look.
  rink: boolean
  rinkOption: MenuOption<'on'>
  onRinkChange: (value: boolean) => void
  friction: FrictionLevel
  frictionOptions: MenuOption<FrictionLevel>[]
  onFrictionChange: (value: FrictionLevel) => void
  puckSize: PuckSizeLevel
  puckSizeOptions: MenuOption<PuckSizeLevel>[]
  onPuckSizeChange: (value: PuckSizeLevel) => void
  interceptSpeed: InterceptSpeed
  interceptSpeedOptions: MenuOption<InterceptSpeed>[]
  onInterceptSpeedChange: (value: InterceptSpeed) => void
  scoreToWin: number
  scoreToWinOptions: MenuOption<number>[]
  onScoreToWinChange: (value: number) => void
  shotPreviewLength: ShotPreviewLength
  shotPreviewLengthOptions: MenuOption<ShotPreviewLength>[]
  onShotPreviewLengthChange: (value: ShotPreviewLength) => void
  tipoffMode: TipoffMode
  tipoffModeOptions: MenuOption<TipoffMode>[]
  onTipoffModeChange: (value: TipoffMode) => void
  // Omitted entirely for two-player — there's no CPU to tune the difficulty of.
  aiDifficulty?: 'easy' | 'medium' | 'hard'
  aiDifficultyOptions?: MenuOption<'easy' | 'medium' | 'hard'>[]
  onAiDifficultyChange?: (value: 'easy' | 'medium' | 'hard') => void
  accentColor: string
  mutedColor: string
  onAccentColor?: string
  dark: boolean
}

// Always-upright row of shared (not per-player) settings in the loadout screen. Shares P1's popover
// host (passed in by loadout.tsx in every game mode — see the `host` prop above) rather than owning
// an independent one, so this row participates in P1's mutual-exclusivity and press-away wiring the
// same way P1's own panel does.
const OWN_IDS = ['boardVariant', 'puckPhysics', 'slapShot', 'matchRules', 'shotPreviewLength', 'aiDifficulty']

export function LoadoutSharedControls({ host: sharedHost, boardVariant, boardVariantOptions, onBoardVariantChange, rink, rinkOption, onRinkChange, friction, frictionOptions, onFrictionChange, puckSize, puckSizeOptions, onPuckSizeChange, interceptSpeed, interceptSpeedOptions, onInterceptSpeedChange, scoreToWin, scoreToWinOptions, onScoreToWinChange, shotPreviewLength, shotPreviewLengthOptions, onShotPreviewLengthChange, tipoffMode, tipoffModeOptions, onTipoffModeChange, aiDifficulty, aiDifficultyOptions, onAiDifficultyChange, accentColor, mutedColor, onAccentColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See PlayerSetupPanel's identical ownPopoverOpen comment — elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && OWN_IDS.includes(host.openId)
  const showAiDifficulty = !!(aiDifficulty && aiDifficultyOptions && onAiDifficultyChange)

  return (
    <View style={[styles.row, ownPopoverOpen && styles.rowOpen]}>
      {/* Board variant (single-select: which layout) and rink (multi-select with just one
      possible item: on or off) share one popover — rink isn't really "another board option," it's
      a toggle riding along in the same menu, styled like a multiselect row (checkbox + highlight
      when on) rather than a second radio choice. */}
      <SectionedDropdown
        id='boardVariant'
        host={host}
        icon='view-grid-outline'
        accessibilityLabel='Board'
        sections={[
          { kind: 'single', id: 'boardVariant', options: boardVariantOptions, value: boardVariant, onChange: onBoardVariantChange },
          { kind: 'multi', id: 'rink', options: [rinkOption], value: rink ? ['on'] : [], onChange: (value) => onRinkChange(value.length > 0) }
        ]}
        accentColor={accentColor}
        mutedColor={mutedColor}
        onAccentColor={onAccentColor}
        dark={dark}
      />

      {/* Friction and puck size both just govern how the puck itself physically behaves, so they
      share one popover as two 'single' sections rather than separate triggers — same mechanism as
      board+rink above, just two full single-select lists instead of a single-select plus a
      one-item toggle. autoDismiss is off here (unlike board+rink): with two real lists to browse,
      picking a value in one shouldn't snap the whole popover shut before the other's even been
      looked at — press-away or the trigger itself closes it once both are set. */}
      <SectionedDropdown
        id='puckPhysics'
        host={host}
        icon='speedometer-medium'
        accessibilityLabel='Puck physics'
        autoDismiss={false}
        sections={[
          { kind: 'single', id: 'friction', options: frictionOptions, value: friction, onChange: onFrictionChange },
          { kind: 'single', id: 'puckSize', options: puckSizeOptions, value: puckSize, onChange: onPuckSizeChange }
        ]}
        accentColor={accentColor}
        mutedColor={mutedColor}
        onAccentColor={onAccentColor}
        dark={dark}
      />

      {/* Its own standalone trigger, not folded into puckPhysics above — this isn't a physics
      tuning knob like friction/puck size, it's a distinct skill mechanic (mid-slide interception,
      see InterceptSpeed in types/index.ts), and deserves a name that says so rather than being a
      third unlabeled item buried in a "Puck physics" popover. */}
      <SectionedDropdown
        id='slapShot'
        host={host}
        icon='hockey-sticks'
        accessibilityLabel='Slap shot'
        sections={[{ kind: 'single', id: 'interceptSpeed', options: interceptSpeedOptions, value: interceptSpeed, onChange: onInterceptSpeedChange }]}
        accentColor={accentColor}
        mutedColor={mutedColor}
        onAccentColor={onAccentColor}
        dark={dark}
      />

      {/* Score to win and tip-off mode are both "how the match plays out" rules — combined for the
      same reason as puckPhysics above (and same autoDismiss={false}, for the same reason). */}
      <SectionedDropdown
        id='matchRules'
        host={host}
        icon='flag-checkered'
        accessibilityLabel='Match rules'
        autoDismiss={false}
        sections={[
          { kind: 'single', id: 'scoreToWin', options: scoreToWinOptions, value: scoreToWin, onChange: onScoreToWinChange },
          { kind: 'single', id: 'tipoffMode', options: tipoffModeOptions, value: tipoffMode, onChange: onTipoffModeChange }
        ]}
        accentColor={accentColor}
        mutedColor={mutedColor}
        onAccentColor={onAccentColor}
        dark={dark}
      />

      <SectionedDropdown id='shotPreviewLength' host={host} icon='ray-start-arrow' accessibilityLabel='Shot preview length' sections={[{ kind: 'single', id: 'shotPreviewLength', options: shotPreviewLengthOptions, value: shotPreviewLength, onChange: onShotPreviewLengthChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      {showAiDifficulty && <SectionedDropdown id='aiDifficulty' host={host} icon='chip' accessibilityLabel='CPU difficulty' sections={[{ kind: 'single', id: 'aiDifficulty', options: aiDifficultyOptions!, value: aiDifficulty!, onChange: onAiDifficultyChange! }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    // Safety net, not the primary fix — combining related pickers (see puckPhysics/matchRules
    // above) is what actually keeps this row from feeling cramped. But nothing capped its width
    // before this, and a row of fixed-size triggers with no wrap just runs off the screen edge on
    // a narrow device, taking the last trigger or two with it — untappable, not just clipped. Wrap
    // is what turns that into "drops to a second centered line" instead.
    flexWrap: 'wrap',
    // Matches LightCycles' LobbySharedControls — wider than a plain icon row would need, to give
    // each trigger's TriggerGauge arc (pulled in close around the icon itself — see TriggerGauge's
    // own ARC_GAP) room to breathe against its neighbors instead of the arcs crowding each other.
    gap: 20,
    justifyContent: 'center'
  },
  // See SectionedDropdown's anchorOpen comment — this row is itself a sibling of the player panels
  // in loadout.tsx, and React Native Web's per-view stacking contexts mean a popover escaping this
  // row's bounds needs the row itself elevated, not just the popover content, to paint above a
  // later sibling panel.
  rowOpen: {
    zIndex: 100
  }
})
