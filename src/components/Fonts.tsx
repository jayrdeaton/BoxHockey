import { MaterialCommunityIcons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { useFonts } from 'expo-font'
import Head from 'expo-router/head'
import { ReactNode } from 'react'
import { Platform } from 'react-native'

import { SplashGate } from '@/utils/splashGate'

interface Props {
  children: ReactNode
}

// Holds the splash screen up (see utils/splashGate.ts's 'fonts' gate) until the
// MaterialCommunityIcons glyph font has actually loaded - otherwise every react-native-paper
// Icon/IconButton (and @rific/feedback-press's IconButton, which wraps paper's under the hood)
// would render blank for one visible frame before snapping in once the async load resolves.
// Gated via the Gate component (SplashGate, per splashGate.ts's own alias) rather than a
// hand-rolled `if (!loaded) return null` - marking the splash gate ready and holding `children`
// back until then happen in one place this way, same as the modern approach _layout.tsx now uses
// for the 'settings'/'profiles' gates.
export function Fonts({ children }: Props) {
  // A failed load counts as ready too: `loaded` stays false forever after an error, which would hold
  // the splash up for good, so the app opens on the system fallback font instead.
  const [loaded, error] = useFonts({ ...MaterialCommunityIcons.font })
  return (
    <>
      {/* The web tab title, outside the fonts gate. Since SDK 58 Head only sets it after hydration; the static export's HTML no longer carries it (see TODO.md). Web only: on iOS, expo-router's Head is Handoff/Spotlight metadata that needs the plugin's `origin` set, and without it every route change throws (a dev build) or shows a system alert (a production build) */}
      {Platform.OS === 'web' && (
        <Head>
          <title>{Constants.expoConfig?.name}</title>
        </Head>
      )}
      <SplashGate gate='fonts' ready={loaded || !!error}>
        {children}
      </SplashGate>
    </>
  )
}
