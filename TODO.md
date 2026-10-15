# TODO

Open fixes from the 2026-10-15 review of the 2026-10-08 fleet audit. Line numbers are as of that date. The F042, F094 and F010 fixes and `@tastic/profile` 0.12.0 landed on 2026-10-15.

## Before launch

1. **Check back after the match live.** The 2026-10-15 fixes were checked on web on 2026-10-15 (profile swap and color clash guard; see CLAUDE.md), except back after the match (F094): finish a match and confirm the back chip exits without "Quit Match?". It's the same getter AirHockey's live check passed, but a Vs CPU match needs seat 1 to shoot, which the hidden test browser couldn't do.

## Needs Jay's call

2. **Device-wide unlocks show on both seats in 2 Player** (audit F037, with F029). `broadcastDeviceUnlocks` at `src/app/game.tsx:492` puts them on the losing seat too, and the device bucket records seat 1's result. Suggested (same as Snake): show device-wide unlocks only on the winner's side, both on a draw.

## After launch

3. **Android hardware back and web browser back skip "Quit Match?"** (audit F093). Needs hud support (an opt-in `BackHandler` in `useQuitConfirmation`, plus a router-level block for web). Before an Android release; iOS is unaffected.
4. **The Update Available prompt and toasts stay portrait while the screen is turned** (audit F007). The UpdateDialog wrapper passes no `rotation`, and the Toaster sits outside any turned frame. Pass `rotation`, or mount both in hud's `RotatedFrame`.
5. **Home's hero animation keeps looping under `/loadout` and `/game`** (audit F016). Pause it on blur and in the background, as Solitaire's HeroCards does (`useIsFocused` plus AppState).
