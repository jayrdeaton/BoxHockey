# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# BoxHockey

A digital BoxHockey game (Expo/React Native, Skia-rendered). Part of the `@rific`/`@tastic`/InfiniteToken app ecosystem — depends on `@rific/auto-paper`, `@rific/feedback-press`, `@rific/focus-chain`, `@rific/splash-gate`, `@rific/toaster`, `@rific/updater`, `@tastic/animations` (the `./gravity` subpath only, for the gravity-well particle-swirl visual — see `src/components/GravityWellMarker.tsx`), `@tastic/core`, `@tastic/hud`, `@tastic/input`, `@tastic/physics`, `@tastic/profile`, `@tastic/split-screen`. The gravity well's *force* math (`applyGravityWells`, bounded quadratic falloff) stays in `@tastic/physics` — only the cosmetic particle-swirl rendering moved to `@tastic/animations`; the two packages compose at this app's own call sites, neither depends on the other.

**Expo has changed.** Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code — don't rely on general Expo knowledge, this app is on SDK 57 specifically.

## Commands

```bash
npm run lint          # expo lint .
npm run fix            # expo lint . --fix
npm test               # Jest (7 suites, 184 tests)
npm run test:watch     # Jest --watchAll
npm run typecheck      # tsc
npm run verify         # lint + test + typecheck
npm run doctor         # expo install --fix && expo-doctor
npm start              # Expo dev server
npm run client          # Expo dev server (dev client build)
```

Always run `npm run lint` before finishing any task. This is an app (`"private": true`, no publish scripts) — `verify` doesn't include a build step.

`build:development`/`build:preview`/`build:production` and `update` (which `update:development`/`update:preview`/`update:production` delegate to) are each gated behind `verify` by prefixing `npm run verify && ` directly onto the script's own definition, same as every other migrated app — see Swirlio's CLAUDE.md for the full reasoning (not redundant with CI, since EAS builds/OTA updates have no GitHub Action step to catch this the way `publish.yml` does; inline chaining rather than a separate `pre<script>` hook, since these are scripts we author ourselves, not builtin npm commands).

## Tooling

Onboarded onto the shared `@infinitetoken` config packages (`eslint-config`, `jest-config`, `tsconfig`) — previously hand-rolled its own `eslint-config-expo`-based config, `jest-expo`-preset-direct config, and `expo/tsconfig.base`-extending tsconfig (the same pattern documented in [Swirlio](../Swirlio/.claude/CLAUDE.md)'s and [LightCycles](../LightCycles/.claude/CLAUDE.md)'s CLAUDE.md, which this migration followed).

`npx expo install --fix` + `npm update` were run as part of this pass too (`expo install --fix` genuinely found something here — `expo`/`expo-updates` were a patch behind) — confirmed clean afterward: `npx expo install --check` reports up to date, `npm outdated` shows `Current === Wanted` for every dependency (remaining `Latest` values are all major bumps outside declared ranges, a deliberate-upgrade decision, not routine maintenance).

- `eslint.config.cjs` — `@infinitetoken/eslint-config/expo`, no local override (see below)
- `tsconfig.json` — `extends: "@infinitetoken/tsconfig/expo"`, keeps only the path-valued local bits (`paths`, `include`), plus two narrow `@shopify/react-native-skia` redirects (see below)
- `jest.config.cjs` — `@infinitetoken/jest-config/expo`, no options at all — `jest.setup.cjs` and `roots` are both auto-detected/defaulted (see below)

**`jest.config.ts` became `jest.config.cjs`, matching every non-Expo project in the fleet — no more `ts-node` gotchas.** This app (like every other Expo app) originally had `jest.config.ts` while every library/kit package used `.cjs` — a real divergence, not a justified one. `.ts` needed `import type {Config} from 'jest'` + a typed `const config: Config = ...` (a bare `export default createExpoJestConfig(...)` fails `tsc`'s declaration-emit check), plus a separate non-extending `tsconfig.jest.json` wired in via `TS_NODE_PROJECT=./tsconfig.jest.json` on `test`/`test:watch` (`ts-node`, Jest's `.ts`-config loader, can't resolve a tsconfig `extends` through a package's `exports` map at all). None of that exists for `.cjs` — plain `require()`, no transpilation, nothing to typecheck. Converting removed `tsconfig.jest.json`, the `TS_NODE_PROJECT` prefix on both scripts, and the `ts-node` devDependency entirely — see `@infinitetoken/jest-config`'s own README ("Why `.cjs`, not `.ts`") for the full history.

