# App Store

Everything the iOS listing needs. The text lives in `store.config.json` (repo root), which `eas metadata:push` sends to App Store Connect. The rest is set by hand in App Store Connect once and carries over to later versions.

## Pushed by EAS Metadata (`store.config.json`)

Title (`BoxHockeyTastic`), subtitle, promotional text, description, keywords, marketing/support/privacy URLs, copyright, categories (Games > Sports, Casual) and the age rating answers (all None, so 4+).

```bash
eas metadata:lint
```

```bash
eas metadata:push
```

`push` needs the app record to exist in App Store Connect and edits its editable version, numbered from `store.config.json`'s `apple.version`. Keep that equal to `app.json`'s `expo.version` and bump both every release: without it push fails with "missing versionString" and quietly skips the copyright, promotional text, description, keywords and the support/marketing URLs. The first `eas submit` creates the record (named by `eas.json`'s `submit.production.ios.appName`) when you sign in with your Apple ID. Apple's API can't create apps, so with an API key create it first: My Apps > + > New App, bundle ID `com.infinitetoken.BoxHockey`, name `BoxHockeyTastic`, primary language English (U.S.).

Limits: title 30, subtitle 30, promotional text 170 (editable any time without review), description 4000, keywords 100 in total with the commas. Keywords don't repeat words already in the title or subtitle ("tabletop", "box", "hockey", "ads" are indexed from the subtitle; "BoxHockeyTastic" is one word, so it does NOT match a search for "hockey" on its own).

The description names the three ways to tip off, the three boards and Rink, and 33 achievements (`src/constants/achievements.ts`). It says "from a fast flick to a slingshot pull" rather than counting the shot styles, so it stays true whether Stick ships or not. Recheck those if any of them change.

`releaseNotes` (What's New) is left out for the first version, which has none. Add it to `info.en-US` for every later version.

## Screenshots (uploaded by hand)

Three sets, same five shots and captions in each:

- `store/screenshots/iphone-medium/` (1206x2622): **required.** App Store Connect's iPhone slot is "iPhone with Dynamic Island (medium display)", labelled 6.1"/6.3", and only takes 1206x2622 or 1179x2556; a 1320x2868 file there fails with "File dimensions are invalid" (Apple changed this in 2026). Composed from the same 6.9" captures, scaled.
- `store/screenshots/iphone/` (6.9", 1320x2868): optional slot.
- `store/screenshots/ipad/` (13", 2064x2752): required because `ios.supportsTablet` is on.

Check Apple's [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications) before each release. iPhone Duo (the foldable) gets its own optional slot, required from April 2027 for builds on the iOS 27.1 SDK or later: capture it on a Duo simulator once Xcode has one, never scaled from these. The order in the folder is the upload order; the first three are what search results show.

The PNGs are build output and are gitignored, along with the raw captures they were made from (`store/screenshots/raw/`). The captions are in `store/screenshots.json`.

How they were made (2026-10-18, with 01-play recaptured on Classic and the face-off shot dropped on 2026-10-20): a Release build on the iPhone 17 Pro Max and iPad Pro 13" (M5) simulators, status bar pinned to 9:41 with full battery, dark appearance. The saved data was written before first launch (sound off, guide seen, Sam and Riley's profiles, and three weeks of stats and achievements from 53 matches played out on the app's own physics, CPU planner and face-off knock), so every number on the Stats screen is one the app produced. The in-play and goal shots are frames from screen recordings of real matches (Classic against the CPU on Hard, and Classic in Two Player). The store leads with Classic everywhere: Gravity is still close to experimental, so it is not in the first shot or the search art. A compositor puts each capture under its caption in SF Mono Bold (the closest file to the app's Menlo, which macOS only ships as a `.ttc` the compositor can't pick a weight from), on black. The tools (simulator setup, the slim build, frame picking, the compositor) are in Jay's `app-store-prep` skill; the BoxHockey-specific seeding is here in `store/seed/`.

To redo them:

1. `node store/seed/generate.mjs` (writes `store/seed/seed.json`, gitignored)
2. Build and install a Release copy on the `AppStore iPhone 6.9` and `AppStore iPad 13` simulators (the skill's `sim-build.sh` and `sim-setup.sh --app`)
3. `store/seed/reseed.sh <udid> [options]` on each, then capture into `store/screenshots/raw/<device>/<name>.png`:
   - **01-play:** `--difficulty hard` (Classic, Rink off), One Player, Ready, ready up for the face-off, record, then flick a shot up through a gap; use a frame with the puck in flight and no touch ring showing
   - **02-home:** Home as it opens
   - **03-goal:** `--mode twoPlayer`, Two Player, both Ready, record, and score (you play both seats, so line up a straight shot when the puck stops in the other player's zone); use the frame where the whole board flashes and the crease lights, about 0.1 s after the puck crosses the line
   - **04-boards:** `--mode twoPlayer`, Two Player, tap the board dial (the first one)
   - **05-stats:** the trophy on Home, scrolled to the Activity box and the first achievements
4. The skill's `compose.mjs store/screenshots.json` (writes all three sets)
5. Clear Sam and Riley out of the simulators' shared Tastic roster, or Solitaire's next reshoot on them shows them too: BoxHockey copies its seeded profiles into the empty App Group (`@tastic/profile`'s `resolveInitialProfiles`). Shut both simulators down, then remove `sharedProfiles` from `group.com.infinitetoken.tastic.plist` in each one's `data/Containers/Shared/AppGroup/<id>/Library/Preferences/` (`plutil -remove sharedProfiles <plist>`)

The seed writes `pucktastic:root` with the pack's store keys (`boxhockeySettings`, `boxhockeyAchievements`, `opponent` and so on), which only PuckTastic builds (from 2026-10-24) read: on an older install the app ignores it and opens with sound on and How to Play unseen, so rebuild first.

Simulator notes from this run: a fresh launch after `reseed.sh` (or after a reboot) can sit on the splash for a minute or two, and `simctl launch` can block that long, so run it in the background. The simulator's touch ring shows in screen recordings for a moment after each tap or swipe. The recorder only writes a frame when the screen changes, so on a still Classic board the skill's `frames.mjs` sheet and grab disagree on timestamps; pull the exact frame with ffmpeg's `select` instead.

## Header and search results art (uploaded by hand, optional, iOS 27+)

`store/screenshots/header.png` (3840 x 1646) and `store/screenshots/search.png` (3840 x 2560), gitignored like the screenshots. `node store/creative/build.mjs` draws both. Board.tsx is Skia, which doesn't render outside the app, so the header is an SVG redraw of Board's own shapes from the app's real geometry and colors, not a bundled `Board`: `computeBoardLayout` on the iPhone 17 Pro Max layout (Classic, medium puck, Rink off), `faceoffZoneCenters`, `computeGoalWedges`, `DEFAULT_SEAT_COLORS` (`src/shell/seatColors.ts`) and Board's dark-mode white walls and lines, with the perimeter walls Board draws on desktop web.

- **Header:** the whole box on its side, red end left and blue end right, red on match point (4 of 5 arcs lit), and the puck just through a divider hole on its way into the blue goal, with fading copies of where it was. The flight is a real shot played out on `stepPhysics` (the script fails if it ever stops scoring). No words: the app's name sits right under it.
- **Search results:** "Tabletop Box Hockey / Play a Friend or the CPU" in SF Mono Bold (the screenshots' caption font) beside the in-play capture in a phone (`store/screenshots/raw/iphone/01-play.png`, so take the screenshots first).

Each comes with `-safe.png` (the safe area from Apple's templates outlined) and `-384.png` (about a search card's size on a phone). They are rendered through the app-store-prep skill's `creative.mjs`, which checks the size and strips any alpha channel.

Upload in the version's Product Page Information > Header and Search Results (Header, then Search Results), then check both with Preview (iPhone and iPad, both orientations). The header has no words, so it can go on every localization; the search image's words are English, so it goes on English only. They're reviewed with the version, or on their own through Asset Library. EAS Metadata can't push them.

## Set by hand in App Store Connect

**App Privacy:** "No, we don't collect data from this app" (Data Not Collected). Nothing leaves the device except the Expo update check, which carries no personal data (the app version, platform and a random installation ID used to serve the right update), and there is no tracking, so no App Tracking Transparency prompt either. This matches the privacy policy at https://games.infinitetoken.com/privacy. Revisit it if analytics, crash reporting, ads or accounts are ever added.

**App Review Information:** sign-in not required. Contact: name, email and phone (the phone stays out of `store.config.json`, which is public). Notes:

> No account or sign-in is needed, and there are no in-app purchases or ads.
>
> One Player plays the CPU; Two Player is two people on one device, sitting across from each other, so the far player's controls are upside down on purpose. Players take turns: swipe fast anywhere on the screen to shoot the puck the way you swipe.
>
> A match starts with a face-off, and so does play after every goal: both players tap their own half to get ready, then the first to tap their circle that lights up wins the draw. Against the CPU only your half needs a tap.
>
> The app turns its own screen using the motion sensor, so the system orientation stays portrait and the app runs full screen on iPad. Lock Orientation is in Settings (the cog on the Home screen).
>
> Player profiles are shared through an App Group with other Tastic games by the same developer, if any are installed. No profile, progress or other game data leaves the device.
>
> On first launch a three-card How to Play guide appears. Tap Skip to go straight to the menu.

**Content Rights:** no third-party content to declare beyond what ships with the platform and the open-source libraries: the sounds and art are original (the sounds are the generated "soft" set made for the Tastic games), the icons are Material Design Icons (Apache 2.0, through `@expo/vector-icons`), and the type is the system fonts (SF and Menlo).

**Pricing and Availability:** Free, all territories.

**Export compliance:** already answered by `ITSAppUsesNonExemptEncryption: false` in `app.json`, so App Store Connect doesn't ask.

**Accessibility (optional):** leave blank until each feature has been checked on a device. Apple asks per feature (VoiceOver, Larger Text, Dark Interface, Reduced Motion and so on), and a claim that doesn't hold up is worse than none.

**Version release:** automatic after approval, or manual (you press Release). Manual is the safer choice for the first version.

## Shipping a version

1. `npm run verify`
2. `npm run build -- --profile production --platform ios`
3. `eas submit -p ios --profile production` (uploads the build to TestFlight)
4. `eas metadata:push`
5. Upload the screenshots if they changed
6. In App Store Connect: pick the build, fill in anything new above, and Add for Review
