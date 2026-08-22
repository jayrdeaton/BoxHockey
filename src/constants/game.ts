export const FRICTION = 0.986
export const WALL_RESTITUTION = 0.72
export const MAX_SPEED = 22
export const MAX_DRAG_PIXELS = 160
export const MIN_SHOOT_DRAG = 12
export const PUCK_RADIUS_RATIO = 0.058
export const GOAL_WIDTH_RATIO = 0.27
export const WALL_THICKNESS = 10
export const STOP_THRESHOLD = 0.12
export const SCORE_TO_WIN = 5
export const PUCK_HIT_MULTIPLIER = 2.2
export const STRIKE_DURATION_MS = 130

// Board camera (pinch-to-zoom + pan, see useBoardCamera.ts). BOARD_DEFAULT_ZOOM (1) is the
// fit-to-screen view the board starts at and the "reset view" button returns to — panning is a
// no-op there since the board exactly fills the viewport either way. BOARD_MIN_ZOOM lets a player
// pinch below that to shrink the board *smaller* than the screen and pan it — e.g. push it toward
// one edge so a puck sitting flush against a wall gets empty screen space on the opposite side to
// drag a full pull-back into, since the board itself has no margin (see BOARD_MARGIN below).
export const BOARD_DEFAULT_ZOOM = 1
export const BOARD_MIN_ZOOM = 0.5
export const BOARD_MAX_ZOOM = 3

// Web only (see useBoardCamera.ts's wheel handler): a trackpad pinch and a Ctrl/Cmd+scroll both
// arrive as `wheel` events with ctrlKey true and no separate touch points — react-native-gesture-
// handler's Pinch gesture needs real multi-touch, so it never fires from either. deltaY magnitude
// varies wildly by input device (trackpad vs. mouse notch), so this is tuned by feel, not derived.
export const WHEEL_ZOOM_SENSITIVITY = 0.01

export const GRAVITY_WELL_MIN_DIST = 4
export const GRAVITY_WELL_ATTRACT_STRENGTH = 0.32
export const GRAVITY_WELL_REPEL_STRENGTH = -0.32

// Board fills the play area edge-to-edge — no margin between the wall and the screen edge.
export const BOARD_MARGIN = 0

// width:height of a real box hockey table (~8ft x 3.3ft — https://en.wikipedia.org/wiki/Box_hockey),
// kept fixed regardless of screen shape rather than stretching to fill it. Whichever screen
// dimension is the tighter constraint gets fit exactly; the other is centered with letterboxing —
// see computeBoardLayout(). A screen that doesn't match this ratio just won't show the whole board
// at once — see useBoardCamera.ts for the pinch-zoom/pan that lets a player close in on it anyway.
export const BOARD_ASPECT_RATIO = 3.3 / 8

// Board/wall/player/line colors now come from the live theme (useAutoPaperTheme, see Board.tsx and
// Theme.tsx) rather than fixed constants — the board's structure is drawn in the derived "primary"
// color and player colors are picked per-session, so there's no static palette to hardcode anymore.
// wellAttract/wellRepel stay fixed: gravity wells are a gameplay signal (polarity), not a themed
// surface, so they keep a constant, always-recognizable pair of accent hues.
export const COLORS = {
  wellAttract: '#8B5CF6',
  wellRepel: '#F59E0B'
} as const