**`prettier.config.js` was deleted — `package.json` now has `"prettier": "@infinitetoken/eslint-config/prettier"` instead**, same as every library/kit package. The local file was a byte-for-byte duplicate of the shared package's own `prettier.cjs`; every Expo app had independently copy-pasted it rather than referencing the shared one.

**`metro.config.js` was deleted — it was unmodified `getDefaultConfig(__dirname)` boilerplate doing nothing.** Confirmed by removing it and running `npx expo export -p web`: builds cleanly, `canvaskit.wasm` still lands in `dist/` (copied into `public/` by the `setup-skia-web` postinstall script and served as a static file, fetched at runtime by `canvaskit-wasm`'s own init code — never `require()`d through Metro's bundler, so `resolver.assetExts` is irrelevant to it regardless). Swirlio never had this file at all and works the same way — this file's presence elsewhere in the fleet is boilerplate carried over from `expo customize`, not a requirement.

**`@shopify/react-native-skia` needs an explicit `paths` redirect to its compiled `.d.ts`, or typecheck fails inside the package's own source.** Identical root cause and fix as Swirlio: no `exports` map, `customConditions: ["react-native"]` follows the raw `src/index.ts`, which pulls in an upstream unused-`React`-import that only fails once `noUnusedLocals` turns on. Two `paths` entries redirect the bare specifier and the `@shopify/react-native-skia/src/web` deep path (`src/utils/loadSkiaWeb.web.ts` imports it directly to lazy-load the CanvasKit WASM runtime) to their compiled counterparts.

