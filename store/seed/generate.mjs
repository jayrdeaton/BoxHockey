// Seed data for the App Store screenshots (see store/README.md), made by the app's own physics, CPU
// planner, face-off knock, stats engine and achievement catalog: three weeks of real matches by two
// players on one phone. Sam plays the CPU (Easy at first, then Medium, then Hard) and gets better over
// time; Sam and Riley also play Two Player across the table. Every shot is planAIShot's, every goal is
// stepPhysics', and every number on the Stats screen is applyMatchOutcome's.
//
//   node store/seed/generate.mjs        writes store/seed/seed.json (gitignored), then store/seed/reseed.sh
//
// Deterministic apart from the dates, which count back from now.
import { build } from 'esbuild'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..')

const ENTRY = `
import { newlyUnlocked, unlockedKey } from '@tastic/achievements'
import { ACHIEVEMENT_CATALOG } from '@/games/boxhockey/constants/achievements'
import { FACEOFF_MARGIN_MAX_MS, FRICTION_LEVELS, MAX_SPEED } from '@/games/boxhockey/constants/game'
import { planAIShot, randomFaceoffReactionMs } from '@/games/boxhockey/utils/aiOpponent'
import { centerPuck, computeBoardLayout } from '@/games/boxhockey/utils/board'
import { computeFaceoffKnock } from '@/games/boxhockey/utils/faceoff'
import { stepPhysics } from '@/games/boxhockey/utils/physics'
import { applyMatchOutcome, getProfileStatsView } from '@/games/boxhockey/utils/statsEngine'
import { DEFAULT_STATS } from '@/games/boxhockey/utils/statsValidation'

let rng = 20261018
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff), rng / 0x7fffffff)
// planAIShot and computeFaceoffKnock roll their own noise, so the whole run follows this seed.
Math.random = rand

// The iPhone 17 Pro Max's screen and safe area, where the screenshots are taken.
const INSETS = { top: 62, bottom: 34, left: 0, right: 0 }
const friction = FRICTION_LEVELS.medium
const other = (p) => (p === 1 ? 2 : 1)

// One shot or knock, rolled until the puck scores or stops, the way game.tsx's loop steps it (dt 1).
function roll(board, puck) {
  let p = puck
  for (let i = 0; i < 4000; i++) {
    const r = stepPhysics(p, board, 1, friction)
    if (r.scored !== null) return { scored: r.scored, puck: { x: r.x, y: r.y, vx: 0, vy: 0 } }
    if (r.stopped) return { scored: null, puck: { x: r.x, y: r.y, vx: 0, vy: 0 } }
    p = { x: r.x, y: r.y, vx: r.vx, vy: r.vy }
  }
  return { scored: null, puck: { ...p, vx: 0, vy: 0 } }
}

// One match at the default settings (Face-Off on every score, first to 5). skill is each seat's
// planAIShot tier: the CPU's difficulty, or how well a person plays.
function playMatch(variant, skill) {
  const board = computeBoardLayout(440, 956, INSETS, variant, 'medium', false)
  const scores = [0, 0]
  let shots = 0
  while (scores[0] < 5 && scores[1] < 5 && shots < 800) {
    const reaction = { 1: randomFaceoffReactionMs(skill[1]), 2: randomFaceoffReactionMs(skill[2]) }
    const winner = reaction[1] <= reaction[2] ? 1 : 2
    const margin = Math.min(FACEOFF_MARGIN_MAX_MS, Math.abs(reaction[1] - reaction[2]))
    let res = roll(board, { ...centerPuck(board), ...computeFaceoffKnock(board, winner, margin, reaction[winner]) })
    // The face-off winner never shoots next: the loser always takes the first real turn.
    let shooter = other(winner)
    while (res.scored === null && shots < 800) {
      const shot = planAIShot(res.puck, board, shooter, skill[shooter], friction)
      const speed = shot.power * MAX_SPEED
      res = roll(board, { x: res.puck.x, y: res.puck.y, vx: shot.fx * speed, vy: shot.fy * speed })
      shots++
      shooter = other(shooter)
    }
    if (res.scored !== null) scores[res.scored - 1]++
  }
  return { winner: scores[0] > scores[1] ? 1 : 2, scores }
}

export const PROFILES = [
  { id: 'profile-1787900000000-sam4qz', name: 'Sam', color: '#f44336', tag: '🏒', controlScheme: 'flick' },
  { id: 'profile-1787900400000-ril8vx', name: 'Riley', color: '#2196f3', tag: 'RJ', controlScheme: 'flick' }
]
const [SAM, RILEY] = PROFILES

// Three weeks of play, oldest first. Sam starts on the CPU's Easy, moves up as they get better, and
// plays Riley in the evenings. 'medium' and 'hard' for a person are planAIShot's tiers standing in
// for how well they shoot.
function plan() {
  const days = []
  for (let day = 20; day >= 0; day--) {
    const t = (20 - day) / 20
    const sam = t < 0.45 ? 'medium' : 'hard'
    const cpu = t < 0.2 ? 'easy' : t < 0.65 ? 'medium' : rand() < 0.5 ? 'medium' : 'hard'
    const matches = []
    const vsCpu = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < vsCpu; i++) matches.push({ gameMode: 'vsCpu', aiDifficulty: cpu, skill: { 1: sam, 2: cpu } })
    if (day % 2 === 0) {
      const n = 1 + Math.floor(rand() * 2)
      for (let i = 0; i < n; i++) matches.push({ gameMode: 'twoPlayer', aiDifficulty: cpu, skill: { 1: sam, 2: 'medium' } })
    }
    for (const m of matches) {
      const r = rand()
      m.boardVariant = r < 0.6 ? 'classic' : r < 0.8 ? 'gauntlet' : 'gravity'
    }
    days.push({ day, matches })
  }
  return days
}

export function run(nowMs) {
  let stats = DEFAULT_STATS
  let unlocked = {}
  let played = 0
  let won = 0
  for (const { day, matches } of plan()) {
    matches.forEach((m, i) => {
      // Evenings, a few minutes apart, so a streak counts each day once.
      const when = new Date(nowMs - day * 86400000)
      when.setHours(17 + Math.floor(i / 2), 5 + (i % 2) * 25, 0, 0)
      if (when.getTime() > nowMs) when.setTime(nowMs - (matches.length - i) * 600000)
      const outcome = playMatch(m.boardVariant, m.skill)
      const profileIds = m.gameMode === 'vsCpu' ? { 1: SAM.id } : { 1: SAM.id, 2: RILEY.id }
      stats = applyMatchOutcome(stats, outcome, { gameMode: m.gameMode, aiDifficulty: m.aiDifficulty, boardVariant: m.boardVariant, profileIds }, when)
      // The same unlock pass as @tastic/achievements' recordOutcome: device-wide, then each profile.
      const at = when.getTime()
      for (const a of newlyUnlocked(ACHIEVEMENT_CATALOG, stats, unlocked)) unlocked = { ...unlocked, [a.id]: at }
      for (const [id, bucket] of Object.entries(stats.profiles)) {
        for (const a of newlyUnlocked(ACHIEVEMENT_CATALOG, getProfileStatsView(bucket), unlocked, id)) unlocked = { ...unlocked, [unlockedKey(a.id, id)]: at }
      }
      played++
      if (m.gameMode === 'vsCpu' && outcome.winner === 1) won++
    })
  }
  const created = nowMs - 22 * 86400000
  const profiles = PROFILES.map(({ controlScheme: _c, ...p }, i) => ({ ...p, createdAt: created + i * 400000, updatedAt: created + i * 400000 }))
  const profileExtensions = Object.fromEntries(PROFILES.map((p) => [p.id, { controlScheme: p.controlScheme }]))
  return { stats, unlocked, profiles, profileExtensions, summary: { played, cpuWins: won } }
}
`

