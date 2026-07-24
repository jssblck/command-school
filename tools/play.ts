/**
 * Playtesting the interface, as opposed to playtesting the renderer.
 *
 * tools/shoot.ts captures the volume with blue on autopilot, which says nothing
 * about whether the game can be played. This drives the real controls with real
 * clicks and keystrokes and captures what the player sees at each step, so a
 * selection ring, an order line or a device preview can be looked at instead of
 * assumed.
 *
 *   npx tsx tools/play.ts
 *
 * Needs the dev server up (npm run dev) and Edge installed.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'

const OUT = 'shots/ui'
const URL = 'http://localhost:5273'
const W = 1600
const H = 900

let n = 0

async function shot(page: Page, name: string): Promise<void> {
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file })
  console.log(`  ${file}`)
}

/** Two real frames, so camera easing settles and the particle pass has content. */
const settle = (page: Page): Promise<unknown> =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

const advance = (page: Page, seconds: number): Promise<unknown> =>
  page.evaluate((s) => (window as unknown as { cs: { advance(n: number): void } }).cs.advance(s), seconds)

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
  })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('  page error:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.error('  console:', m.text()))

  await firstBattle(page)
  await wellRun(page)
  await holdRun(page)
  await bayRun(page)
  await deviceRun(page)

  await browser.close()
  console.log(`\n${OUT}/ written`)
}

/**
 * The opening battle, played the way a first time player would: read the brief,
 * take command, pick a squadron, send it at something.
 */
