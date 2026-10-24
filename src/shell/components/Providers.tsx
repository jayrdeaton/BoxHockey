import { keepAwakeActions, KeepAwakeProvider, type KeepAwakeSettings } from '@rific/core'
import { FeedbackPressProvider, hapticActions, type HapticSettings, soundActions, type SoundSettings, useFeedbackBridgeProps } from '@rific/feedback-press'
import { useAudioPool } from '@rific/feedback-press/audio'
import { useEdgeGestureGuard } from '@tastic/edge-guard'
import * as ExpoKeepAwake from 'expo-keep-awake'
import { ReactNode, useCallback } from 'react'
import * as RNPaper from 'react-native-paper'
import { Provider as ReduxProvider, useDispatch, useSelector } from 'react-redux'
import type { Persistor } from 'redux-persist'
import { PersistGate } from 'redux-persist/integration/react'

import type { PackStore } from '@/shell/redux/createPackStore'
import type { ShellState } from '@/shell/redux/shellState'

interface Props {
  children: ReactNode
}

// Redux-backed haptic/sound settings, dispatching through @rific/feedback-press's own
// hapticActions/soundActions - same shape as Expo-Starter/Snake's FeedbackBridge, converged onto
// fleet-wide rather than this app's old direct-AsyncStorage version.
const FeedbackBridge = ({ children }: Props) => {
  const haptic = useSelector((state: ShellState) => state.haptic)
  const sound = useSelector((state: ShellState) => state.sound)
  const dispatch = useDispatch()
  const onChange = useCallback((next: HapticSettings) => dispatch(hapticActions.initialize(next)), [dispatch])
  const onSoundChange = useCallback((next: SoundSettings) => dispatch(soundActions.initialize(next)), [dispatch])

  // Generic UI feedback sounds, wired into every Button/IconButton/etc. in the package (see
  // useFeedbackHandlers' `fire`, which already gates these on the sound-enabled setting itself -
  // no need to re-check it here).
  const playSelection = useAudioPool(require('../../../assets/sounds/select.wav'))
  const playNotification = useAudioPool(require('../../../assets/sounds/notification.wav'))

  const bridgeProps = useFeedbackBridgeProps({ initialValue: haptic, onChange, soundInitialValue: sound, onSoundChange, sound: { selection: playSelection, notification: playNotification } })

  return (
    <FeedbackPressProvider {...bridgeProps} paper={RNPaper}>
      {children}
    </FeedbackPressProvider>
  )
}

// The one place @tastic/edge-guard's hook is called, mounted once for the app's lifetime rather than
// per screen. appSettings.deferBottomEdgeGestures is the player's opt-in; liveplay.activelyPlaying is
// a play screen's report that a live round is in progress right now (see liveplaySlice.ts). Combining them
// here keeps Edge Guard both opt-in and scoped to actual play.
const EdgeGuardBridge = ({ children }: Props) => {
  const deferBottomEdgeGestures = useSelector((state: ShellState) => state.appSettings.deferBottomEdgeGestures)
  const activelyPlaying = useSelector((state: ShellState) => state.liveplay.activelyPlaying)
  useEdgeGestureGuard(deferBottomEdgeGestures && activelyPlaying)
  return <>{children}</>
}

// @rific/core's Keep Awake setting (Settings dialog), persisted as the store's `keepAwake` slice.
// Handing it expo-keep-awake is what turns the feature on: each play screen's useKeepAwake('game') and hud's
// Keep Awake row both read the module from here.
const KeepAwakeBridge = ({ children }: Props) => {
  const keepAwake = useSelector((state: ShellState) => state.keepAwake)
  const dispatch = useDispatch()
  const onChange = useCallback((settings: KeepAwakeSettings) => dispatch(keepAwakeActions.initialize(settings)), [dispatch])
  return (
    <KeepAwakeProvider expoKeepAwake={ExpoKeepAwake} initialValue={keepAwake} onChange={onChange}>
      {children}
    </KeepAwakeProvider>
  )
}

interface ProvidersProps extends Props {
  store: PackStore
  persistor: Persistor
}

export function Providers({ store, persistor, children }: ProvidersProps) {
  return (
    <ReduxProvider store={store}>
      <PersistGate persistor={persistor}>
        <EdgeGuardBridge>
          <FeedbackBridge>
            <KeepAwakeBridge>{children}</KeepAwakeBridge>
          </FeedbackBridge>
        </EdgeGuardBridge>
      </PersistGate>
    </ReduxProvider>
  )
}
