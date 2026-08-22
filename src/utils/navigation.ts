import { router } from 'expo-router'

// router.back() throws a "The action 'GO_BACK' was not handled" error toast whenever this screen
// has no actual history to pop to — reached directly (a deep link, a refreshed page, or this
// tab's very first navigation) rather than pushed from another screen within the app. Falls back
// to the title screen, always a valid destination, instead of leaving the user stuck looking at
// an error toast with a back button that does nothing.
export function safeBack() {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}
