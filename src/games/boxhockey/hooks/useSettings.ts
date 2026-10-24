import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { settingsActions } from '@/games/boxhockey/redux/settingsSlice'
import type { Settings } from '@/games/boxhockey/types'

// Box Hockey's own settings (the loadout's match options and each seat's shot style). Writes merge,
// so a patch only changes the fields it names.
export function useSettings(): { settings: Settings; setSettings: (patch: Partial<Settings>) => void } {
  const settings = useSelector((state: { boxhockeySettings: Settings }) => state.boxhockeySettings)
  const dispatch = useDispatch()
  const setSettings = useCallback(
    (patch: Partial<Settings>) => {
      dispatch(settingsActions.initialize(patch))
    },
    [dispatch]
  )
  return { settings, setSettings }
}
