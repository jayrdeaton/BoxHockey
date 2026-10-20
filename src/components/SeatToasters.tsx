import { Toaster } from '@rific/toaster'
import { rotateDimensions, rotateInsets, type ViewRotation } from '@tastic/core'
import { type ReactNode, useCallback } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { type EdgeInsets, SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { SEAT_TOAST_STACKS } from '@/hooks/useUnlockToasts'

/** Where one 2 Player seat's toasts go: the half of the screen that's theirs (the screen as the app lays it out, portrait-locked, so 'top'
 * is the device's own top half however it's held), and the angle they read the screen at. */
export interface SeatToastSpot {
  rotation: ViewRotation
  zone: 'bottom' | 'left' | 'right' | 'top'
}

/** 2 Player's unlock toasts: one @rific/toaster Toaster per seat (its `stack`, SEAT_TOAST_STACKS), each laid in that seat's half of the
 * screen and turned to face them, so each player reads their own toasts the right way up, on their own side: at their end of the table face
 * to face, and on their own half side by side (Jay, 2026-10-20: three toasts for one player and one for the other are two stacks, one on each
 * side). The app's main Toaster keeps every other toast. Mounted on the game screen in 2 Player; each Toaster draws nothing until its stack
 * has a toast. */
export function SeatToasters({ spots }: { spots: Record<1 | 2, SeatToastSpot> }) {
  return (
    <>
      <SeatToaster spot={spots[1]} stack={SEAT_TOAST_STACKS[1]} />
      <SeatToaster spot={spots[2]} stack={SEAT_TOAST_STACKS[2]} />
    </>
  )
}

function SeatToaster({ spot: { rotation, zone }, stack }: { spot: SeatToastSpot; stack: string }) {
  // Inside the Toaster's own Portal, so the frame is drawn over the screen only while the stack has toasts.
  const renderFrame = useCallback(
    (toasts: ReactNode) => (
      <SeatFrame rotation={rotation} stack={stack} zone={zone}>
        {toasts}
      </SeatFrame>
    ),
    [rotation, stack, zone]
  )
  // The main Toaster's settings (_layout.tsx), plus keyboardAware off: the keyboard rises from the screen's own bottom, not a turned frame's.
  return <Toaster clearButton={null} historyButton={null} keyboardAware={false} limit={3} renderFrame={renderFrame} stack={stack} />
}

// The edge each half shares with the other one, which has no safe-area inset of its own.
const INNER_EDGE: Record<SeatToastSpot['zone'], keyof EdgeInsets> = { bottom: 'top', left: 'right', right: 'left', top: 'bottom' }

function zoneRect(zone: SeatToastSpot['zone'], width: number, height: number) {
  switch (zone) {
    case 'bottom':
      return { height: height / 2, left: 0, top: height / 2, width }
    case 'top':
      return { height: height / 2, left: 0, top: 0, width }
    case 'left':
      return { height, left: 0, top: 0, width: width / 2 }
    case 'right':
      return { height, left: width / 2, top: 0, width: width / 2 }
  }
}

// One half of the screen, turned to `rotation` about its own center (at a quarter turn, sized to the half's footprint turned too), with the
// safe-area insets of the screen edges it touches moved onto its own edges, so the stack sits at its seat's edge clear of the notch or home
// indicator there. Lets touches through, so only the toasts take them.
function SeatFrame({ children, rotation, stack, zone }: SeatToastSpot & { children: ReactNode; stack: string }) {
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const rect = zoneRect(zone, window.width, window.height)
  const turned = rotateDimensions(rect.width, rect.height, rotation)
  const frameInsets = rotateInsets({ ...insets, [INNER_EDGE[zone]]: 0 }, rotation)
  return (
    <View pointerEvents='box-none' style={[styles.frame, { height: turned.height, left: rect.left + (rect.width - turned.width) / 2, top: rect.top + (rect.height - turned.height) / 2, transform: [{ rotate: `${rotation}deg` }], width: turned.width }]} testID={`${stack}-frame`}>
      <SafeAreaInsetsContext.Provider value={frameInsets}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { position: 'absolute' }
})
