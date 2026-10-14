import { Platform } from 'react-native'

// System monospace, not a bitmap pixel font - cheap way to nod at the retro-vector look without
// pulling in expo-font's async loading + its own splash gate for this pass.
export const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
