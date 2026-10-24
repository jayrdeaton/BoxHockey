import { pack, persistor, store } from '@/pack'
import { RootLayout } from '@/shell/RootLayout'

export default function Layout() {
  return <RootLayout pack={pack} store={store} persistor={persistor} />
}
