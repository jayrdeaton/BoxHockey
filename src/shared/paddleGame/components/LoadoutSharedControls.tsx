import { IconButton } from '@rific/feedback-press'
import { MenuOption, PopoverHost, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { StyleSheet, View } from 'react-native'

import { BallSpeedLevel, PaddleSizeLevel } from '@/shared/paddleGame/types'

interface Props {
  // Shared popover host - see PlayerSetupPanel's identical `host` prop. The loadout passes seat 1's
  // host here, so this row's menus and seat 1's are mutually exclusive (only one open at a time)
  // and seat 1's press-away overlay, which only watches that host's openId, closes them too.
  host?: PopoverHost
  paddleSize: PaddleSizeLevel
  paddleSizeOptions: MenuOption<PaddleSizeLevel>[]
  onPaddleSizeChange: (value: PaddleSizeLevel) => void
  ballSpeed: BallSpeedLevel
  ballSpeedOptions: MenuOption<BallSpeedLevel>[]
  onBallSpeedChange: (value: BallSpeedLevel) => void
  scoreToWin: number
  scoreToWinOptions: MenuOption<number>[]
  onScoreToWinChange: (value: number) => void
  // Omitted while the round has two people (one tilt reading can't steer two paddles, see
  // tiltControlActiveFor) and on the web (no accelerometer readings there). An explicit presence
  // check below, not a truthy one: the toggle is off by default.
  tiltControlEnabled?: boolean
  tiltControlOption?: MenuOption<'tiltControl'>
  onTiltControlEnabledChange?: (value: boolean) => void
  // Undefined while the loadout folds Randomize and Reset into its shared action band instead.
  onRandomize?: () => void
  onReset?: () => void
  accentColor: string
  mutedColor: string
  onAccentColor?: string
  dark: boolean
}

// The popover ids this row opens, so the loadout can elevate it while one is open.
export const LOADOUT_SHARED_CONTROLS_IDS = ['paddleBallPhysics', 'scoreToWin', 'tiltControl']

// The paddle games' always-upright row of match settings: paddle size and puck speed in one menu,
// score to win, and tilt steering where it applies. Paddles and Breaker share it; neither has a
// Bricks toggle (Paddles never has bricks, Breaker always does).
export function LoadoutSharedControls({ host: sharedHost, paddleSize, paddleSizeOptions, onPaddleSizeChange, ballSpeed, ballSpeedOptions, onBallSpeedChange, scoreToWin, scoreToWinOptions, onScoreToWinChange, tiltControlEnabled, tiltControlOption, onTiltControlEnabledChange, onRandomize, onReset, accentColor, mutedColor, onAccentColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // Elevated only for this row's own menus: elevating it for any open menu on a shared host would
  // tie it with the panel that really has the open menu, and DOM order would decide which paints on top.
  const ownPopoverOpen = host.openId !== null && LOADOUT_SHARED_CONTROLS_IDS.includes(host.openId)
  const showTiltControl = tiltControlEnabled !== undefined && !!tiltControlOption && !!onTiltControlEnabledChange
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
        {/* Paddle size and puck speed both govern how the paddles and puck behave, so they share
        one popover as two sections. autoDismiss is off so picking one doesn't close the popover
        before the other has been looked at; press-away or the trigger closes it. */}
        <SectionedDropdown
          id='paddleBallPhysics'
          host={host}
          icon='speedometer-medium'
          accessibilityLabel='Paddle size and puck speed'
          autoDismiss={false}
          sections={[
            { kind: 'single', id: 'paddleSize', options: paddleSizeOptions, value: paddleSize, onChange: onPaddleSizeChange },
            { kind: 'single', id: 'ballSpeed', options: ballSpeedOptions, value: ballSpeed, onChange: onBallSpeedChange }
          ]}
          accentColor={accentColor}
          mutedColor={mutedColor}
          onAccentColor={onAccentColor}
          dark={dark}
        />

        <SectionedDropdown id='scoreToWin' host={host} icon='flag-checkered' accessibilityLabel='Score to win' sections={[{ kind: 'single', id: 'scoreToWin', options: scoreToWinOptions, value: scoreToWin, onChange: onScoreToWinChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        {/* A single boolean as a one-option 'multi' section: presence in the value array is "on". */}
        {showTiltControl && <SectionedDropdown id='tiltControl' host={host} icon='screen-rotation' accessibilityLabel='Tilt Control' sections={[{ kind: 'multi', id: 'tiltControl', options: [tiltControlOption!], value: tiltControlEnabled ? [tiltControlOption!.value] : [], onChange: (value) => onTiltControlEnabledChange!(value.includes(tiltControlOption!.value)) }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Above the trigger row, smaller than the triggers, so Randomize and Reset read as quick actions
  // on the settings below rather than settings of their own (Air Hockey's and Box Hockey's row).
  actionsRow: {
    flexDirection: 'row',
    gap: 12
  },
  container: {
    alignItems: 'center',
    gap: 4
  },
  // A popover escaping the row has to paint above the later sibling panels, and React Native Web's
  // per-view stacking contexts mean the wrapper itself needs the elevation.
  containerOpen: {
    zIndex: 100
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    // Wraps to a second centered line on a narrow device instead of running off the screen edge.
    flexWrap: 'wrap',
    // Room for each trigger's gauge arc against its neighbors.
    gap: 20,
    justifyContent: 'center'
  }
})
