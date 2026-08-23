import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useFonts } from 'expo-font'
import { ReactNode } from 'react'

import { useSplashReady } from '@/utils/splashGate'

interface Props {
  children: ReactNode
}

// Holds the splash screen up (see utils/splashGate.ts's 'fonts' gate) until the
// MaterialCommunityIcons glyph font has actually loaded — otherwise every react-native-paper
// Icon/IconButton (and @rific/feedback-press's IconButton, which wraps paper's under the hood)
// would render blank for one visible frame before snapping in once the async load resolves.
export function Fonts({ children }: Props) {
  const [loaded] = useFonts({ ...MaterialCommunityIcons.font })
  useSplashReady('fonts', loaded)
  return <>{children}</>
}
