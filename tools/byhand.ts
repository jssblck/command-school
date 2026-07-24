/**
 * Plays the Last Exam through the interface a person has to use, and checks that the
 * arming panel is telling the truth while it does.
 *
 * Every other harness calls into the simulation directly, which means none of them can
 * see the game. This one presses number keys, moves a mouse, reads the panel out of
 * `controls.shot`, and bets the mission on what the panel says, because that number is
 * what a player bets the mission on. Six defects turned up here that the balance sweeps
 * read straight through, and all six were the interface promising a shot the simulation
 * would not fire.
 *
 *   npx tsx tools/byhand.ts                 eight seeds, a tally at the end
 *   npx tsx tools/byhand.ts 2091            one seed, verbose, writes shots/
 *
 * Needs the dev server up (npm run dev) and Edge installed.
 *
 * The autopilot keeps the four escort wings, which stands in for the continuous command
 * a player gives everything not carrying the charge. The courier is flown by hand: the
 * question is whether the release can be made through the real panel, not whether a
 * script can beat the mission.
 */
import { mkdirSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'

const OUT = 'shots'
const URL = 'http://localhost:5273'
const SEEDS = [2273, 2091, 2000, 3001, 4242, 5150, 7777, 1234]

/** What the arming panel currently promises, in the terms the release is bet on. */
interface Panel {
  range: number
  ok: boolean
  red: number
  blue: number
  standoff: number
  off: number
  surface: boolean
}

/** One drawn frame, so `project` and `controls.shot` answer for the view on screen. */
const beat = (page: Page, seconds: number) =>
  page.evaluate((s) => (window as unknown as { cs: any }).cs.advance(s), seconds)

const read = (page: Page): Promise<Panel | null> =>
  page.evaluate(() => {
    const cs = (window as unknown as { cs: any }).cs
    const s = cs.controls.shot
    if (!s) return null
    return {
      range: s.range,
      ok: s.ok,
      red: s.cascade.red,
      blue: s.cascade.blue,
      standoff: s.standoff,
      off: s.objective ? s.objective.off : NaN,
      surface: s.surface,
    }
  })

async function fly(page: Page, seed: number, loud: boolean): Promise<string> {
  const note = (line: string) => {
    if (loud) console.log(line)
  }

  // `hold=1` starts the battle stopped, so every second of it is a second this file asked for.
  // The loop steps the simulation off real frames, so without it the release moved a second or
  // two between runs on the frame rate alone, and a second or two is the whole window the shot
  // is judged in.
  await page.goto(`${URL}/?m=last-exam&seed=${seed}&auto=1&hold=1`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')
  await beat(page, 0.05)

  const courierKey = await page.evaluate(() => {
    const cs = (window as unknown as { cs: any }).cs
    const i = cs.controls.roster().findIndex((sq: any) => sq.device > 0)
    cs.pilot.reserved.add(cs.controls.roster()[i].id)
    return String(i + 1)
  })

  // Frame the whole corridor so the planet and the fleet are both on screen, which is
  // what a player does before giving the first order.
  //
  // Yaw is the direction from the look-at point toward the camera, not the way the camera
  // faces, so standing behind blue and looking up the corridor at the enemy gate is yaw
  // pi. Getting this backwards put the camera on the far side of the homeworld and every
  // ray in the probe pointed out into empty space.
  await page.evaluate(() => {
    const cs = (window as unknown as { cs: any }).cs
    const home = cs.world.bodies.find((b: any) => b.consumable)
    cs.look({ yaw: Math.PI, pitch: 0.28, dist: 1500, at: { x: 0, y: 0, z: home.pos.z * 0.2 } })
  })
  // The rig eases toward a new pose over frames, so a photograph taken three ticks after
  // a swing this size is a photograph of the old pose.
  await beat(page, 1)
  if (loud) await page.screenshot({ path: `${OUT}/byhand-open.png` })

  /** Where the homeworld is on screen right now, recomputed because the camera moves. */
  const hivePx = () =>
    page.evaluate(() => {
      const cs = (window as unknown as { cs: any }).cs
      return cs.project(cs.world.bodies.find((b: any) => b.consumable).pos)
    })

  // Everyone but the courier: first wing, then shift the rest on. Number keys are how the
  // roster is addressed, so this is the real gesture and not a shortcut.
  const keys = ['1', '2', '3', '4', '5'].filter((k) => k !== courierKey)
  await page.keyboard.press(keys[0])
  for (const k of keys.slice(1)) await page.keyboard.press(`Shift+${k}`)

  let px = await hivePx()
  if (!px) throw new Error('the homeworld is not in the opening view, so a player could not click it')
  await page.mouse.move(px.x, px.y)
  await beat(page, 0.05)
  await page.mouse.click(px.x, px.y, { button: 'right' })

  // Ten seconds in, put the escort onto the nearest thing they can reach. Sending them at
  // the planet and never speaking again loses every time, which is correct: the escort's
  // job is to be worth shooting at, and a wing crossing a corridor in silence is not
  // holding anybody's attention.
  await beat(page, 10)
  const knot = await page.evaluate(() => {
    const cs = (window as unknown as { cs: any }).cs
    const w = cs.world
    const blues = w.ships.filter((s: any) => s.alive && s.side === 'blue')
    if (!blues.length) return null
    const c = blues.reduce(
      (a: any, s: any) => ({
        x: a.x + s.pos.x / blues.length,
        y: a.y + s.pos.y / blues.length,
        z: a.z + s.pos.z / blues.length,
      }),
      { x: 0, y: 0, z: 0 },
    )
    let best: any = null
    let near = Infinity
    for (const sq of w.squadrons) {
      if (sq.side !== 'red') continue
      if (!sq.ships.some((id: number) => w.ships.find((s: any) => s.id === id)?.alive)) continue
      const d = Math.hypot(sq.centroid.x - c.x, sq.centroid.y - c.y, sq.centroid.z - c.z)
      if (d < near) {
        near = d
        best = sq
      }
    }
    return best ? { px: cs.project(best.centroid), name: best.name } : null
  })
  if (knot?.px) {
    await page.mouse.move(knot.px.x, knot.px.y)
    await beat(page, 0.05)
    await page.mouse.click(knot.px.x, knot.px.y, { button: 'right' })
    note(`  escort onto ${knot.name}`)
  }

  // Eighteen seconds is the whole plan. Hold the courier back while the escort crosses,
  // because a carrier flies at seven tenths speed and arriving first means arriving alone.
  await beat(page, 8)
  await page.evaluate(() => (window as unknown as { cs: any }).cs.frame(1.05))
  await beat(page, 0.05)
  if (loud) await page.screenshot({ path: `${OUT}/byhand-18s.png` })

  /**
   * A pixel on the planet with nothing of theirs under the cursor.
   *
   * Pointing at the middle of the homeworld does not mean the homeworld: whichever
   * garrison wing is drawn in front of it wins the cursor, so the right click becomes
   * "engage DRIFT" and the courier stops in the corridor to fight. The comm line says so,
   * and a player reading it slides the cursor onto bare rock. This is that slide.
   */
  const bareSkin = async (centre: { x: number; y: number }) => {
    const clear = async () => {
      await beat(page, 0.05)
      return page.evaluate(() => {
        const cs = (window as unknown as { cs: any }).cs
        return cs.controls.hover === null && cs.controls.aimValid
      })
    }
    await page.mouse.move(centre.x, centre.y)
    if (await clear()) return centre
    for (const r of [14, 26, 40, 80, 130]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        const spot = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r }
        await page.mouse.move(spot.x, spot.y)
        if (await clear()) return spot
      }
    }
    await page.mouse.move(centre.x, centre.y)
    return centre
  }

  await page.keyboard.press(courierKey)
  // Spread before the run in. THORN's artillery reaches two hundred and forty and a tight
  // wing takes a bracket together, so the scripted plan flies the courier wide and a
  // player has the same key. Leaving it out cost the wing every run: ten hulls to zero
  // between thirty seven and forty four seconds, three hundred and eighty short.
  await page.keyboard.press('c')
  px = await hivePx()
  if (px) {
    const spot = await bareSkin(px)
    await page.mouse.click(spot.x, spot.y, { button: 'right' })
  }

  // Checked three times a second rather than every two seconds. The window is the whole
  // mission: a courier that releases at a hundred and twenty still has nine of its ten
  // hulls, and one that keeps closing to eighty is down to three and dies inside the comm
  // delay with the charge still aboard.
  let released = ''
  for (let i = 0; i < 90 && !released; i++) {
    await beat(page, 0.7)
    // Ride in over the courier's shoulder, looking down the run. The camera sits opposite
    // the way the wing is going, so the yaw is the reverse of the heading to the target.
    const look = await page.evaluate(() => {
      const cs = (window as unknown as { cs: any }).cs
      const w = cs.world
      const sq = w.squadrons.find((s: any) => s.side === 'blue' && s.device > 0)
      const home = w.bodies.find((b: any) => b.consumable)
      if (!sq) return { t: w.t, outcome: w.outcome, live: 0, skin: NaN }
      const live = sq.ships.filter((id: number) => w.ships.find((s: any) => s.id === id)?.alive).length
      if (live > 0) {
        const d = { x: home.pos.x - sq.centroid.x, y: home.pos.y - sq.centroid.y, z: home.pos.z - sq.centroid.z }
        cs.look({ yaw: Math.atan2(-d.x, -d.z), pitch: 0.12, dist: 330, at: sq.centroid })
      }
      const skin =
        Math.hypot(sq.centroid.x - home.pos.x, sq.centroid.y - home.pos.y, sq.centroid.z - home.pos.z) - home.radius
      return { t: w.t, outcome: w.outcome, live, skin }
    })
    if (look.outcome !== 'running') return `${look.outcome} at ${look.t.toFixed(0)}s, over before the release`
    if (look.live === 0) return `courier gone at ${look.t.toFixed(0)}s, ${look.skin.toFixed(0)} short of the skin`

    // Let the follow camera arrive before projecting through it.
    await beat(page, 0.4)
    await page.keyboard.press('d')
    px = await hivePx()
    if (px) await page.mouse.move(px.x, px.y)
    await beat(page, 0.05)
    let panel = await read(page)

    // A shot that reads "catches Hive" without ending on the rock is a different shot: it
    // arms against hulls and goes off at the first one it passes. Small nudges first, since
    // a rock two hundred out is a small disc and forty pixels is already past the limb.
    if (px && panel?.ok && (panel.off > 0 || !panel.surface)) {
      const centre = px
      let found = false
      for (const r of [14, 26, 40, 80, 130]) {
        for (let k = 0; k < 8 && !found; k++) {
          const a = (k / 8) * Math.PI * 2
          const spot = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r }
          await page.mouse.move(spot.x, spot.y)
          await beat(page, 0.05)
          const probe = await read(page)
          if (probe?.ok && probe.off <= 0 && probe.surface) {
            panel = probe
            px = spot
            found = true
          }
        }
      }
      if (!found) await page.mouse.move(centre.x, centre.y)
    }
    if (panel) {
      note(
        `  t=${look.t.toFixed(0)}s courier ${look.live} hulls, ${look.skin.toFixed(0)} off the skin: ` +
          `range ${panel.range.toFixed(0)} ${panel.ok ? 'in reach' : 'OUT OF REACH'}, ` +
          `${panel.surface ? 'on a skin' : 'FUSED'}, ` +
          `${panel.off <= 0 ? 'catches Hive' : `${panel.off.toFixed(0)} shy of Hive`}, ` +
          `takes ${panel.red} of theirs and ${panel.blue} of ours`,
      )
    }

    // Spend the charge only on what the panel actually promises. It will happily say "in
    // reach, FUSED, 292 shy of Hive, takes 25 of theirs" when a garrison wing is drawn
    // across the rock, and every word of that is true: it is a good shot at a crowd and it
    // is not the mission.
    if (!panel?.ok || !panel.surface || panel.off > 0) {
      await page.keyboard.press('Escape')
      continue
    }
    // The aim is live and this harness is slow. A hull drifting across a cursor that never
    // moved can turn "the flash itself catches Hive" into "110 shy, takes 32 of theirs"
    // between the read and the click, and a person's eye and hand are on the same frame.
    const still = await read(page)
    if (!still?.ok || !still.surface || still.off > 0) {
      note('      the aim moved under the cursor before the click, so hold')
      await page.keyboard.press('Escape')
      continue
    }
    if (loud) await page.screenshot({ path: `${OUT}/byhand-armed.png` })
    if (px) await page.mouse.click(px.x, px.y)
    released = `at ${panel.range.toFixed(0)} with ${look.live} of ten aboard`
    note(`      released ${released}`)
  }
  if (!released) return 'never released'

  for (let i = 0; i < 12; i++) {
    await beat(page, 1.5)
    const o = await page.evaluate(() => {
      const w = (window as unknown as { cs: any }).cs.world
      const home = w.bodies.find((b: any) => b.consumable)
      return { t: w.t, outcome: w.outcome, integrity: home.integrity, nodes: w.nodes.length }
    })
    if (loud && o.nodes > 4) await page.screenshot({ path: `${OUT}/byhand-cascade.png` })
    if (o.outcome !== 'running') {
      if (loud) {
        await beat(page, 0.05)
        await page.screenshot({ path: `${OUT}/byhand-end.png` })
        const said = await page.evaluate(() =>
          (window as unknown as { cs: any }).cs.controls.log.slice(-5).map((l: any) => `${l.at.toFixed(0)} ${l.text}`),
        )
        for (const l of said) console.log(`  | ${l}`)
      }
      // The range and the hulls left are the two numbers a release is judged on, so they go on
      // the tally line rather than only into the verbose run: eight seeds that all won says
      // nothing about whether they won the same way.
      return `${o.outcome} at ${o.t.toFixed(0)}s, Hive at ${o.integrity.toFixed(2)}, released ${released}`
    }
  }
  return 'released, still running at the end of the watch'
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : SEEDS
  const loud = seeds.length === 1

  let browser: Browser | undefined
  try {
    browser = await chromium.launch({
      channel: 'msedge',
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
    })
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.error('  page error:', e.message))

    let won = 0
    for (const seed of seeds) {
      const result = await fly(page, seed, loud)
      if (result.startsWith('won')) won++
      console.log(`seed ${seed}: ${result}`)
    }
    console.log(`\nflown by hand through the real panel: won ${won} of ${seeds.length}`)
  } finally {
    await browser?.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
