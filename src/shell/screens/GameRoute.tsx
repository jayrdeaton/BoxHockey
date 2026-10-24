import { Redirect, useLocalSearchParams } from 'expo-router'

import { usePackGame } from '@/shell/PackContext'
import { LoadoutScreen } from '@/shell/screens/LoadoutScreen'

// The [game] routes: a game's loadout and its play screen, by id. An id the pack doesn't have (a
// stale link, a web URL typed by hand) goes Home.
export function LoadoutRoute() {
  const { game: id } = useLocalSearchParams<{ game: string }>()
  const game = usePackGame(id)
  if (!game) return <Redirect href='/' />
  return <LoadoutScreen key={game.id} game={game} />
}

export function PlayRoute() {
  const { game: id } = useLocalSearchParams<{ game: string }>()
  const game = usePackGame(id)
  if (!game) return <Redirect href='/' />
  const { PlayScreen } = game
  return <PlayScreen key={game.id} />
}
