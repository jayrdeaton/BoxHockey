import { configureNavigation, safeBack } from '@rific/core'
import { router } from 'expo-router'

// safeBack's own implementation (router.canGoBack() ? router.back() : router.replace(fallbackPath))
// now lives in @rific/core, shared across the fleet - this just injects expo-router's `router` once
// at module load (the fallback path defaults to '/', already correct for this app's own root route)
// and re-exports safeBack unchanged, so every existing call site (`safeBack()`, `onBack={safeBack}`,
// `onHome={safeBack}`, `onConfirm={safeBack}`) keeps working with zero changes.
configureNavigation({ router })

export { safeBack }
