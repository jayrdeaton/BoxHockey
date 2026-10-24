import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { type AppSettings, appSettingsActions } from '@/shell/redux/appSettingsSlice'
import type { ShellState } from '@/shell/redux/shellState'

// The one way the pack-wide settings are read and written (Lock Orientation, Edge Guard). Writes
// merge, so a patch only changes the fields it names.
export function useAppSettings(): { settings: AppSettings; setSettings: (patch: Partial<AppSettings>) => void } {
  const settings = useSelector((state: ShellState) => state.appSettings)
  const dispatch = useDispatch()
  const setSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      dispatch(appSettingsActions.initialize(patch))
    },
    [dispatch]
  )
  return { settings, setSettings }
}
