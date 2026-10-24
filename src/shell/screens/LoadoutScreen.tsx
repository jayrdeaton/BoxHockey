import { defaultColors, useAutoPaperTheme } from '@rific/auto-paper'
import { FakeLandscapeView, getViewRotation, rotateInsets, useOrientationState } from '@tastic/core'
import { CornerActionButtons, PlayerSetupPanel, PressAwayOverlay, ReadyButton, SharedActionBand, usePopoverHost } from '@tastic/hud'
import type { Profile } from '@tastic/profile'
import { DualZoneLayout, needsSharedNeutralZone, useDualZoneLayout } from '@tastic/split-screen'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch } from 'react-redux'
import type { Action, Dispatch } from 'redux'

import { useGameGuide } from '@/shell/components/GuideHost'
import { SeatTwoPanel } from '@/shell/components/SeatTwoPanel'
import { SettingsDialog } from '@/shell/components/SettingsDialog'
import { useOpponent } from '@/shell/hooks/useOpponent'
import { useProfiles } from '@/shell/hooks/useProfiles'
import { useSeatColors } from '@/shell/hooks/useSeatColors'
import { safeBack } from '@/shell/navigation'
import { usePack } from '@/shell/PackContext'
import { liveplayActions } from '@/shell/redux/liveplaySlice'
import { type GameDefinition, humanSeatsFor, roundModeFor, type Seat, type SeatTwo } from '@/shell/types'

// The player-panel area: whenever a real device rotation changes orientationMode or which physical
// side P1 lands on, the panels fade out, the layout underneath swaps while invisible, then they fade
// back in - masking what would otherwise be an instant jump-cut as panels reflow or swap sides.
// Short and symmetric on purpose: this is masking a reflow that already happened at the OS's own
// pace, not a deliberate reveal.
const PANEL_SWAP_FADE_MS = 180

// Seat 2's saved choice in this game: a saved 'nobody' reads as the CPU in a game without a solo
// mode, and so does anything else the game doesn't offer.
export function seatTwoFor(saved: SeatTwo, choices: readonly SeatTwo[]): SeatTwo {
  return choices.includes(saved) ? saved : 'cpu'
}