async function firstBattle(page: Page): Promise<void> {
  console.log('first-contact')
  await page.goto(`${URL}/?m=first-contact&seed=2000`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')
  await settle(page)
  await shot(page, 'briefing')

  await page.click('.card button.go')
  await settle(page)
  await shot(page, 'opening')

  // Selection: one squadron, its ring, its weapon reach, its drop line.
  await page.keyboard.press('1')
  await page.mouse.move(W * 0.62, H * 0.4)
  await settle(page)
  await shot(page, 'selected')

  // The order cursor, then the order itself, caught while it is still in the
  // comm channel, which is the state the pending line exists to show.
  await page.mouse.click(W * 0.62, H * 0.4, { button: 'right' })
  await advance(page, 0.2)
  await settle(page)
  await shot(page, 'order-pending')

  await advance(page, 3)
  await settle(page)
  await shot(page, 'order-underway')

  // Altitude: shift turns the vertical axis of the mouse into height, which is
  // the one control that has to be legible or the volume is unusable.
  await page.keyboard.down('Shift')
  await page.mouse.move(W * 0.62, H * 0.22)
  await settle(page)
  await shot(page, 'altitude')
  await page.keyboard.up('Shift')

  // The attack order, which needs a contact to exist first. Waiting for one is
  // the point rather than an inconvenience: the order the player can give is a
  // function of what their squadrons can currently see.
  if (await waitForContact(page, 14)) {
    await orderAttack(page)
    await advance(page, 0.3)
    await settle(page)
    await shot(page, 'order-attack')
  }

  await advance(page, 4)
  await settle(page)
  await shot(page, 'engaged')

  // Follow, which holds a wing centred instead of recentring on it once. Three seconds is
  // long enough that a one-shot recentring would have let the wing back out to the edge of
  // the frame, so the pair with `engaged` shows what the key is for. Released again straight
  // after: everything below is of a camera the player left alone.
  await page.keyboard.press('f')
  await advance(page, 3)
  await settle(page)
  if (!(await page.evaluate('window.cs.controls.following !== null'))) {
    console.log('  nothing selected, follow shot is of a free camera')
  }
  await shot(page, 'following')
  await page.keyboard.press('f')

  // The enemy's gate is down, taken mid battle, because that is when a commander
  // would actually reach for it.
  await page.keyboard.press('g')
  await advance(page, 0.5)
  await settle(page)
  await shot(page, 'gate-down')
  await page.keyboard.press('l')

  await advance(page, 60)
  await settle(page)
  await shot(page, 'late')

  // The report only appears once the frame loop has let the last shots land.
  await page.waitForSelector('.card .stats', { timeout: 20000 }).catch(() => console.log('  no report'))
  await settle(page)
  await shot(page, 'report')
}

/** Run the battle a second at a time until an enemy hull is on our sensors. */
async function waitForContact(page: Page, limit: number): Promise<boolean> {
  for (let i = 0; i < limit; i++) {
    if (await visibleEnemy(page)) return true
    await advance(page, 1)
  }
  console.log('  no contact inside the window')
  return false
}

const visibleEnemy = (page: Page): Promise<{ x: number; y: number } | null> =>
  page.evaluate(() => {
    const cs = (window as unknown as { cs: CsHandle }).cs
    for (const s of cs.world.ships) {
      if (!s.alive || s.side !== 'red' || !cs.world.seen.blue.has(s.id)) continue
      const p = cs.project(s.pos)
      if (p) return p
    }
    return null
  })

/**
 * Right click on whatever enemy squadron is currently visible. Screen space, from
 * the page, because the harness has no business knowing the projection.
 */
async function orderAttack(page: Page): Promise<void> {
  const at = await visibleEnemy(page)
  if (!at) return
  await page.mouse.click(at.x, at.y, { button: 'right' })
}

/**
 * The transit forecast, which only has a job where a world sits in the lane. Two
 * lanes are captured from the same squadron: one clear of the planet and one
 * straight through it. The second is the one that matters, because the straight
 * order line and the curve the squadron will actually fly disagree there, and the
 * disagreement is the only warning the player gets. No hull dies of ignoring it:
 * leaders steer wide of a surface whatever they were told, so the cost is the seconds
 * the detour spends in the open, and if the second line does not read at a glance then
 * those seconds are only learnable by arriving late and being shot for it.
 */
async function wellRun(page: Page): Promise<void> {
  console.log('deep-well')
  await page.goto(`${URL}/?m=deep-well&seed=2000`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')
  await page.click('.card button.go')
  await settle(page)

  /*
   * Both aim points sit at the squadron's own height, because an order resolves
   * against a horizontal plane through the selection. The blocked lane runs through
   * the planet's centre and out the far side, which is the shortest way to
   * guarantee the straight line crosses rock. The clear one is the same run swung
   * a quarter turn off it, so it passes a couple of hundred units clear: that is
   * the lane the mission is teaching, and the point of shooting the pair is that
   * the forecast has to distinguish them before the player commits to either.
   *
   * Looking down rather than side on, because the bend is mostly horizontal. From
   * the plane of the lanes the near miss foreshortens into the blocked one and the
   * two shots become indistinguishable.
   */
  const lanes = await page.evaluate(() => {
    const cs = (window as unknown as { cs: CsHandle }).cs
    const sq = cs.world.squadrons.find((s) => s.side === 'blue')
    const planet = cs.world.bodies.find((b) => b.mu > 0)
    if (!sq || !planet) return null
    const c = sq.centroid
    // Written out twice rather than through a helper: esbuild's name shim does not
    // survive being serialised into the page, so a function declared in here throws.
    const a = Math.atan2(planet.pos.z - c.z, planet.pos.x - c.x)
    const through = { x: c.x + Math.cos(a) * 900, y: c.y, z: c.z + Math.sin(a) * 900 }
    const clear = { x: c.x + Math.cos(a + 0.46) * 900, y: c.y, z: c.z + Math.sin(a + 0.46) * 900 }
    cs.look({
      yaw: a + Math.PI / 2,
      pitch: 1.05,
      dist: 1150,
      at: { x: (c.x + through.x) / 2, y: c.y, z: (c.z + through.z) / 2 },
    })
    return { through: cs.project(through), clear: cs.project(clear) }
  })
  if (!lanes) {
    console.log('  no well found')
    return
  }

  await page.keyboard.press('1')
  if (lanes.clear) {
    await page.mouse.move(lanes.clear.x, lanes.clear.y)
    await settle(page)
    await shot(page, 'well-clear-lane')
  }
  if (lanes.through) {
    await page.mouse.move(lanes.through.x, lanes.through.y)
    await settle(page)
    await shot(page, 'well-detour-lane')
    // And once it is a live order rather than a hover, since the track has to
    // keep reading after the click while the squadron is committed to it.
    await page.mouse.click(lanes.through.x, lanes.through.y, { button: 'right' })
    await advance(page, 4)
    await settle(page)
    await shot(page, 'well-committed')
  }
}

/**
 * The one mission scored against a clock rather than against a body count, which
 * makes the seconds remaining the number the player is actually playing. It is
 * printed next to T+ and nowhere else, so this is the shot that says whether it
 * reads: caught once at the start and once with the fleet already giving ground,
 * because a countdown that is legible on a quiet frame and lost in a fight is not
 * legible.
 */
async function holdRun(page: Page): Promise<void> {
  console.log('overwhelm')
  await page.goto(`${URL}/?m=overwhelm&seed=2000`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')
  await settle(page)
  await shot(page, 'hold-briefing')

  await page.click('.card button.go')
  await settle(page)
  await shot(page, 'hold-clock')

  // Give ground: everything selected, spread wide, and away from the pursuit. The
  // point of the shot is the clock under pressure, so it wants the fight in frame.
  await page.keyboard.press('a')
  await page.keyboard.press('c')
  const away = await page.evaluate(() => {
    const cs = (window as unknown as { cs: CsHandle }).cs
    const blue = cs.world.squadrons.filter((s) => s.side === 'blue')
    if (blue.length === 0) return null
    const c = blue[0].centroid
    return cs.project({ x: c.x, y: c.y, z: c.z - 420 })
  })
  if (away) await page.mouse.click(away.x, away.y, { button: 'right' })
  await advance(page, 30)
  await settle(page)
  await shot(page, 'hold-pressed')
}

/**
 * The mission whose answer is a route rather than a target, flown the way the
 * balance harness wins it and the way a player has to issue it. An order resolves
 * where the cursor's ray meets a plane through the wing being ordered, horizontal
 * by default and facing the camera under shift, so the flanking run and the drop
 * under the ring are two separate clicks and the order of the two decides the
 * mission: flanking first covers the distance, descending first slides the fleet
 * along the start line while a bay rolls out another needle every seven seconds.
 */
async function bayRun(page: Page): Promise<void> {
  console.log('keel')
  await page.goto(`${URL}/?m=keel&seed=1000`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')
  await page.click('.card button.go')
  await settle(page)

  await page.keyboard.press('a')
  await page.keyboard.press('z')
  const flank = await page.evaluate(() => {
    const cs = (window as unknown as { cs: CsHandle }).cs
    const sq = cs.world.squadrons.find((s) => s.side === 'blue')
    if (!sq) return null
    return cs.project({ x: 640, y: sq.centroid.y, z: 60 })
  })
  if (!flank) {
    console.log('  the flank is off the frame')
    return
  }
  await page.mouse.move(flank.x, flank.y)
  await settle(page)
  await shot(page, 'bay-flank-aimed')
  await page.mouse.click(flank.x, flank.y, { button: 'right' })
  await advance(page, 22)
  await settle(page)
  await shot(page, 'bay-flanking')

  // The second leg, under the ring, which is the click that needs shift. Held down
  // across the move so the shot is of the vertical plane the order will resolve on.
  await page.keyboard.press('a')
  const under = await page.evaluate(() => {
    const cs = (window as unknown as { cs: CsHandle }).cs
    const sq = cs.world.squadrons.find((s) => s.side === 'blue')
    if (!sq) return null
    return cs.project({ x: 560, y: -180, z: sq.centroid.z })
  })
  if (under) {
    await page.keyboard.down('Shift')
    await page.mouse.move(under.x, under.y)
    await settle(page)
    await shot(page, 'bay-descent-aimed')
    await page.mouse.click(under.x, under.y, { button: 'right' })
    await page.keyboard.up('Shift')
    await advance(page, 14)
    await settle(page)
    await shot(page, 'bay-under-the-ring')
  }
}

/**
 * The device, which is the one control that needs its own pass: it is aimed in
 * free space, it can kill the fleet that threw it, and all of that has to be
 * readable before the player commits.
 */
async function deviceRun(page: Page): Promise<void> {
  console.log('last-exam')
  await page.goto(`${URL}/?m=last-exam&seed=2000`, { waitUntil: 'networkidle' })
  await page.waitForFunction('window.cs !== undefined')
  await page.click('.card button.go')
  await settle(page)
  await shot(page, 'exam-opening')

  /*
   * Both aim points are computed at the carrier's own height, and that is not a
   * detail: an order resolves against a horizontal plane through whatever is
   * selected, so a screen point taken from anywhere else lands somewhere along
   * the ray that has nothing to do with what the harness meant to aim at.
   */
  const carrier = await page.evaluate(() => {
    const cs = (window as unknown as { cs: CsHandle }).cs
    const blue = cs.world.squadrons.filter((s) => s.side === 'blue')
    const i = blue.findIndex((s) => s.device > 0)
    if (i < 0) return null
    const c = blue[i].centroid as { x: number; y: number; z: number }
    return {
      key: String(i + 1),
      // Well inside the 240 unit reach, and out in empty space.
      free: cs.project({ x: c.x, y: c.y, z: c.z + 160 }),
      // The carrier itself: reach zero, and its own hulls inside the first node.
      own: cs.project(c),
    }
  })
  if (!carrier) {
    console.log('  no carrier found')
    return
  }

  await page.keyboard.press(carrier.key)
  await page.keyboard.press('d')
  if (carrier.free) await page.mouse.move(carrier.free.x, carrier.free.y)
  await settle(page)
  await shot(page, 'device-armed')

  // Aimed at the squadron holding it, because the warning about friendly losses
  // is the whole reason the preview exists and it needs to be checked.
  if (carrier.own) {
    await page.mouse.move(carrier.own.x, carrier.own.y)
    await settle(page)
    await shot(page, 'device-on-our-own')
  }

  // The roster once the mission has taken the fleet apart. Four of the five wings
  // are gone by T+22 here, and a wiped row keeps its number and its name so no key
  // moves under the player's fingers mid battle. What it must not keep is an order:
  // a row reading engaging with no hulls behind it describes a fleet that is not there.
  // Standing the device down first, since an armed preview sits across the middle of
  // the frame and this shot is about the panel in the corner.
  await page.mouse.click(W * 0.5, H * 0.5, { button: 'right' })
  await advance(page, 24)
  await settle(page)
  await shot(page, 'exam-attrition')
}

interface CsHandle {
  world: {
    ships: { id: number; alive: boolean; side: string; pos: { x: number; y: number; z: number } }[]
    squadrons: { id: number; side: string; device: number; centroid: { x: number; y: number; z: number } }[]
    bodies: { mu: number; radius: number; pos: { x: number; y: number; z: number } }[]
    seen: { blue: Set<number> }
  }
  project(p: { x: number; y: number; z: number }): { x: number; y: number } | null
  look(opts: { yaw?: number; pitch?: number; dist?: number; at?: { x: number; y: number; z: number } }): void
  advance(seconds: number): void
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
