/**
 * Visual playtesting, as a fixture rather than as a habit.
 *
 * Drives the real game loop from outside the browser, so a frame can be captured
 * at an exact second of an exact seed from an exact camera. That makes a visual
 * change comparable against the shot before it, which is the only way to tell
 * whether the volume actually got easier to read.
 *
 *   npx tsx tools/shoot.ts                    every mission, three moments each
 *   npx tsx tools/shoot.ts aegis 30 60        one mission at chosen seconds
 *
 * Needs the dev server up (npm run dev) and Edge installed, which on Windows it
 * always is; no browser download.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'
import { SCENARIOS } from '../src/sim/scenarios'

const OUT = 'shots'
const URL = 'http://localhost:5273'

interface Shot {
  name: string
  /** Simulated seconds to run before capturing. */
  at: number
  yaw?: number
  pitch?: number
  /**
   * Camera distance in world units. Absolute rather than relative to the theatre,
   * because a hull is an absolute size: "close enough to see a silhouette" is the
   * same distance in every mission, however big the volume around it is.
   */
  dist?: number
  /** Aim at the nearest pair of enemies instead of at the origin. */
  focus?: boolean
  /**
   * Choose the distance from what the shot wants to hold rather than from `dist`:
   * `all` backs off until every live hull is in frame, `pair` until both hulls of
   * the closest engagement are.
   */
  fit?: 'all' | 'pair'
}

const args = process.argv.slice(2)
const missions = args[0] ? SCENARIOS.filter((s) => s.id === args[0]) : SCENARIOS
const times = args.slice(1).map(Number)

/**
 * Three moments per mission: the deployment, so layout and legibility can be
 * judged; the first contact; and the middle of the fight, which is where the
 * renderer either holds together or turns into soup.
 */
const moments = (t: number[]): Shot[] =>
  t.length > 0
    ? // Framed like the melee shot, because a named second is nearly always being
      // asked about the fight rather than about the deployment.
      t.map((at) => ({ name: `t${at}`, at, pitch: 0.26, dist: 200, focus: true }))
    : [
        { name: 'deploy', at: 0.5, pitch: 0.42, fit: 'all' },
        { name: 'contact', at: 14, pitch: 0.32, dist: 460, focus: true },
        { name: 'melee', at: 34, pitch: 0.26, dist: 200, focus: true },
        // Close enough that hulls are geometry rather than points of light, which
        // is the only range at which silhouettes, trails and tracers can be judged.
        { name: 'close', at: 34, pitch: 0.18, fit: 'pair' },
      ]

/**
 * The closest a shot ever stands. A five unit hull is about a hundred pixels tall
 * from here, so it is geometry rather than a point of light, and a pair already
 * inside this radius does not drag the camera in among the hulls.
 */
const CLOSE_ROOM = 20

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('  page error:', e.message))

  for (const m of missions) {
    for (const shot of moments(times)) {
      await capture(page, m.id, shot)
    }
  }

  await browser.close()
  console.log(`\n${OUT}/ written`)
}

async function capture(page: Page, mission: string, shot: Shot): Promise<void> {
  // `auto` skips the briefing and hands blue to its autopilot, because a battle
  // where nobody is giving blue orders is a battle that never happens.
  await page.goto(`${URL}/?m=${mission}&seed=2000&auto=1`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')

  await page.evaluate(
    ({ at, yaw, pitch, dist, focus, fit, room }) => {
      const cs = (window as unknown as { cs: CsHandle }).cs
      if (at > 0) cs.advance(at)
      const c = cs.contact()
      cs.look({
        yaw: yaw ?? 0.6,
        pitch: pitch ?? 0.4,
        dist: dist ?? 600,
        at: focus ? c.at : undefined,
      })
      if (fit === 'all') cs.frame()
      if (fit === 'pair') cs.fit(c.at, Math.max(c.r, room))
    },
    {
      at: shot.at,
      yaw: shot.yaw,
      pitch: shot.pitch,
      dist: shot.dist,
      focus: shot.focus,
      fit: shot.fit,
      room: CLOSE_ROOM,
    },
  )

  // A couple of real frames so the camera easing settles and the particle pass
  // has something on screen.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const file = `${OUT}/${mission}-${shot.name}.png`
  await page.screenshot({ path: file })
  console.log(`  ${file}`)
}

interface CsHandle {
  advance(seconds: number): void
  look(opts: { yaw?: number; pitch?: number; dist?: number; at?: unknown }): void
  frame(margin?: number): void
  fit(at: unknown, r: number, margin?: number): void
  contact(): { at: unknown; r: number }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
