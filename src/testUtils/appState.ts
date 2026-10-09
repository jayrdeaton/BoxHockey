import { AppState, type AppStateStatus } from 'react-native'

// The react-native jest preset's AppState.addEventListener is a bare jest.fn that never calls
// anything back, so a test plays an app-state change itself: every 'change' listener subscribed
// since the mock was last cleared (clear it in beforeEach) gets `next`. Wrap the call in act().
export function emitAppState(next: AppStateStatus) {
  for (const [type, listener] of jest.mocked(AppState.addEventListener).mock.calls) {
    if (type === 'change') listener(next)
  }
}
