// The App Store's product page header and search results art (iOS 27's creative assets, see store/README.md), drawn
// from the app's own board, never a lookalike. Board.tsx draws with Skia, which doesn't render outside the app (it
// needs CanvasKit, Reanimated and the theme provider), so the header redraws Board's own shapes as SVG from the app's
// real geometry and colors: computeBoardLayout on the iPhone 17 Pro Max layout (the screenshots' device), Classic,
// medium puck, Rink off, faceoffZoneCenters/faceoffZoneRadius for the circles, computeGoalWedges for the score arcs,
// and the dark theme's colors (the shell's DEFAULT_SEAT_COLORS, Board's white walls and 25% white lines). The puck's
// flight is a real shot played out frame by frame on the app's own stepPhysics. The search art's phone shows the
// in-play screenshot capture (store/screenshots/raw/iphone/01-play.png, so take the screenshots first).
//
//   node store/creative/build.mjs
//
// Writes store/screenshots/header.png (3840 x 1646) and store/screenshots/search.png (3840 x 2560), each with -safe
// and -384 previews, through the app-store-prep skill's creative.mjs (CREATIVE=/path/to/creative.mjs to override).
// Same bundling as store/seed/generate.mjs: esbuild with a react-native Platform stub.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..')
const OUT_DIR = path.join(ROOT, 'store', 'screenshots')
const CREATIVE = process.env.CREATIVE ?? path.join(os.homedir(), '.claude/skills/app-store-prep/scripts/creative.mjs')
const CAPTURE = path.join(OUT_DIR, 'raw', 'iphone', '01-play.png')
// The screenshots' caption font (store/screenshots.json), the closest file to the app's Menlo.
const FONT = '/System/Library/Fonts/SFNSMono.ttf'

const ENTRY = `
export { computeBoardLayout, faceoffZoneCenters, faceoffZoneRadius } from '@/games/boxhockey/utils/board'
export { stepPhysics } from '@/games/boxhockey/utils/physics'
export { computeGoalWedges } from '@tastic/physics'
export { FRICTION_LEVELS, GOAL_LINE_STROKE_WIDTH, MAX_SPEED } from '@/games/boxhockey/constants/game'
export { DEFAULT_SEAT_COLORS } from '@/shell/seatColors'
`
const RN_STUB = "export const Platform = { OS: 'ios', select: (o) => o.ios ?? o.native ?? o.default }"

