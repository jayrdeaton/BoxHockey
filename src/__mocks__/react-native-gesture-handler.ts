const makeGesture = () => {
  const g: any = {}
  g.onUpdate = () => g
  g.onEnd = () => g
  g.onStart = () => g
  g.onChange = () => g
  return g
}

module.exports = {
  PanGestureHandler: ({ children }: any) => children,
  PinchGestureHandler: ({ children }: any) => children,
  State: { ACTIVE: 'ACTIVE', END: 'END' },
  Gesture: {
    Pinch: () => makeGesture(),
    Pan: () => makeGesture(),
    Simultaneous: (..._gs: any[]) => makeGesture(),
    Race: (..._gs: any[]) => makeGesture(),
    Sequence: (..._gs: any[]) => makeGesture()
  },
  GestureDetector: ({ children }: any) => children
}
