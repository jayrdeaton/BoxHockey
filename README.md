# BoxHockey

Turn-based tabletop box hockey on one screen: flick the puck through the gaps and into the other player's goal, against the CPU or a friend across the table.

BoxHockey is a physics-driven box hockey game for iOS, Android, and web. Built with Expo, React Native, and React Native Skia, it's part of a family of games built on my open-source `@tastic` game-engine and `@rific` Expo utility packages. App Store and Google Play release in progress.

<p align="center"><img src="docs/gameplay.gif" alt="BoxHockey gameplay: a face-off, then flick shots against the CPU" width="300"></p>

## Features

- **Two modes:** One Player against a CPU opponent (Easy, Medium, Hard), or Two Player pass-and-play with both people on the same device. Players take turns shooting. After a goal, Coin Flip mode hands the puck to the player who conceded, in their own zone; Face-Off and Triple Tap restart from center with a new draw.
- **Three ways to shoot, per player:** Flick (power comes from swipe speed, the default), Pull (slingshot: drag back, release to fire), or Push (drag toward the shot). Each seat picks its own, and a saved profile remembers its choice.
- **Three tip-off modes:** Face-Off, a reaction race (both players ready up, a 3-2-1 countdown runs, then one of each player's two circles lights after a random hold and the first correct tap wins the knock); Coin Flip, a tap-to-flip animation for the opening possession; and Triple Tap (touch only), where each player taps their zone twice and then swipes, and the two swipes add together into the launch.
- **Board variants and modifiers:** Classic (a center divider with two gaps), Gauntlet (three gapped walls splitting the rink into four zones), and Gravity (the classic divider plus a center attractor and four corner repellers). A Rink toggle adds rounded corners and a net pocket behind each goal on any of the three.
- **Match options:** puck speed (friction), puck size (the goal and wall gaps scale with it), score to win (3, 5, 7, or 10), an optional trajectory preview that draws predicted bank shots, and a "slap shot" setting that lets the receiving player hit a puck that's still sliding. The loadout also has randomize and reset buttons.
- **Player profiles:** saved names, colors, tags, and shot style per seat. On iOS the roster is shared with my other games through an App Group.
- **Stats and achievements:** per-profile and device-wide records (vs CPU by difficulty, two-player results by seat, wins per board variant, goals, shutouts, best win margin, win and day streaks, player rankings) and 33 bronze/silver/gold achievements.
- **How-to-play guide:** a short first-run guide, replayable from Settings, built from the live settings: the shot card describes each seat's actual control scheme and the tip-off card matches the selected mode.
- **Settings:** sound, haptics, appearance, an app-wide Lock Orientation setting, an iOS option to defer system edge gestures during play, and a manual update check. A match pauses automatically when the app goes to the background.

## Under the hood

- **Physics:** a custom puck integrator (`src/utils/physics.ts`) built on `@tastic/physics` collision primitives (circle vs. rect, circle vs. circle, rounded corners, reflection, friction, gravity wells). Fast pucks are sub-stepped to avoid tunneling, a goal only counts once the puck's whole body has crossed the line, and goalposts are round so they deflect along a curve. With Rink on, the goal mouth is a one-way door: a puck can go in and around the pocket but can't come back out the front. A shot taken at a still-moving puck adds the puck's existing velocity to the shot.
- **AI opponent by simulation:** the CPU doesn't use an angle formula. It replays candidate shots through the same `stepPhysics` the game loop runs, over a grid of angles and power levels, and scores each result: a goal (fewer bounces and a straighter line rank higher), an own goal (discarded unless every candidate is one), or where the puck stops. Difficulty sets how wide it searches, whether it tries bank shots (Hard sweeps a full circle), how much it weighs defense, its aim and power noise, and its thinking time. It plays its turn through the same aim/shoot input path a human drag uses, so the stick and preview render the same way for both.
- **Face-off resolution (`src/utils/faceoff.ts`):** the winner's knock launches from center toward the loser's goal. Two inputs drive it separately: the margin between the two presses sets the angle jitter (a close race gives a scrappier, wider knock), and the winner's own reaction time sets the power. Jitter is capped well under 90° so the knock can't head back toward the winner's own net, and the loser always takes the next real turn. Each player also gets a blind 50/50 guess at which circle will light, worth a small reaction-time bonus. The CPU's reaction times follow real human reaction-time ranges, and on Easy and Medium it sometimes taps the wrong circle.
- **Turn-based reducer:** a single `useGameState` reducer (`src/hooks/useGameState.ts`) holds every phase (aiming, striking, simulating, scored, face-off, coin flip, triple tap, game over), driven by `@tastic/core`'s game loop. Random choices (which circle lights, the coin flip winner), timestamps, and the frame delta are all passed in by the caller, so the reducer itself stays deterministic and testable.
- **Board geometry (`src/utils/board.ts`):** the goal and wall gaps are sized from the current puck radius, with more margin on larger pucks, so every tier stays makeable. On native and mobile web the board fills the screen edge to edge, so bank shots bounce off the real screen edge; desktop web fixes the board to a real box hockey table's 3.3:8 ratio and draws perimeter walls. When the device is turned upside down the board flips 180° and touch input is mapped back into board coordinates, while the menus and loadout reflow for landscape.
- **Split-screen loadout:** in two-player the loadout uses `@tastic/split-screen` to lay out both players' panels facing each other or side by side, following the device's tilt.
- **Skia rendering across platforms:** the rink, puck, posts, score wedges around each crease, goal celebrations, gravity-well swirls, and the coin flip are drawn with React Native Skia and `@tastic/sprites`. `BoardHost.web.tsx` lazy-loads the board only after CanvasKit (WASM) is ready, while the native `BoardHost.tsx` is a passthrough.
- **State and updates:** Redux Toolkit with redux-persist covers settings, profiles, seat colors, per-profile shot style, stats, achievements, and guide state, with per-round state left out of persistence. A persist `migrate` recognizes players from the pre-Redux build so they skip the guide. Over-the-air updates ship through `expo-updates` and `@rific/updater`.
- **Tests:** 16 Jest suites with 298 tests covering physics and rink geometry, the AI planner, face-off knocks, the slap-shot intercept path, Triple Tap sequencing, a turn-alternation fuzz test, stats and achievements, settings and guide persistence, background pause, and profile syncing.

## Built on

| Package | Used for |
| --- | --- |
| [`@tastic/core`](https://github.com/jayrdeaton/React-Native-Game-Core) | Game loop, orientation and rotation handling, settled window sizing for the web canvas, background pause, config plugin for the native portrait lock |
| [`@tastic/physics`](https://www.npmjs.com/package/@tastic/physics) | Circle/rect/rounded-corner collision, reflection, friction, gravity wells, goal-wedge geometry |
| [`@tastic/input`](https://www.npmjs.com/package/@tastic/input) | Drag-to-aim vector math |
| [`@tastic/split-screen`](https://www.npmjs.com/package/@tastic/split-screen) | Two-player loadout zone layout (face-to-face vs side-by-side) |
| [`@tastic/hud`](https://www.npmjs.com/package/@tastic/hud) | Player setup panels, dropdowns, settings, confirm and update dialogs, stats screen sections, how-to-play guide, Skia web loader |
| [`@tastic/sprites`](https://www.npmjs.com/package/@tastic/sprites) | Skia board shapes, hockey rink visuals (score wedges, goal-door flash, zone lines), gravity-well swirl |
| [`@tastic/profile`](https://www.npmjs.com/package/@tastic/profile) | Player profiles, picker, roster screen, per-profile extensions, shared App Group sync |
| [`@tastic/achievements`](https://www.npmjs.com/package/@tastic/achievements) | Tiered achievement catalog, streak tracking, Redux-backed persistence |
| [`@tastic/edge-guard`](https://www.npmjs.com/package/@tastic/edge-guard) | Optional guard against iOS edge system gestures during play |
| [`@rific/core`](https://www.npmjs.com/package/@rific/core) | Redux settings slice factory, safe back navigation |
| [`@rific/auto-paper`](https://www.npmjs.com/package/@rific/auto-paper) | React Native Paper theming from seed colors, light/dark appearance |
| [`@rific/feedback-press`](https://www.npmjs.com/package/@rific/feedback-press) | Buttons with haptic and sound feedback, vibration, game sounds |
| [`@rific/toaster`](https://www.npmjs.com/package/@rific/toaster) | Toast notifications (achievement unlocks, update errors) |
| [`@rific/splash-gate`](https://www.npmjs.com/package/@rific/splash-gate) | Keeps the splash screen up until fonts, theme, and profiles are ready |
| [`@rific/updater`](https://www.npmjs.com/package/@rific/updater) | OTA update checks and the build/update scripts |
| [`@rific/focus-chain`](https://www.npmjs.com/package/@rific/focus-chain) | Peer dependency of `@tastic/profile` for form focus |

## Getting started

```bash
npm install
npm run ios        # or: npm run android / npm start (web)
```

The app uses native code and config plugins that Expo Go doesn't include (the `@tastic/core` and `@tastic/edge-guard` config plugins and `@tastic/profile`'s native iOS shared-roster module), so iOS and Android run as a development build (`expo-dev-client`). `npm run ios` and `npm run android` build it locally; `npm run client` starts the dev server for an already-installed build. `npm install` also runs `setup-skia-web`, which sets up CanvasKit for the web target.

### Checks

```bash
npm run verify     # lint (expo lint) + Jest + typecheck (tsc)
```

## Project layout

```
src/
  app/          expo-router screens: home, loadout, game, profiles, achievements
  components/   board rendering, gravity-well marker, loadout controls, dialogs, theme, guide host and art
  constants/    game tuning, achievement catalog, guide steps, fonts, release info
  hooks/        game state reducer and loop, AI opponent, face-off and Triple Tap timers, profiles, stats, settings, sound
  redux/        redux-persist store and slices (settings, profiles, seat colors, achievements, guide, live play)
  types/        shared TypeScript types
  utils/        physics, board geometry, AI, face-off knock, game mode helpers, stats engine and validation
  __tests__/    Jest suites
  __mocks__/    manual mocks for native and Expo modules
```

## License

The code is released under the MIT License, see [LICENSE](LICENSE).

The game's name, logo, and icons, and the original artwork and audio in this repository, are not covered by that license and remain all rights reserved. If you fork it, please give your version its own name and look.
