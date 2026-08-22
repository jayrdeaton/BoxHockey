import { ReactNode } from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'

const CARET_SIZE = 7
// How far the fill triangle's base sits past the border triangle's own base, producing the ring of
// caretBorderColor around it — kept fixed regardless of caretBorderWidth; tuned by eye.
const CARET_RING_OFFSET = 2
// How far both triangles dip below the box's own top edge. The caret renders after (on top of) the
// box, so this overlap lets it paint over the box's top border there instead of butting up against
// it — a seam shows if the two edges only touch, since neither is guaranteed to land on the exact
// same subpixel.
const CARET_DIP = 1

interface Props {
  visible: boolean
  children: ReactNode
  // Which edge of the trigger the popover aligns to — 'center' (default) centers the popover
  // under/over its trigger regardless of either one's width; 'left'/'right' instead align that
  // edge flush with the trigger's matching edge, growing away from it. A trigger sitting right at
  // the screen's edge (e.g. the rightmost of a row of icons, or a right-side player's panel) needs
  // an explicit 'left' or 'right' — centering alone can still overflow there — to guarantee which
  // direction it grows.
  align?: 'left' | 'right' | 'center'
  // Small triangle pointing back at the trigger, reinforcing the visual link beyond just position
  // (two triggers can sit close together). Omit both to skip it. caretBorderColor defaults to
  // caretColor (a solid, borderless caret) when only caretColor is given.
  caretColor?: string
  caretBorderColor?: string
  // Must match the popover box's own borderWidth — a fixed ring thickness would only happen to
  // match whichever box first used it, and look like a mismatched outline on any other consumer.
  caretBorderWidth?: number
  // The trigger's own width, in px — required whenever a caret is shown with align 'left'/'right'
  // (unused for 'center', see caretOffset below) so the caret can be pinned to the trigger's actual
  // center via a fixed offset from the edge the content is flush with, rather than the content
  // box's own midpoint. Content is usually much wider than its trigger and grows away from it for
  // 'left'/'right', so those two midpoints only coincide by coincidence, if at all.
  triggerSize?: number
}

// Rendered inline as an absolutely-positioned sibling of its own trigger (never via Portal), so it
// inherits any transform the trigger's zone applies. Positioned via percentage (`top:'100%'`)
// against the trigger's own wrapper rather than a measured pixel rect, so no onLayout/measurement
// plumbing is needed and it resolves correctly regardless of how deep the trigger sits in the tree.
export function PopoverBody({ visible, children, align = 'center', caretColor, caretBorderColor, caretBorderWidth = 1, triggerSize = 0 }: Props) {
  if (!visible) return null

  const alignStyle = align === 'left' ? styles.contentLeft : align === 'right' ? styles.contentRight : styles.contentCenter
  const ringSize = CARET_SIZE + caretBorderWidth

  // The caret is a width:0 box whose rendered footprint is purely its (symmetric) borders, so
  // pinning its *center* at some offset means placing its own `left`/`right` half a footprint
  // short of that offset. For 'center', content is symmetric around the same anchor as the trigger
  // regardless of either one's width, so the content box's own 50% already coincides with the
  // trigger's center. For 'left'/'right', content is flush with one edge of the (typically much
  // narrower) trigger and grows away from it — the trigger's center then sits at a fixed distance
  // (half its own width) from that shared edge, not at the content box's midpoint.
  const caretOffset = (halfFootprint: number): ViewStyle => (align === 'left' ? { left: triggerSize / 2 - halfFootprint } : align === 'right' ? { right: triggerSize / 2 - halfFootprint } : { left: '50%', marginLeft: -halfFootprint })

  return (
    <View style={[styles.content, alignStyle]}>
      {children}
      {/* Painted after (on top of) the box above, dipping into its top edge — see CARET_DIP — so it
      reads as one continuous outline flowing from the trigger into the box, not a separate chip
      butted up against it. */}
      {caretColor && (
        <>
          <View style={[styles.caret, caretOffset(ringSize), { borderBottomColor: caretBorderColor ?? caretColor, borderBottomWidth: ringSize, borderLeftWidth: ringSize, borderRightWidth: ringSize, top: -ringSize + CARET_DIP }]} />
          <View style={[styles.caret, caretOffset(CARET_SIZE), { borderBottomColor: caretColor, borderBottomWidth: CARET_SIZE, borderLeftWidth: CARET_SIZE, borderRightWidth: CARET_SIZE, top: -CARET_SIZE + CARET_RING_OFFSET + CARET_DIP }]} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  caret: {
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    height: 0,
    position: 'absolute',
    width: 0,
    // Explicit, not left to DOM order — the box it dips into is itself a position:'relative' view,
    // which React Native Web always gives an implicit zIndex:0, so painting on top needs a real
    // zIndex to beat that reliably rather than relying on being the later sibling.
    zIndex: 1
  },
  content: {
    marginTop: 8,
    position: 'absolute',
    top: '100%',
    zIndex: 50
  },
  contentCenter: {
    left: '50%',
    transform: [{ translateX: '-50%' }]
  },
  contentLeft: {
    left: 0
  },
  contentRight: {
    right: 0
  }
})