// Every game's loadout: seat 1 (the player picked on Home), seat 2 (the CPU, a second person, or
// nobody, from seat 2's own button), the game's own match options, and Ready. Remounted per game
// (the route keys it by id), so a game's useLoadout hook only ever runs for that one game.
export function LoadoutScreen({ game }: { game: GameDefinition }) {
  const pack = usePack()
  const { seatTwo: savedSeatTwo, setSeatTwo } = useOpponent()
  const seatTwo = seatTwoFor(savedSeatTwo, game.seatTwo)
  const mode = roundModeFor(seatTwo)
  const humanSeats = useMemo(() => humanSeatsFor(mode), [mode])
  const p2IsHuman = mode === 'twoPlayer'
  // A CPU takes a seat on the board; nobody doesn't (solo).
  const p2Exists = mode !== 'solo'

  const loadout = game.useLoadout(mode)
  const { openFor } = useGameGuide()

  const { profiles, lastSelected, selectProfile } = useProfiles()
  // orientationMode just follows the device's current physical tilt (see @tastic/core's
  // useOrientationState), CPU games included - how you're holding the phone right now decides the
  // panel arrangement, not a stored per-round choice. Lock Orientation pins it app-wide by freezing
  // the shared reading itself (RootLayout's OrientationBridge), so this read takes no `locked`
  // argument. The OS is portrait-locked; FakeLandscapeView below fakes the rest in JS.
  const { orientationMode, p1OnRight, upsideDown, resolved: p1OnRightResolved } = useOrientationState()

  // The panel area's own layout lags one fade behind the live orientation above - see
  // useDualZoneLayout's own comment. 2 Player seats its players the way the game's own board does
  // (GameDefinition.twoPlayerSeats): face to face however the phone is held, P1 in the bottom half
  // and P2 in the top, flipped for an upside-down hold where the game flips too, so each player gets
  // the same half here and in the match. On the web a game may seat them side by side instead.
  const fixedSeats = p2IsHuman && (game.twoPlayerSeats.faceToFaceOnWeb || Platform.OS !== 'web')
  const fixedUpsideDown = game.twoPlayerSeats.followUpsideDown && orientationMode === 'faceToFace' && upsideDown
  const { panelLayout, panelFadeStyle } = useDualZoneLayout(fixedSeats ? 'faceToFace' : orientationMode, fixedSeats ? true : p1OnRight, fixedSeats || p1OnRightResolved, fixedSeats ? fixedUpsideDown : upsideDown, PANEL_SWAP_FADE_MS)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // Safe-area insets are relative to the device's fixed portrait frame; rotateInsets remaps them
  // onto whichever edge they land on once FakeLandscapeView turns the content, so `top`/`left`/
  // `right` below always mean the screen's real, visual edges.
  const rotation = getViewRotation(panelLayout.orientationMode, panelLayout.p1OnRight, panelLayout.upsideDown)
  const insets = rotateInsets(useSafeAreaInsets(), rotation)
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const { p1Color, p2Color, handleP1ColorChange, handleP2ColorChange } = useSeatColors(p2IsHuman)
  const dispatch = useDispatch<Dispatch<Action>>()

  // A seat's color follows its newly selected profile through the profile-color effect above.
  // Picking the other seat's profile swaps the two (see @tastic/profile's select).
  const handleP1ProfileSelect = useCallback((profile: Profile | null) => selectProfile(1, profile?.id ?? null), [selectProfile])
  const handleP2ProfileSelect = useCallback((profileId: string | null) => selectProfile(2, profileId), [selectProfile])

  const [ready, setReady] = useState<Record<Seat, boolean>>({ 1: false, 2: false })

  // Every time this screen (re)gains focus - arrival from Home, or coming back from a match - Ready
  // starts false again. Without this, popping back to a loadout whose players both left it Ready
  // would immediately re-trigger the all-ready effect below and bounce straight back into the match.
  useFocusEffect(
    useCallback(() => {
      setReady({ 1: false, 2: false })
    }, [setReady])
  )
  // A change of who's in seat 2 starts Ready over too: otherwise player 1, ready and waiting on
  // player 2, would be launched into a match the moment seat 2 switched to the CPU.
  const changeSeatTwo = useCallback(
    (next: SeatTwo) => {
      setReady({ 1: false, 2: false })
      setSeatTwo(next)
    },
    [setSeatTwo, setReady]
  )

  // Read through a ref rather than listed as a dependency of the effect below: this screen stays
  // mounted (and still all Ready) under the play screen, so a settings change made there would
  // otherwise re-run that effect and push a second match.
  const roundSettingsRef = useRef(loadout.roundSettings)
  useEffect(() => {
    roundSettingsRef.current = loadout.roundSettings
  }, [loadout.roundSettings])

  useEffect(() => {
    if (!humanSeats.every((s) => ready[s])) return
    dispatch(liveplayActions.setActiveRound({ game: game.id, mode, settings: roundSettingsRef.current }))
    router.push({ pathname: '/[game]/play', params: { game: game.id } })
  }, [ready, humanSeats, game.id, mode, dispatch])

  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  const isPortrait = panelLayout.orientationMode === 'faceToFace'
  // See @tastic/split-screen's needsSharedNeutralZone: whether back/settings/randomize/reset fold
  // into one band between the two players instead of sitting in the corners.
  const showMetaInSharedBand = needsSharedNeutralZone(panelLayout.orientationMode, humanSeats.length)

  // Where P2's own press-away zone lives on screen - matches panelLayout (what's actually painted
  // right now, mid-fade included). Portrait puts P2's panel in the top half; landscape on whichever
  // side isn't P1's. Only in 2 Player - otherwise seat 2 shares seat 1's host (see p2Host below).
  const p2ZoneStyle = p2IsHuman ? (isPortrait ? styles.p2ZoneTop : panelLayout.p1OnRight ? styles.p2ZoneLeft : styles.p2ZoneRight) : null

  // With one human, the one Ready button sits under both panels instead of in each.
  const showReadyButton = p2IsHuman
  // P1's panel and the match options share one host - they sit in the same near/bottom zone. With
  // one human, seat 2's panel joins it too (one person drives both, so two open menus at once would
  // be clutter). 2 Player gives P2 their own host so two people can pick at once, each press-away
  // zone closing only its own player's menu.
  const controlsHost = usePopoverHost()
  const p2PanelHost = usePopoverHost()
  const p2Host = p2IsHuman ? p2PanelHost : controlsHost
  // The one-human Ready button is centered under the whole row, not under either seat button, so an
  // open seat menu can't fully cover it; it fades out while one is open instead.
  const anyPlayerPickerOpen = !!(controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-'))

  const optionsRow = loadout.options({
    host: controlsHost,
    rotation,
    accentColor: themeColors.tertiary,
    mutedColor: fgMuted,
    onAccentColor: themeColors.onTertiary,
    dark,
    // Left out (the row's own actions unrendered) whenever the shared band below carries them.
    onRandomize: showMetaInSharedBand ? undefined : loadout.randomize,
    onReset: showMetaInSharedBand ? undefined : loadout.reset
  })

  const optionsPopoverOpen = controlsHost.openId !== null && loadout.optionIds.includes(controlsHost.openId)
  const sharedControls = showMetaInSharedBand ? (
    <SharedActionBand onBack={safeBack} onSettings={() => setSettingsOpen(true)} onRandomize={loadout.randomize} onReset={loadout.reset} fg={fg} popoverOpen={optionsPopoverOpen}>
      {optionsRow}
    </SharedActionBand>
  ) : (
    optionsRow
  )

  const controlLook = { accentColor: themeColors.tertiary, mutedColor: fgMuted, dark }
  const p1Control = loadout.seatControl(1, controlsHost, { ...controlLook, seatColor: p1Color })
  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Exists ? p2Color : undefined} allowSwapTaken={mode === 'vsCpu'} colorCaption={pack.colorCaption} isHuman ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} secondPicker={p1Control} secondPickerId={p1Control ? 'p1-control' : undefined} profiles={profiles} selectedProfileId={lastSelected[1]} takenProfileId={p2IsHuman ? lastSelected[2] : null} guestLabel='P1' onProfileSelect={handleP1ProfileSelect} onManageProfiles={() => router.push('/profiles')} />
  const p2Control = p2IsHuman ? loadout.seatControl(2, p2Host, { ...controlLook, seatColor: p2Color }) : undefined
  const p2Panel = <SeatTwoPanel idPrefix='p2' host={p2Host} choices={game.seatTwo} seatTwo={seatTwo} onSeatTwoChange={changeSeatTwo} cpuDifficulty={loadout.cpuDifficulty} profiles={profiles} selectedProfileId={lastSelected[2]} onProfileSelect={handleP2ProfileSelect} color={p2Color} onColorChange={handleP2ColorChange} swatches={defaultColors} takenColor={p1Color} allowSwapTaken={mode === 'vsCpu'} colorCaption={pack.colorCaption} dark={dark} secondPicker={p2Control} secondPickerId={p2Control ? 'p2-control' : undefined} ready={ready[2]} onToggleReady={() => setReady((r) => ({ ...r, 2: !r[2] }))} showReadyButton={showReadyButton} />

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Driven by panelLayout (the same committed, fade-masked state DualZoneLayout renders from),
      so the rotation change and the panel swap land in the same fade-covered moment. The Settings
      dialog stays outside: it renders through a Portal, turned by its own `rotation`. */}
      <FakeLandscapeView orientationMode={panelLayout.orientationMode} p1OnRight={panelLayout.p1OnRight} upsideDown={panelLayout.upsideDown} style={styles.rotatable}>
        {/* Press-away overlays for the loadout's own menus. P1's covers the whole screen (their
        panel plus the match options read as theirs), while P2's covers only their half and, as a
        later sibling, takes priority there. P2's mounts whenever either host has a menu open, so it
        always shields P2's half from P1's press-away. */}
        <PressAwayOverlay active={controlsHost.openId !== null} onPress={controlsHost.close} />
        {p2ZoneStyle && <PressAwayOverlay active={controlsHost.openId !== null || p2Host.openId !== null} onPress={p2Host.close} style={p2ZoneStyle} />}

        {!showMetaInSharedBand && <CornerActionButtons onBack={safeBack} onSettings={() => setSettingsOpen(true)} fg={fg} insets={insets} />}

        {p2IsHuman ? (
          <DualZoneLayout
            panelLayout={panelLayout}
            panelFadeStyle={panelFadeStyle}
            p1={p1Panel}
            p2={p2Panel}
            shared={sharedControls}
            // A zone can't self-elevate above a later sibling zone; these lift whichever zone has a
            // menu open (see DualZoneLayout's p1Elevated/p2Elevated/sharedElevated doc).
            p1Elevated={controlsHost.openId?.startsWith('p1-') ?? false}
            p2Elevated={p2Host.openId !== null}
            sharedElevated={optionsPopoverOpen}
          />
        ) : (
          <View style={styles.stackedZone}>
            {sharedControls}
            <Animated.View style={[styles.playersRow, anyPlayerPickerOpen && styles.playersRowOpen, panelFadeStyle]}>
              {!isPortrait && panelLayout.p1OnRight ? p2Panel : p1Panel}
              {!isPortrait && panelLayout.p1OnRight ? p1Panel : p2Panel}
            </Animated.View>
            <ReadyButton color={p1Color} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} style={anyPlayerPickerOpen && styles.readyButtonHidden} />
          </View>
        )}
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotation} onShowHowToPlay={() => openFor(game.id)} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  p2ZoneLeft: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: '50%'
  },
  p2ZoneRight: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '50%'
  },
  p2ZoneTop: {
    height: '50%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  // The one-human row: seat 1's panel and seat 2's button read as one evenly spaced row of buttons,
  // at PlayerSetupPanel's own pickerRow gap (12).
  playersRow: {
    flexDirection: 'row',
    gap: 12
  },
  playersRowOpen: {
    zIndex: 100
  },
  // See anyPlayerPickerOpen: opacity 0 (not display:'none') keeps the button's layout space, and
  // pointerEvents:'none' keeps the sliver an open menu doesn't cover from being a hidden tap target.
  readyButtonHidden: {
    opacity: 0,
    pointerEvents: 'none'
  },
  // A real full-bleed box for FakeLandscapeView to size its absolutely-positioned children against.
  rotatable: {
    alignItems: 'center',
    flex: 1,
    gap: 32,
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  stackedZone: {
    alignItems: 'center',
    gap: 28
  }
})
