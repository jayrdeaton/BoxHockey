import { lazySkia } from '@/shared/lazySkia'

// Loads the board only once CanvasKit is ready (see lazySkia).
export default lazySkia(() => import('./Board'))