**Native/Expo module mocks moved from inline `jest.mock()` calls in `jest.setup.cjs` into individual `src/__mocks__/*.ts` files** — `react-native-reanimated`, `react-native-worklets`, `@expo/vector-icons` (+ its `createIconSet` deep import), `expo-splash-screen`, `react-native-gesture-handler`, `react-native-safe-area-context`, `expo-router`. This is a fleet-wide convention change, not BoxHockey-specific — see `@infinitetoken/jest-config`'s own CLAUDE.md for the full reasoning (manual `__mocks__/` mocking works fine under `jest-expo`, contrary to what that package's docs used to claim; `roots: ['<rootDir>/src']` is now a default there specifically so `src/__mocks__/` — not root `__mocks__/` — is where Jest picks them up, next to `src/__tests__/`). `jest.setup.cjs` now holds only genuine setup-file content (the `IS_REACT_ACT_ENVIRONMENT` flag, `unhandledRejection`/`uncaughtException` handlers, the RAF/cancelAnimationFrame polyfills, and the no-factory `NativeAnimatedHelper` automock) and is auto-detected by `@infinitetoken/jest-config/expo` — no `setupFilesAfterEnv` option needed at all. Also renamed from `.ts` to `.cjs` — a later, separate cleanup: auto-detection genuinely supports either (a `.ts` setup file goes through Jest's own test transform same as any other `setupFilesAfterEnv` entry, unlike `jest.config.cjs` itself, which Jest loads directly before any transform exists), but once its content shrank to thin boilerplate with the mock factories gone, there was no remaining reason for this one hand-authored config file to use a different extension than every other one in the app — see `@infinitetoken/jest-config`'s README, "Why `.cjs`, not `.ts`." With the mock factories' `any` usage gone, `jest.setup.cjs` no longer needs its own `no-explicit-any` eslint override — `eslint.config.cjs` is back to the plain one-liner, same as Crumby. The one remaining `any` in `jest.setup.cjs` (bridging `requestAnimationFrame`'s polyfilled `NodeJS.Timeout` return type into `cancelAnimationFrame`'s DOM-lib `number` signature) is a single targeted `eslint-disable-next-line`, not a file-wide exemption.

**Migrating onto `typescript-eslint`'s `recommended` ruleset escalated one pre-existing lint finding from warning to error.** `src/app/game.tsx`'s web keyboard handler used a ternary as a bare statement (`ready ? stableFaceoffReady(1) : stableFaceoffZoneTap(1, 0)`) four times — already flagged by base ESLint's `no-unused-expressions` as a warning under the old hand-rolled config, now also caught by `@typescript-eslint/no-unused-expressions` as an error (the old config never composed on `typescript-eslint.configs.recommended` at all). Rewritten as explicit `if`/`else` — same behavior, no more expression-as-statement.

**Migrating onto `@infinitetoken/tsconfig/expo` turned on `noUnusedLocals` for the first time**, surfacing one genuinely dead local (`outerBottom` in `src/__tests__/physics.test.ts`, declared and never read) — removed.

**A large pre-existing lint-warning backlog was left untouched.** `npx eslint .` reports 232 warnings (0 errors) after this migration — verified identical in kind and near-identical in count under the old hand-rolled config too (236 warnings, 0 errors), so this is pre-existing debt, not something the migration introduced. The bulk is `prettier/prettier` formatting drift in `src/components/Board.tsx`, plus several genuine `react-hooks/refs` "Cannot access refs during render" findings (`useAIOpponent.ts`, `useFaceoff.ts`, `useGameState.ts`, `game.tsx`) from the standard "ref mirrors latest value for a callback to read" pattern — the same category Swirlio's CLAUDE.md documents as a React-Compiler-era false-positive class, but these haven't been triaged/suppressed individually yet. Not fixed as part of this migration since fixing it means either a large `--fix` reformat of `Board.tsx` or auditing each ref pattern — out of scope for a tooling swap. Flagging for a future pass.

**RESOLVED — same root cause as [LightCycles](../LightCycles/.claude/CLAUDE.md).** `src/hooks/useProfiles.tsx` imports `isSharedProfileStoreAvailable`, `loadSharedProfiles`, and `saveSharedProfiles` from `@tastic/profile`, and the then-installed `@tastic/profile@0.1.3` exported none of them — confirmed unrelated to this migration by reverting to the pre-migration `tsconfig.json` and reproducing the identical error. It was the same in-progress shared BoxHockey/LightCycles profile-roster feature (both apps declare the `group.com.infinitetoken.tastic` App Group), blocked on an unpublished `@tastic/profile` version. Fixed by bumping `@tastic/profile` to `^0.3.4` (confirmed to actually export the needed members) — `npm run typecheck`/`npm run verify` now pass clean.

**`@react-native/jest-preset` was moved from `dependencies` to `devDependencies`** — a test-only package, misplaced in the runtime deps list; every other app in the fleet has it under `devDependencies`.

`@infinitetoken/jest-config` (`^0.2.3`) and `@infinitetoken/tsconfig` (`^0.4.1`) are both on real published versions now — neither is yalc-linked (that was a temporary state during development for both, resolved once each package was actually published).

**`tsconfig.json`'s `types` array was removed — `@infinitetoken/tsconfig/expo` now defaults `types: ["jest", "node", "react-native"]` itself.** This app's own array had been `["jest", "node"]`, missing `"react-native"` entirely, with no ill effect (nothing in this app happened to reference a react-native global) — one of the two real data points that showed the fleet's apparent per-app `types` variation was mostly drift, not genuine differing need (the other was Swirlio's `"node"` entry resolving with no `@types/node` actually installed). See `@infinitetoken/tsconfig`'s own CLAUDE.md for the full correction.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/expo`, `jest-expo` preset)
- Tests live in `src/__tests__/`
- Native/Expo module mocks live in `src/__mocks__/`, one file per module, picked up automatically (no `jest.mock()` call needed) — see Tooling above
- `jest.setup.cjs` holds only genuine setup-file concerns: process-level error handlers, RAF polyfills, the `IS_REACT_ACT_ENVIRONMENT` flag

## Architecture

```
src/
  app/          - expo-router routes
  components/   - UI components (board rendering, controls, dialogs)
  constants/    - static config, game params
  hooks/        - custom hooks (game state, AI opponent, faceoff, profiles)
  types/        - shared TypeScript types
  utils/        - physics, board geometry, validation
  __tests__/    - test suites
  __mocks__/    - manual Jest mocks for native/Expo modules
```

## CI

`.github/workflows/ci.yml` uses the shared reusable workflow (`infinitetoken/Workflows/.github/workflows/npm-ci.yml@v1`, defaults to `npm run verify`) — previously present locally but never committed, and hand-rolled (`npm ci && npm run ci`). The `ci` npm script was renamed to `verify` to match.
