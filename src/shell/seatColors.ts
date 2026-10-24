import type { Seat } from '@/shell/types'

// Player 1's and player 2's own default colors. They seed both the pack's default theme triad (see
// createPackStore.ts, which feeds them to @rific/auto-paper's createThemeReducer as primary/
// secondary, tertiary derived via getThirdColor) and the guest/CPU colors a fresh install starts
// with (see seatColorsSlice.ts), so a fresh install's live theme and its remembered colors agree.
// Also what @tastic/profile's avoidSeatColorClash moves seat 2 to when both seats land on one color.
export const DEFAULT_SEAT_COLORS: Record<Seat, string> = { 1: '#f44336', 2: '#2196f3' }