// react-native is only reached for Platform (utils/board.ts); the physics run on the phone's layout.
const RN_STUB = "export const Platform = { OS: 'ios', select: (o) => o.ios ?? o.native ?? o.default }"

// Beside this file, so the bundle's external requires resolve from the app's node_modules.
const workDir = fs.mkdtempSync(path.join(HERE, '.generate-'))
try {
  const stub = path.join(workDir, 'react-native.mjs')
  fs.writeFileSync(stub, RN_STUB)
  const bundleFile = path.join(workDir, 'bundle.cjs')
  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundleFile,
    logLevel: 'error',
    alias: { '@': path.join(ROOT, 'src'), 'react-native': stub },
    external: ['react', 'react-redux']
  })
  const { run } = createRequire(import.meta.url)(bundleFile)
  const out = run(Date.now())
  fs.writeFileSync(path.join(HERE, 'seed.json'), JSON.stringify(out))
  const s = out.stats
  console.log(
    `${out.summary.played} matches (vs CPU ${s.vsCpu.wins}-${s.vsCpu.losses}, Two Player ${s.twoPlayer.p1Wins}-${s.twoPlayer.p2Wins}), goals ${s.goals.scored}-${s.goals.conceded}, ${s.shutouts} shutouts, best margin ${s.bestWinMargin}, day streak ${s.bestDayStreak}, ${Object.keys(out.unlocked).filter((k) => !k.includes(':')).length} device achievements`
  )
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
