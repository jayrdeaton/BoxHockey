import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useFonts } from 'expo-font'
import { ReactNode } from 'react'

import { SplashGate } from '@/utils/splashGate'

interface Props {
  children: ReactNode
}

// Holds the splash screen up (see utils/splashGate.ts's 'fonts' gate) until the
// MaterialCommunityIcons glyph font has actually loaded - otherwise every react-native-paper
// Icon/IconButton (and @rific/feedback-press's IconButton, which wraps paper's under the hood)
// would render blank for one visible frame before snapping in once the async load resolves.
// Gated via the Gate component (SplashGate, per splashGate.ts's own alias) rather than a
// hand-rolled `useSplashReady('fonts', loaded)` + unconditional `<>{children}</>` - that older
// shape marked the gate ready but still rendered children immediately regardless, letting a
// react-native-paper icon render blank for one frame before the font swapped in. Wrapping
// `children` in SplashGate actually holds them back until `ready` flips, matching Pong's own
// Fonts.tsx (the fleet's reference implementation for this gating pattern).
export function Fonts({ children }: Props) {
  const [loaded] = useFonts({ ...MaterialCommunityIcons.font })
  return (
    <SplashGate gate='fonts' ready={loaded}>
      {children}
    </SplashGate>
  )
}
