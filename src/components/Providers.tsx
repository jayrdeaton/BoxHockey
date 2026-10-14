import { FeedbackPressProvider, hapticActions, type HapticSettings, soundActions, type SoundSettings, useFeedbackBridgeProps } from '@rific/feedback-press'
import { useAudioPool } from '@rific/feedback-press/audio'
import { useEdgeGestureGuard } from '@tastic/edge-guard'
import { ReactNode, useCallback } from 'react'
import * as RNPaper from 'react-native-paper'
import { Provider as ReduxProvider, useDispatch, useSelector } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import { persistor, type RootState, store } from '@/redux/store'

interface Props {
  children: ReactNode
}

// Redux-backed haptic/sound settings, dispatching through @rific/feedback-press's own
// hapticActions/soundActions - same shape as Expo-Starter/Snake's FeedbackBridge, converged onto
// fleet-wide rather than this app's old direct-AsyncStorage version.
const FeedbackBridge = ({ children }: Props) => {
  const haptic = useSelector((state: RootState) => state.haptic)
  const sound = useSelector((state: RootState) => state.sound)
  const dispatch = useDispatch()
  const onChange = useCallback((next: HapticSettings) => dispatch(hapticActions.initialize(next)), [dispatch])
  const onSoundChange = useCallback((next: SoundSettings) => dispatch(soundActions.initialize(next)), [dispatch])

  // Generic UI feedback sounds, wired into every Button/IconButton/etc. in the package (see
  // useFeedbackHandlers' `fire`, which already gates these on the sound-enabled setting itself -
  // no need to re-check it here).
  const playSelection = useAudioPool(require('../../assets/sounds/select.wav'))
  const playNotification = useAudioPool(require('../../assets/sounds/notification.wav'))

  const bridgeProps = useFeedbackBridgeProps({ initialValue: haptic, onChange, soundInitialValue: sound, onSoundChange, sound: { selection: playSelection, notification: playNotification } })

  return (
    <FeedbackPressProvider {...bridgeProps} paper={RNPaper}>
      {children}
    </FeedbackPressProvider>
  )
}

// The one place @tastic/edge-guard's hook is called, mounted once for the app's lifetime rather than
// per screen. settings.deferBottomEdgeGestures is the player's opt-in; liveplay.activelyPlaying is
// /game's report that a live round is in progress right now (see liveplaySlice.ts). Combining them
// here keeps Edge Guard both opt-in and scoped to actual play.
const EdgeGuardBridge = ({ children }: Props) => {
  const deferBottomEdgeGestures = useSelector((state: RootState) => state.settings.deferBottomEdgeGestures)
  const activelyPlaying = useSelector((state: RootState) => state.liveplay.activelyPlaying)
  useEdgeGestureGuard(deferBottomEdgeGestures && activelyPlaying)
  return <>{children}</>
}

export function Providers({ children }: Props) {
  return (
    <ReduxProvider store={store}>
      <PersistGate persistor={persistor}>
        <EdgeGuardBridge>
          <FeedbackBridge>{children}</FeedbackBridge>
        </EdgeGuardBridge>
      </PersistGate>
    </ReduxProvider>
  )
}
