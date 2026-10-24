import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { settingsActions } from '@/games/airhockey/redux/settingsSlice'
import type { Settings } from '@/games/airhockey/types'

// Air Hockey's own settings (the loadout's match options and each seat's controls). Writes merge,
// so a patch only changes the fields it names.
export function useSettings(): { settings: Settings; setSettings: (patch: Partial<Settings>) => void } {
  const settings = useSelector((state: { airhockeySettings: Settings }) => state.airhockeySettings)
  const dispatch = useDispatch()
  const setSettings = useCallback(
    (patch: Partial<Settings>) => {
      dispatch(settingsActions.initialize(patch))
    },
    [dispatch]
  )
  return { settings, setSettings }
}