// Inside the project, so the bundle's external requires resolve this app's node_modules.
const WORK = fs.mkdtempSync(path.join(HERE, '.build-'))
try {
  const stub = path.join(WORK, 'react-native.mjs')
  fs.writeFileSync(stub, RN_STUB)
  const bundleFile = path.join(WORK, 'bundle.cjs')
  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundleFile,
    logLevel: 'error',
    alias: { '@': path.join(ROOT, 'src'), 'react-native': stub }
  })
  const m = createRequire(import.meta.url)(bundleFile)

  // The iPhone 17 Pro Max's screen and safe area, as in store/seed/generate.mjs.
  const board = m.computeBoardLayout(440, 956, { top: 62, bottom: 34, left: 0, right: 0 }, 'classic', 'medium', false)
  const { x, y, width, height, puckRadius, goalWidth } = board
  const p1 = m.DEFAULT_SEAT_COLORS[1]
  const p2 = m.DEFAULT_SEAT_COLORS[2]
  // Board.tsx's dark-mode wallColor and lineColor.
  const wall = '#FFFFFF'
  const line = 'rgba(255,255,255,0.25)'
  const goalCX = x + width / 2
  const goalAbsLeft = x + board.goalLeft
  const goalAbsRight = x + board.goalRight

  // A shot from P1's half: up and to the right, off the right wall, through the right divider hole and on into the
  // top goal (P2's, which P1 scores through), played out on stepPhysics at 60 Hz until it scores.
  const angle = (-66 * Math.PI) / 180
  let puck = { x: 380, y: 740, vx: Math.cos(angle) * m.MAX_SPEED, vy: Math.sin(angle) * m.MAX_SPEED }
  const flight = [puck]
  let scored = null
  for (let i = 0; i < 600 && scored === null; i++) {
    const r = m.stepPhysics(puck, board, 1, m.FRICTION_LEVELS.medium)
    puck = { x: r.x, y: r.y, vx: r.vx, vy: r.vy }
    flight.push(puck)
    scored = r.scored
    if (r.stopped) break
  }
  if (scored !== 1) throw new Error(`the header's shot no longer scores for P1 (scored ${scored}): the physics changed, pick a new one`)

  const arc = (cx, cy, r, startDeg, sweepDeg) => {
    const a0 = (startDeg * Math.PI) / 180
    const a1 = ((startDeg + sweepDeg) * Math.PI) / 180
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${Math.abs(sweepDeg) > 180 ? 1 : 0} ${sweepDeg > 0 ? 1 : 0} ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`
  }

  // Board.tsx's static layers, in its order, at a given score (scoreToWin 5).
  function rink(scores) {
    const out = []
    const r = goalWidth / 2
    // Crease tint (0.28) and the score arcs (ScoreWedges: 2.5 wide, round caps, 5 degree gaps).
    out.push(`<g opacity="0.28"><path d="${arc(goalCX, y + height, r, 180, 180)} Z" fill="${p1}"/><path d="${arc(goalCX, y, r, 0, 180)} Z" fill="${p2}"/></g>`)
    for (const [cy, base, score, color] of [
      [y + height, 180, scores[0], p1],
      [y, 0, scores[1], p2]
    ]) {
      for (const [i, w] of m.computeGoalWedges(5, base).entries()) out.push(`<path d="${arc(goalCX, cy, r, w.startAngle + 2.5, w.sweepAngle - 5)}" fill="none" stroke="${i < score ? color : line}" stroke-width="2.5" stroke-linecap="round"/>`)
    }
    // Face-off circles at rest: the ring at its resting 0.3, 1.5 wide, and the small dot (0.08 of the radius).
    const fr = m.faceoffZoneRadius(board)
    for (const [player, color] of [
      [1, p1],
      [2, p2]
    ]) {
      for (const c of m.faceoffZoneCenters(board, player)) out.push(`<circle cx="${c.x}" cy="${c.y}" r="${fr}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.3"/><circle cx="${c.x}" cy="${c.y}" r="${fr * 0.08}" fill="${color}"/>`)
    }
    // Zone lines (ZoneLine: 4 wide at 0.5, 0.72 of each half from its goal line).
    const zone = 0.72
    out.push(`<g opacity="0.5" stroke-width="4"><line x1="${x}" x2="${x + width}" y1="${y + height - (height / 2) * zone}" y2="${y + height - (height / 2) * zone}" stroke="${p1}"/><line x1="${x}" x2="${x + width}" y1="${y + (height / 2) * zone}" y2="${y + (height / 2) * zone}" stroke="${p2}"/></g>`)
    // Goal lines (Rink off: white), the divider, its posts and the colored goal posts.
    const gl = m.GOAL_LINE_STROKE_WIDTH
    for (const [x1, x2, gy] of [
      [x, goalAbsLeft, y],
      [goalAbsRight, x + width, y],
      [x, goalAbsLeft, y + height],
      [goalAbsRight, x + width, y + height]
    ])
      out.push(`<line x1="${x1}" x2="${x2}" y1="${gy}" y2="${gy}" stroke="${wall}" stroke-width="${gl}"/>`)
    for (const o of board.obstacles) out.push(`<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="${wall}"/>`)
    for (const p of board.wallPosts) out.push(`<circle cx="${p.x}" cy="${p.y}" r="${p.radius}" fill="${wall}"/>`)
    for (const p of board.goalPosts) out.push(`<circle cx="${p.x}" cy="${p.y}" r="${p.radius}" fill="${p.player === 1 ? p1 : p2}"/>`)
    return out.join('\n')
  }

  // The puck in flight (Board's Disc: black, a white 2-wide ring while it moves), with fading copies of where it was
  // over the frames before, the motion a still can't show.
  function puckAt(frame, ghosts, stride) {
    const out = []
    for (let k = ghosts; k >= 1; k--) {
      const p = flight[Math.max(0, frame - k * stride)]
      out.push(`<circle cx="${p.x}" cy="${p.y}" r="${puckRadius}" fill="#000" stroke="${wall}" stroke-width="2" opacity="${(0.5 * (ghosts + 1 - k)) / (ghosts + 1)}"/>`)
    }
    const p = flight[frame]
    out.push(`<circle cx="${p.x}" cy="${p.y}" r="${puckRadius}" fill="#000" stroke="${wall}" stroke-width="2"/>`)
    return out.join('\n')
  }

  function page(name, w, h, body) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Caption'; src: url('${pathToFileURL(FONT).href}'); font-weight: 100 900; }
html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #000; }
.overlay { position: absolute; font-family: 'Caption', monospace; color: #fff; }
</style></head><body>${body}</body></html>`
    const file = path.join(WORK, `${name}.html`)
    fs.writeFileSync(file, html)
    return file
  }

  // Header, 3840 x 1646: one idea, the shot. The whole box on its side (the way it turns when the phone does), walled
  // the way Board draws it on desktop web, P1's red end on the left and P2's blue on the right, match point for red, and
  // the puck just through the divider, inside the safe area (x 1097-2743, y 493-1154), on its way into the blue goal. No
  // words: the name sits right under it. Portrait (px, py) turns 90 degrees: P1's bottom goes left, the left wall the top.
  const s = 3.2
  const toX = (p) => 1920 - (p.y - board.centerY) * s
  const toY = (p) => 823 + (p.x - board.centerX) * s
  const pr = puckRadius * s
  // The last frame with the whole puck in the safe area.
  const frame = flight.findLastIndex((p) => p.y < board.centerY && toX(p) - pr >= 1097 && toX(p) + pr <= 2743 && toY(p) - pr >= 493 && toY(p) + pr <= 1154)
  if (frame < 0) throw new Error("the header's shot never shows whole in the safe area: pick a new one")
  const wt = board.wallThickness
  const walls = [
    [x - wt, y - wt, wt, height + wt * 2],
    [x + width, y - wt, wt, height + wt * 2],
    [x, y - wt, goalAbsLeft - x, wt],
    [goalAbsRight, y - wt, x + width - goalAbsRight, wt],
    [x, y + height, goalAbsLeft - x, wt],
    [goalAbsRight, y + height, x + width - goalAbsRight, wt]
  ]
    .map(([rx, ry, rw, rh]) => `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${wall}"/>`)
    .join('')
  const headerFile = page(
    'header',
    3840,
    1646,
    `<svg width="3840" height="1646" viewBox="0 0 3840 1646" xmlns="http://www.w3.org/2000/svg">
<rect width="3840" height="1646" fill="#000"/>
<g transform="matrix(0 ${s} ${-s} 0 ${1920 + board.centerY * s} ${823 - board.centerX * s})">
${rink([4, 2])}
${walls}
${puckAt(frame, 8, 3)}
</g></svg>`
  )

  // Search results, 3840 x 2560: state the obvious. The headline on the left and the in-play screen on the right, both
  // inside the safe area (x 836-3004, y 765-1795); the phone runs off the bottom edge.
  const phoneScale = 0.72
  const phoneW = 1320 * phoneScale
  const phoneH = 2868 * phoneScale
  const bezel = 22
  const phoneLeft = 2020
  const phoneTop = 640
  const radius = 165 * phoneScale
  const searchFile = page(
    'search',
    3840,
    2560,
    `
<div class="overlay" style="left:876px;top:765px;width:1120px;height:1030px;display:flex;flex-direction:column;justify-content:center;gap:70px">
  <div style="font-size:150px;line-height:1.12;font-weight:700">Tabletop<br>Box Hockey</div>
  <div style="font-size:84px;line-height:1.3;font-weight:700;opacity:0.85">Play a Friend<br>or the CPU</div>
  <div style="display:flex;gap:40px"><div style="width:220px;height:16px;border-radius:8px;background:${p1}"></div><div style="width:220px;height:16px;border-radius:8px;background:${p2}"></div></div>
</div>
<div class="overlay" style="left:${phoneLeft - bezel}px;top:${phoneTop - bezel}px;padding:${bezel}px;background:#0a0a0a;border-radius:${radius + bezel}px;box-shadow:0 0 0 4px rgba(255,255,255,0.16),0 50px 140px rgba(255,255,255,0.06)">
  <div style="position:relative;width:${phoneW}px;height:${phoneH}px;border-radius:${radius}px;overflow:hidden">
    <img src="${pathToFileURL(CAPTURE).href}" style="display:block;width:${phoneW}px;height:${phoneH}px">
    <div style="position:absolute;left:${(phoneW - 378 * phoneScale) / 2}px;top:${41 * phoneScale}px;width:${378 * phoneScale}px;height:${111 * phoneScale}px;border-radius:${(111 * phoneScale) / 2}px;background:#000"></div>
  </div>
</div>`
  )

  for (const [file, placement] of [
    [headerFile, 'header'],
    [searchFile, 'search']
  ]) {
    execFileSync('node', [CREATIVE, file, placement, path.join(OUT_DIR, `${placement}.png`)], { stdio: 'inherit' })
  }
} finally {
  fs.rmSync(WORK, { recursive: true, force: true })
}
