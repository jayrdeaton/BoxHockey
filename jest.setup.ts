/* eslint-disable @typescript-eslint/no-require-imports */

/* global jest */
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native')
  const passthrough = (value: unknown) => value
  const passthroughLast = (...values: unknown[]) => values[values.length - 1]

  const Animated = {
    View: RN.View,
    Text: RN.Text,
    Image: RN.Image,
    ScrollView: RN.ScrollView,
    FlatList: RN.FlatList,
    createAnimatedComponent: (Component: unknown) => Component,
    useSharedValue: <T>(value: T) => ({ value }),
    useAnimatedStyle: (updater?: () => unknown) => (typeof updater === 'function' ? updater() : {}),
    useAnimatedProps: (updater?: () => unknown) => (typeof updater === 'function' ? updater() : {}),
    useAnimatedScrollHandler: (handler: (...args: unknown[]) => unknown) => handler,
    useDerivedValue: (updater?: () => unknown) => ({ value: typeof updater === 'function' ? updater() : undefined }),
    withTiming: passthrough,
    withSpring: passthrough,
    withDecay: passthrough,
    withDelay: (_ms: number, value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withSequence: passthroughLast,
    cancelAnimation: jest.fn(),
    interpolate: passthrough,
    interpolateColor: () => '#000000',
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
    useAnimatedRef: () => ({ current: null }),
    measure: () => ({ x: 0, y: 0, width: 0, height: 0, pageX: 0, pageY: 0 }),
    scrollTo: jest.fn(),
    Easing: {
      linear: passthrough,
      ease: passthrough,
      in: passthrough,
      out: passthrough,
      inOut: passthrough,
      bezier: () => passthrough
    },
    Extrapolation: {
      CLAMP: 'clamp',
      EXTEND: 'extend',
      IDENTITY: 'identity'
    },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
    Layout: { duration: () => ({}) },
    default: {
      View: RN.View,
      Text: RN.Text,
      Image: RN.Image,
      ScrollView: RN.ScrollView,
      FlatList: RN.FlatList,
      createAnimatedComponent: (Component: unknown) => Component,
      call: jest.fn()
    }
  }

  return Animated
})

jest.mock('react-native-worklets', () => ({
  createSerializable: (value: unknown) => value,
  isWorkletFunction: () => false,
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  runOnUI: (fn: (...args: unknown[]) => unknown) => fn
}))

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const Icon = ({ children }: any) => children || null
  return {
    Ionicons: Icon,
    MaterialCommunityIcons: Icon,
    MaterialIcons: Icon,
    FontAwesome: Icon,
    default: { Ionicons: Icon }
  }
})

jest.mock('@expo/vector-icons/createIconSet', () => {
  const Icon = ({ children }: any) => children || null
  return Icon
})


// expo-splash-screen
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  setOptions: jest.fn(),
  hideAsync: jest.fn().mockResolvedValue(undefined)
}))

// react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const makeGesture = () => {
    const g: any = {}
    g.onUpdate = () => g
    g.onEnd = () => g
    g.onStart = () => g
    g.onChange = () => g
    return g
  }

  return {
    PanGestureHandler: ({ children }: any) => children,
    PinchGestureHandler: ({ children }: any) => children,
    State: { ACTIVE: 'ACTIVE', END: 'END' },
    Gesture: {
      Pinch: () => makeGesture(),
      Pan: () => makeGesture(),
      Simultaneous: (..._gs: any[]) => makeGesture(),
      Race: (..._gs: any[]) => makeGesture(),
      Sequence: (..._gs: any[]) => makeGesture()
    },
    GestureDetector: ({ children }: any) => children
  }
})

// react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaInsetsContext: {
    Consumer: ({ children }: any) => children({ top: 0, right: 0, bottom: 0, left: 0 })
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

// expo-router
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn()
  }),
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: ({ children }: any) => children || null },
  Tabs: { Screen: ({ children }: any) => children || null },
  Link: ({ children }: any) => children || null
}))

const handleUnhandledRejection = (reason: any) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection in tests:', reason)
}

const handleUncaughtException = (err: any) => {
  // eslint-disable-next-line no-console
  console.error('UncaughtException in tests:', err)
}

if (typeof process !== 'undefined' && process && process.on) {
  process.on('unhandledRejection', handleUnhandledRejection)
  process.on('uncaughtException', handleUncaughtException)
}

try {
  jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper')
} catch {
  // ignore if the path isn't present in this environment
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0)
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id: any) => clearTimeout(id)
}
