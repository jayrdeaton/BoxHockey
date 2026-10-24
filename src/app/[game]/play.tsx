import { games } from '@/pack'
import { PlayRoute } from '@/shell/screens/GameRoute'

// The web build is a static export, so every game's play page is listed here.
export function generateStaticParams(): { game: string }[] {
  return games.map((g) => ({ game: g.id }))
}

export default PlayRoute
