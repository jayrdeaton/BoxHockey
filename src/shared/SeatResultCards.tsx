import { Button } from '@rific/feedback-press'
import { overlayActionStyles, OverlayBackdrop, OverlayCard, useOverlayCardColors } from '@tastic/hud'
import { StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import type { SeatToastSpot } from '@/shared/SeatToasters'
import { MONO_FONT } from '@/shell/fonts'
import type { Seat as Player } from '@/shell/types'

const SEATS: readonly Player[] = [1, 2]

export interface SeatResultCardsProps {
  winner: Player
  // Index 0 is player 1's, as GameScreen keeps them.
  scores: [number, number]
  playerColor: Record<Player, string>
  playerOnColor: Record<Player, string>
  // Each seat's half of the screen and the angle it reads at: the same spots its unlock toasts use
  // (seatToastSpots), so a player's card sits where their toasts do, facing the same way.
  spots: Record<Player, SeatToastSpot>
  onPlayAgain: () => void
  onQuit: () => void
}

// 2 Player's Game Over: one card per seat, each in that seat's half and turned to face it, the way
// LightCycles' RoundOverDialog splits its round-over cards (Jay, 2026-10-20: the single card only
// faced player 1). Each card says whether its own player won, with their score first, and has its
// own Quit and Play Again; either seat's press acts at once, as the single card's did.
export function SeatResultCards({ winner, scores, playerColor, playerOnColor, spots, onPlayAgain, onQuit }: SeatResultCardsProps) {
  // Quit's outlined label is fg, the card's own text color, not Paper's default (the theme's
  // primary), so neither seat's card shows another seat's color (Jay, 2026-10-20).
  const { fg, fgMuted } = useOverlayCardColors()

  const renderCard = (seat: Player) => {
    const other: Player = seat === 1 ? 2 : 1
    const won = winner === seat
    const color = won ? playerColor[seat] : fgMuted
    const rotation = spots[seat].rotation
    return (
      <OverlayCard style={[styles.card, rotation % 360 !== 0 && { transform: [{ rotate: `${rotation}deg` }] }]}>
        <Icon source={won ? 'trophy' : 'emoticon-sad-outline'} size={48} color={color} />
        <Text variant='headlineMedium' style={[styles.title, { color, fontFamily: MONO_FONT }]}>
          {won ? 'YOU WIN!' : 'YOU LOSE!'}
        </Text>
        <Text variant='bodyLarge' style={{ fontFamily: MONO_FONT }}>
          <Text style={{ color: playerColor[seat] }}>{scores[seat - 1]}</Text>
          <Text style={{ color: fgMuted }}> - </Text>
          <Text style={{ color: playerColor[other] }}>{scores[other - 1]}</Text>
        </Text>
        {/* hud's action row, as in ConfirmDialog: Quit (outlined) on the left and Play Again (filled in
        the seat's color) on the right, side by side, wrapping to a stack only on a card too narrow for
        both. Side by side keeps the card short, leaving room in the half for that seat's unlock toasts
        (Jay, 2026-10-20). */}
        <View style={overlayActionStyles.actions}>
          <Button mode='outlined' onPress={onQuit} style={overlayActionStyles.actionButton} textColor={fg}>
            Quit
          </Button>
          <Button mode='contained' onPress={onPlayAgain} style={overlayActionStyles.actionButton} buttonColor={playerColor[seat]} textColor={playerOnColor[seat]}>
            Play Again
          </Button>
        </View>
      </OverlayCard>
    )
  }

  return (
    <OverlayBackdrop>
      {SEATS.map((seat) => (
        <View key={seat} style={[styles.zone, ZONE_STYLES[spots[seat].zone], { backgroundColor: `${playerColor[seat]}22`, borderColor: playerColor[seat] }]} testID={`seat-result-${seat}`}>
          {renderCard(seat)}
        </View>
      ))}
    </OverlayBackdrop>
  )
}

const styles = StyleSheet.create({
  // Trimmed from the single card (smaller icon and title, tighter gaps), as Snake's per-seat card
  // is, so it fits half of a 667pt phone, and, turned a quarter for a sideways hold, its width fits
  // that half's height. The full width allowance (OverlayCard's maxWidth, 360), as ConfirmDialog's
  // card takes, so the action row has room to sit side by side: sized to its content the card would
  // be as narrow as one button and the row would wrap.
  card: { gap: 8, padding: 18, width: '100%' },
  title: { fontWeight: 'bold', marginBottom: -6 },
  // LightCycles' RoundOverDialog zones: half the screen each, clipped at the edge so an extreme case
  // crops instead of the two cards overlapping at the seam.
  // The padding keeps a full-width card off the half's dashed edge.
  zone: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 3,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 16,
    position: 'absolute'
  },
  zoneBottom: { bottom: 0, left: 0, right: 0, top: '50%' },
  zoneLeft: { bottom: 0, left: 0, right: '50%', top: 0 },
  zoneRight: { bottom: 0, left: '50%', right: 0, top: 0 },
  zoneTop: { bottom: '50%', left: 0, right: 0, top: 0 }
})

const ZONE_STYLES: Record<SeatToastSpot['zone'], object> = { bottom: styles.zoneBottom, left: styles.zoneLeft, right: styles.zoneRight, top: styles.zoneTop }
