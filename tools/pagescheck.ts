/**
 * Does the production build boot from a path prefix?
 *
 * On GitHub Pages the site is served from /<repo>/ rather than from the root, and
 * an asset URL that misses the prefix fails silently: the page is a black canvas
 * with a 404 in a console nobody is reading. This loads the built site the way
 * Pages serves it, presses through the briefing, and checks the simulation is
 * running and the console is clean.
 *
 *   npx vite preview --port 4173
 *   npx tsx tools/pagescheck.ts
 */
import { chromium } from 'playwright-core'

const URL = process.argv[2] ?? 'http://localhost:4173/commandschool/'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const complaints: string[] = []
page.on('console', (m) => {
  if (m.type() === 'error') complaints.push(m.text())
})
page.on('pageerror', (e) => complaints.push(String(e)))
page.on('requestfailed', (r) => complaints.push(`${r.failure()?.errorText} ${r.url()}`))

await page.goto(`${URL}?m=deep-well&seed=1000`, { waitUntil: 'networkidle' })
await page.waitForFunction('window.cs !== undefined')
await page.click('.card button.go')
await page.evaluate('window.cs.advance(6)')

const state = (await page.evaluate(
  `(() => {
    const w = window.cs.world
    return { mission: window.cs.scenario.id, t: w.t, hulls: w.ships.filter((s) => s.alive).length }
  })()`,
)) as { mission: string; t: number; hulls: number }

const shot = await page.screenshot()
// A briefing that never handed over leaves the volume empty, and an asset that
// failed to load leaves the canvas black, so the frame is worth weighing.
const lit = shot.length

console.log(`${URL} -> ${state.mission} at T+${state.t.toFixed(1)} with ${state.hulls} hulls, frame ${lit} bytes`)
for (const c of complaints) console.log(`  ${c}`)
await browser.close()
process.exit(complaints.length === 0 && state.t > 5 && state.hulls > 0 ? 0 : 1)
