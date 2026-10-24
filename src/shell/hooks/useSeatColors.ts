import { getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { avoidSeatColorClash, profileSeatColor } from '@tastic/profile'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { Action, Dispatch } from 'redux'

import { useProfiles } from '@/shell/hooks/useProfiles'
import { seatColorsActions } from '@/shell/redux/seatColorsSlice'
import type { ShellState } from '@/shell/redux/shellState'
import { DEFAULT_SEAT_COLORS } from '@/shell/seatColors'
import type { Seat } from '@/shell/types'

// What @tastic/profile's avoidSeatColorClash moves seat 2 to when both seats land on one color: a
// profile picked for one seat can be saved as the other seat's color, with no swap step behind it.
const SEAT_DEFAULT_COLORS = [DEFAULT_SEAT_COLORS[1], DEFAULT_SEAT_COLORS[2]] as const

// Both seats' live colors (the theme's primary and secondary) and the handlers that change them,
// for Home's who's-playing button and the loadout's seat buttons. `p2IsHuman` says whether seat 2
// is a person (a guest or a profile) or the CPU, which decides where seat 2's color comes from.
export function useSeatColors(p2IsHuman: boolean) {
  const { colors: themeColors } = useAutoPaperTheme()
  const { set: setThemeColor } = useThemeSettings()
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary
  const { profiles, lastSelected } = useProfiles()

  // Typed explicitly because @tastic/profile's action creators return a plain `{ payload, type }`
  // interface with no index signature, which react-redux's default Dispatch<UnknownAction> rejects.
  const dispatch = useDispatch<Dispatch<Action>>()
  // A seat's live color comes from one of three independently-remembered places depending on what's
  // in that seat - a selected profile's pick in this pack (or its own saved color without one), the
  // CPU's own remembered color, or a guest's own remembered color - all in the `seatColors` slice
  // (seatColorsSlice.ts). A profile's own saved color is never written back to; only the Profiles
  // screen edits it.
  const guestColors = useSelector((state: ShellState) => state.seatColors.lastGuestColor)
  const cpuColor = useSelector((state: ShellState) => state.seatColors.lastCpuColor)
  // Each profile's own color pick in this pack, by profile id, read through @tastic/profile's
  // profileSeatColor. It follows the profile, not the seat: kept through a switch to another profile
  // and back, a move to the other seat, and a relaunch.
  const profileColors = useSelector((state: ShellState) => state.seatColors.profileColors)

  const p1Profile = profiles.find((p) => p.id === lastSelected[1]) ?? null
  const p2Profile = p2IsHuman ? (profiles.find((p) => p.id === lastSelected[2]) ?? null) : null

  // Mirrored for the focus effect below, so it can read each seat's current profile and remembered
  // colors without depending on them (profiles is a new array on every useProfiles() render, and
  // useFocusEffect re-runs whenever its callback's identity changes, even while still focused).
  const p1ProfileRef = useRef(p1Profile)
  const p2ProfileRef = useRef(p2Profile)
  const guestColorsRef = useRef(guestColors)
  const cpuColorRef = useRef(cpuColor)
  const profileColorsRef = useRef(profileColors)
  useEffect(() => {
    p1ProfileRef.current = p1Profile
  }, [p1Profile])
  useEffect(() => {
    p2ProfileRef.current = p2Profile
  }, [p2Profile])
  useEffect(() => {
    guestColorsRef.current = guestColors
  }, [guestColors])
  useEffect(() => {
    cpuColorRef.current = cpuColor
  }, [cpuColor])
  useEffect(() => {
    profileColorsRef.current = profileColors
  }, [profileColors])

  // Keeps each seat's live theme color matching what it's supposed to be right now: on mount, and
  // when a seat's profile changes (a pick, the swap when a seat picks the other seat's profile, or a
  // deletion from Manage), when seat 2 changes between the CPU and a person, when a profile's pick
  // changes, and when the roster resolves. profiles itself is read, not depended on (a new array on
  // every render); profiles.length stands in as a coarse "profiles finished loading" signal.
  useEffect(() => {
    const nextP1 = p1Profile ? profileSeatColor(p1Profile, profileColors) : guestColors[1]
    const nextP2 = avoidSeatColorClash(nextP1, p2Profile ? profileSeatColor(p2Profile, profileColors) : p2IsHuman ? guestColors[2] : cpuColor, SEAT_DEFAULT_COLORS)
    if (nextP1.toLowerCase() === p1Color.toLowerCase() && nextP2.toLowerCase() === p2Color.toLowerCase()) return
    setThemeColor({ color: { primary: nextP1, secondary: nextP2, tertiary: getThirdColor(nextP1, nextP2) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelected[1], lastSelected[2], p2IsHuman, guestColors, cpuColor, profileColors, profiles.length])

  // The loadout pushes the play screen and Profiles on top of itself and comes back via
  // router.back()/safeBack() - a pop that reveals this same, still-mounted screen. On every focus
  // regain, re-derive each seat's live color from its authoritative source, so editing a profile's
  // own color on the Profiles screen is picked up the instant you're back (a new color for the
  // profile drops its pick, see profileSeatColor). Keyed only on what is a real reason to reapply;
  // everything else is read through the refs above.
  useFocusEffect(
    useCallback(() => {
      const guest = guestColorsRef.current
      const cpu = cpuColorRef.current
      const p1Prof = p1ProfileRef.current
      const p2Prof = p2ProfileRef.current
      const picks = profileColorsRef.current
      const nextP1 = p1Prof ? profileSeatColor(p1Prof, picks) : guest[1]
      const nextP2 = avoidSeatColorClash(nextP1, p2Prof ? profileSeatColor(p2Prof, picks) : p2IsHuman ? guest[2] : cpu, SEAT_DEFAULT_COLORS)
      setThemeColor({ color: { primary: nextP1, secondary: nextP2, tertiary: getThirdColor(nextP1, nextP2) } })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSelected[1], lastSelected[2], p2IsHuman, setThemeColor])
  )

  // Routes a seat's just-changed color to whichever slot owns it right now - kept as that profile's
  // pick in this pack (the pack's caption on the seat button's Color row) when a profile's in the
  // seat. Picking the profile's own color drops the pick.
  const persistSeatColor = useCallback(
    (seat: Seat, hex: string) => {
      const profile = seat === 1 ? p1Profile : p2Profile
      if (profile) {
        dispatch(seatColorsActions.setProfileColor({ profile, color: hex }))
        return
      }
      if (seat === 2 && !p2IsHuman) {
        dispatch(seatColorsActions.setLastCpuColor(hex))
        return
      }
      dispatch(seatColorsActions.setLastGuestColor({ seat, color: hex }))
    },
    [p1Profile, p2Profile, p2IsHuman, dispatch]
  )

  // Picking the other seat's exact current color swaps the two instead of no-op'ing - only reachable
  // where that picker allows it (allowSwapTaken: against the CPU only, where the other color is the
  // CPU's, not a second person's choice). Each side of a swap persists by its own seat's rule above.
  const handleP1ColorChange = useCallback(
    (hex: string) => {
      const swapped = hex.toLowerCase() === p2Color.toLowerCase()
      const nextP2 = swapped ? p1Color : p2Color
      setThemeColor({ color: { primary: hex, secondary: nextP2, tertiary: getThirdColor(hex, nextP2) } })
      persistSeatColor(1, hex)
      if (swapped) persistSeatColor(2, nextP2)
    },
    [setThemeColor, p1Color, p2Color, persistSeatColor]
  )
  const handleP2ColorChange = useCallback(
    (hex: string) => {
      const swapped = hex.toLowerCase() === p1Color.toLowerCase()
      const nextP1 = swapped ? p2Color : p1Color
      setThemeColor({ color: { primary: nextP1, secondary: hex, tertiary: getThirdColor(nextP1, hex) } })
      persistSeatColor(2, hex)
      if (swapped) persistSeatColor(1, nextP1)
    },
    [setThemeColor, p1Color, p2Color, persistSeatColor]
  )

  return { p1Color, p2Color, handleP1ColorChange, handleP2ColorChange }
}
