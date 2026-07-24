/**
 * Six of the eight missions had only ever been won by a script that calls the simulation
 * directly, or by the commander playing both sides. Neither presses a key. This plays each
 * of the six by hand through the real interface, with fog on and nothing issuing blue's
 * orders, and each plan is the reading a player takes off the briefing card rather than the
 * best line I can find.
 *
 *   npx tsx tools/hands.ts                 three seeds, six missions, a line each
 *   npx tsx tools/hands.ts 1000            one seed
 *   TRACE=shoal npx tsx tools/hands.ts     one mission, with a timeline every four seconds
 *
 * Needs the dev server up (npm run dev) and Edge installed. The hand holds the clock between
 * gestures and buys the time back a third of a second at a time, so a plan is the same battle
 * every run and a tally means something. See `open` and `beat` for why both halves of that are
 * necessary.
 *
 * Three things are recorded besides the outcome. Whether the point a plan wanted to click
 * was on screen at all, since the opening camera is the only one a player has until they
 * move it. Whether the wing a plan wanted to attack had been seen, since an order given to
 * a stale ghost is a player being lied to. And how far the order that landed sits from the
 * cross the interface drew under the cursor, since that cross is the promise a player can
 * check, plus how far the interface had to move the point to be able to say it at all, which
 * is what a volume with no floor costs to speak about.
 */
import { chromium, type Page } from 'playwright-core'
import { DEVICE_RADIUS } from '../src/sim/step'

const URL = 'http://localhost:5273'

/** What the device cost, read either side of a release: hulls, ours among them, the courier's own. */
interface Tally {
  all: number
  ours: number
  crew: number
}

interface P3 {
  x: number
  y: number
  z: number
}

const settle = (page: Page): Promise<unknown> =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

/** Set TRACE to a mission id to print that hand's timeline against the scripted one. */
const TRACE = process.env.TRACE ?? ''

/**
 * What one key or one click costs the fleet, in simulated seconds.
 *
 * The clock is held between gestures, and left at that a hand gives six wings new orders on
 * the same timestamp: the finishing loop reads the board and re-tasks the whole fleet in an
 * instant nobody can play. Charging every gesture the same slice puts a hand back at about
 * three actions a second, which is also what the old real-time harness was spending per
 * gesture without measuring it, so the plans read against the same pace they were written
 * against and now do it reproducibly.
 */
const BEAT = 0.35

/** One mission's hand. Gestures are the ones on the help line and nothing else. */
class Hand {
  readonly notes: string[] = []
  private traced = -1
  /** The last panel the hand read and did not click, kept for the note if the charge is never spent. */
  private held = ''

  constructor(
    private readonly page: Page,
    private readonly mission: string,
  ) {}

  /** The same row `wellwatch` prints for the scripted run, so the two can be read together. */
  private async trace(): Promise<void> {
    if (TRACE !== this.mission) return
    const r = (await this.page.evaluate(`(() => {
      const w = window.cs.world
      const live = (sq) => sq.ships.filter((id) => w.ships.find((s) => s.id === id && s.alive)).length
      const at = (p) => p.x.toFixed(0) + ',' + p.y.toFixed(0) + ',' + p.z.toFixed(0)
      const say = (o) => o.kind === 'move' ? 'move ' + at(o.to) : o.kind === 'hold' ? 'hold ' + at(o.at)
        : o.kind === 'attack' ? 'attack ' + ((w.squadrons.find((s) => s.id === o.sq) || {}).name || '?')
        : o.kind
      const wings = w.squadrons.filter((s) => s.side === 'blue').map((sq) =>
        sq.name + ' ' + String(live(sq)).padStart(2) + ' @' + at(sq.centroid).padEnd(16) + ' ' +
        sq.stance.padEnd(5) + ' ' + say(sq.order).padEnd(22) +
        (sq.pending ? '<- ' + say(sq.pending.order) + ' ' + sq.pending.stance : ''))
      // A question mark on a red wing means nothing of theirs in it is drawn: the hulls are
      // there and the fleet cannot see them. Reading a hand without that is guesswork, because
      // "held station while their artillery worked" and "shot at what it could see" look the
      // same in a list of orders.
      const reds = w.squadrons.filter((s) => s.side === 'red' && live(s) > 0)
        .map((sq) => sq.name + ' ' + live(sq) +
          (sq.ships.some((id) => w.seen.blue.has(id)) ? '' : '?')).join('  ')
      return 'T+' + w.t.toFixed(0).padStart(3) + ' ' + w.outcome.padEnd(7) + ' ' +
        wings.join(' | ') + ' || ' + reds
    })()`)) as string
    console.log(`      ${r}`)
  }

  /**
   * Open the mission and hold the clock on space, which is the key the player holds it with.
   *
   * The loop steps the battle off real frames, so without this every round trip out to the
   * browser spends sim time nobody chose: a camera swing, a projection and a click cost about a
   * second between them, and a re-tasking loop that reads the board and issues six orders can
   * burn ten. It is invisible while it works and it is why this file used to disagree with
   * itself, Under the Aegis taking every seed on four passes and then none of them on the
   * fifth with nothing in the game changed. Held, the clock moves only where this file says
   * it does, in `until` and a gesture at a time in `beat`, so a plan that says it looks at
   * T+44 looks at T+44 and a run means something.
   */
  async open(seed: number): Promise<void> {
    await this.page.goto(`${URL}/?m=${this.mission}&seed=${seed}&hold=1`, {
      waitUntil: 'networkidle',
    })
    await this.page.waitForFunction('window.cs !== undefined')
    await this.page.click('.card button.go')
    await settle(this.page)
  }

  /** Charge the fleet for a gesture: one key or one click, at the pace a hand works. */
  private beat(): Promise<unknown> {
    return this.page.evaluate(`window.cs.advance(${BEAT})`)
  }

  /** Roster rows are addressed by number, so a plan names the wing and this finds its key. */
  async select(name: string, add = false): Promise<void> {
    const key = (await this.page.evaluate(
      `String(window.cs.controls.roster().findIndex((s) => s.name === ${JSON.stringify(name)}) + 1)`,
    )) as string
    if (key === '0') {
      this.notes.push(`no roster row named ${name}`)
      return
    }
    await this.page.keyboard.press(add ? `Shift+${key}` : key)
    await this.beat()
  }

  async stance(shape: 'tight' | 'open' | 'wide'): Promise<void> {
    await this.page.keyboard.press(shape === 'tight' ? 'z' : shape === 'open' ? 'x' : 'c')
    await this.beat()
  }

  /**
   * A move order to a point in space, which takes a camera move first.
   *
   * A click resolves where its ray meets a plane through the wing, horizontal by default and
   * facing the camera under shift, so the reachable points are a plane and not a volume. The
   * way out is the one a player finds by dragging: swing side on to the leg you want to fly,
   * and the shift plane is the plane that holds it. This puts the camera on the perpendicular
   * and clicks once, which is the gesture a competent hand settles into.
   */
  async move(to: P3, opts: { lead?: string } = {}): Promise<void> {
    const from = await where(this.page, opts.lead ?? (await this.leadName()))
    if (!from) {
      this.notes.push(`nothing is selected to move at T+${await this.clock()}`)
      return
    }
    const leg = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    const flat = Math.hypot(leg.x, leg.z) > 1 ? { x: -leg.z, y: 0, z: leg.x } : { x: 1, y: 0, z: 0 }
    const n = Math.hypot(flat.x, flat.z)
    // Side on to the leg, level, far enough back to hold both ends of it.
    const yaw = Math.atan2(-flat.x / n, -flat.z / n)
    const span = Math.hypot(leg.x, leg.y, leg.z)
    await this.page.evaluate(`window.cs.look({
      yaw: ${yaw}, pitch: 0.05, dist: ${Math.min(4200, span * 1.5 + 320)},
      at: { x: ${(from.x + to.x) / 2}, y: ${(from.y + to.y) / 2}, z: ${(from.z + to.z) / 2} } })`)
    await settle(this.page)
    const px = (await this.page.evaluate(`window.cs.project(${JSON.stringify(to)})`)) as {
      x: number
      y: number
    } | null
    if (!px || px.x < 0 || px.y < 0 || px.x > 1600 || px.y > 900) {
      this.notes.push(`${fmt(to)} is off the frame at T+${await this.clock()} even side on to the leg`)
      return
    }
    await this.page.keyboard.down('Shift')
    await this.page.mouse.move(px.x, px.y)
    await settle(this.page)
    /*
     * The cross under the cursor, read before the click, because that is the promise the player
     * can check: the interface draws where the order will land and then puts it there. Measured
     * against the point this file wished for instead, the note blamed the game for the theatre
     * wall. Overwhelm is won pressed against the boundary and its plan keeps asking for points
     * past it, so the two standing notes, 138 and 276 units, were exactly the distance from the
     * wished point to the wall it was clamped to, drawn there and ordered there.
     */
    const cross = (await this.page.evaluate(`(() => {
      const c = window.cs.controls
      return c.aimValid ? { x: c.aim.x, y: c.aim.y, z: c.aim.z } : null
    })()`)) as P3 | null
    await this.page.mouse.click(px.x, px.y, { button: 'right' })
    await this.page.keyboard.up('Shift')
    if (!cross) {
      this.notes.push(`the cursor read nothing at ${fmt(to)} at T+${await this.clock()}`)
      await this.beat()
      return
    }
    const off = (await this.page.evaluate(`(() => {
      const w = window.cs.world
      const cross = ${JSON.stringify(cross)}
      let worst = 0
      for (const id of window.cs.controls.selected) {
        const sq = w.squadrons.find((s) => s.id === id)
        const o = sq && sq.pending && sq.pending.order
        if (!o || o.kind !== 'move') continue
        worst = Math.max(worst, Math.hypot(o.to.x - cross.x, o.to.y - cross.y, o.to.z - cross.z))
      }
      return Math.round(worst)
    })()`)) as number
    if (off > 1) this.notes.push(`the order landed ${off} from the cross drawn at ${fmt(cross)}`)
    // How far the interface had to move the point to be able to say it at all: the wall, or the
    // wing drifting out from under its own plane between the projection and the click.
    const moved = Math.round(Math.hypot(cross.x - to.x, cross.y - to.y, cross.z - to.z))
    if (moved > 60) {
      const held = Math.hypot(to.x, to.y, to.z) > (await this.bounds()) - 2
      this.notes.push(
        held
          ? `the wall held the move at ${moved} short of ${fmt(to)}`
          : `the cross sat ${moved} from ${fmt(to)} by the time it could be clicked`,
      )
    }
    await this.beat()
  }

  /**
   * The wing a gesture is measured from, which is the first one still selected.
   *
   * `controls.update` drops a wiped wing from the selection on the next frame, so an empty
   * answer here means every wing this gesture was for died inside it. That is worth a note and
   * nothing more: the notes on the losing Aegis seeds are wings dying between reading the board
   * and clicking on it, at three hulls left out of twenty four.
   */
  async leadName(): Promise<string> {
    return (await this.page.evaluate(`(() => {
      const c = window.cs.controls
      const id = [...c.selected][0]
      const sq = window.cs.world.squadrons.find((s) => s.id === id)
      return sq ? sq.name : ''
    })()`)) as string
  }

  /**
   * An attack order, put on the wing itself.
   *
   * A contact has to have been seen before there is anything on screen to click, so this
   * waits for it the way a player does, running the clock and looking, and gives up out loud.
   * It also swings the camera onto the target first, because a wing behind you is not a wing
   * you can click either.
   */
  async attack(name: string, patience = 20): Promise<void> {
    for (let waited = 0; ; waited += 2) {
      const at = (await this.page.evaluate(`(() => {
        const w = window.cs.world
        const sq = w.squadrons.find((s) => s.name === ${JSON.stringify(name)})
        if (!sq) return null
        const live = sq.ships.filter((id) => w.ships.find((s) => s.id === id && s.alive))
        const shown = live.filter((id) => w.seen.blue.has(id))
        return { live: live.length, shown: shown.length, at: sq.centroid, o: w.outcome }
      })()`)) as { live: number; shown: number; at: P3; o: string } | null
      if (!at || at.live === 0 || at.o !== 'running') return
      if (at.shown > 0) {
        const mine = await where(this.page, await this.leadName())
        if (!mine) {
          this.notes.push(`nothing is selected to send at ${name} at T+${await this.clock()}`)
          return
        }
        const d = {
          x: at.at.x - mine.x,
          y: at.at.y - mine.y,
          z: at.at.z - mine.z,
        }
        await this.page.evaluate(`window.cs.look({
          yaw: ${Math.atan2(-d.x, -d.z)}, pitch: 0.16,
          dist: ${Math.min(4200, Math.hypot(d.x, d.y, d.z) * 1.3 + 260)},
          at: { x: ${(mine.x + at.at.x) / 2}, y: ${(mine.y + at.at.y) / 2}, z: ${(mine.z + at.at.z) / 2} } })`)
        await settle(this.page)
        /*
         * Every pixel worth pointing at: their centroid first, then each hull of theirs that
         * is drawn. The centroid is empty space whenever the wing has spread around it, and on
         * Aegis it is worse than empty, because our own screen flies over their swarm and the
         * pick reads a friendly wing at forty pixels over an enemy at twenty. That bias is
         * deliberate and it is right, since a mis-picked enemy is an order that cannot be
         * recalled, but it means a click on their centroid goes out as a move order and the
         * wing it was meant to send stands still. Walking their hulls until the cursor reads
         * as them is the slide a player makes when the comm line names the wrong wing.
         *
         * One pass over the list is enough now that the clock is held: a hull is still where
         * it projected when the cursor gets there. This used to try three times and leave a
         * note measuring their nearest hull 21 and 26 pixels off an 18 pixel pick, which read
         * as a pick that could not reach and was really the world stepping through the round
         * trip.
         */
        const spots = (await this.page.evaluate(`(() => {
          const w = window.cs.world
          const sq = w.squadrons.find((s) => s.name === ${JSON.stringify(name)})
          const out = { id: sq.id, at: [], live: 0, drawn: 0 }
          const c = window.cs.project(sq.centroid)
          if (c) out.at.push(c)
          for (const id of sq.ships) {
            const s = w.ships.find((x) => x.id === id)
            if (!s || !s.alive) continue
            out.live++
            if (!w.seen.blue.has(id)) continue
            out.drawn++
            const p = window.cs.project(s.pos)
            if (p) out.at.push(p)
          }
          return out
        })()`)) as { id: number; at: { x: number; y: number }[]; live: number; drawn: number }

        let spot: { x: number; y: number } | null = null
        const tries = spots.at.slice(0, 6)
        for (const p of tries) {
          await this.page.mouse.move(p.x, p.y)
          await settle(this.page)
          if ((await this.page.evaluate('window.cs.controls.hover')) === spots.id) {
            spot = p
            break
          }
        }
        if (!spot) {
          this.notes.push(
            `nothing reads as ${name} at T+${await this.clock()}, with ${spots.live} hulls, ` +
              `${spots.drawn} of them drawn and ${tries.length} pixels tried`,
          )
          return
        }
        await this.page.mouse.click(spot.x, spot.y, { button: 'right' })
        await this.beat()
        return
      }
      if (waited >= patience) {
        this.notes.push(`${name} was still unseen after ${patience}s of waiting at T+${await this.clock()}`)
        return
      }
      if (!(await this.until(Number(await this.clock()) + 2))) return
    }
  }

  /**
   * Arm the charge, aim it at the nearest hull of theirs the carrier can see, and let go only
   * if the panel says the shot is worth taking. Returns whether it went.
   *
   * Aim at a hull rather than at empty space, because a point in space resolves on the plane
   * through the carrier and a hull is the exact place it looks like.
   *
   * Every line on the panel is there to be read, and this plan read past two of them on
   * Overwhelm. It fired at 45 on "13 of theirs and 24 of ours" and the cascade took 11 and
   * 24: the whole fleet, because a retreat that sends every wing to one point packs it into a
   * ball ten units across. Then it fired at 53 on "4 of theirs and 0 of ours" and again took 24
   * of ours, and that second one is the interesting failure, because nothing on the panel was
   * wrong. The count is a snapshot of who is standing in the burst, the release takes a comm
   * delay plus the bolt's run out at 150 to arrive, and in that second and a half the fleet flew
   * into it.
   *
   * So the rule is none of ours in the count, and the fleet flying away from the burst rather
   * than across it. Reading the panel's standoff line instead, when it was still measured against
   * the weapon's 455 rather than against the chain in front of it, refused every shot on the
   * mission: a retreat cannot buy 455 of clear space without leaving the courier where red's
   * artillery reaches it, since a lance throws 240 and takes an eye off the board with one shell,
   * so the charge went unspent and the courier died carrying it on all five seeds. Chasing that is
   * what turned up the panel's own bad line, and the panel now measures the walk it has.
   *
   * The courier is left out of that count on purpose, since it is the hull flying the charge in
   * and the panel's own zero does not save it: five releases on five seeds each read none of ours
   * and each still cost one or two. Measuring where that cost fell settles it: the courier lost
   * both its hulls on all five, one to the burst and one to whatever was shooting at it, and the
   * fleet behind it lost nothing. So the price of the charge is the wing that carries it, which is
   * the trade the mission is asking about.
   */
  private async letGo(name: string): Promise<boolean> {
    const near = (await this.page.evaluate(`(() => {
      const w = window.cs.world
      const sq = w.squadrons.find((s) => s.name === ${JSON.stringify(name)})
      if (!sq || sq.device <= 0) return null
      const live = sq.ships.filter((id) => w.ships.find((s) => s.id === id && s.alive))
      if (!live.length) return null
      let best = null, bd = Infinity
      for (const s of w.ships) {
        if (!s.alive || s.side !== 'red' || !w.seen.blue.has(s.id)) continue
        const d = Math.hypot(s.pos.x - sq.centroid.x, s.pos.y - sq.centroid.y, s.pos.z - sq.centroid.z)
        if (d < bd) { bd = d; best = s.pos }
      }
      return { t: w.t, from: sq.centroid, at: best, d: Math.round(bd) }
    })()`)) as { t: number; from: P3; at: P3 | null; d: number } | null
    if (!near?.at || near.d > 150) return false
    const d = {
      x: near.at.x - near.from.x,
      y: near.at.y - near.from.y,
      z: near.at.z - near.from.z,
    }
    await this.select(name)
    await this.page.keyboard.press('e')
    await this.page.evaluate(`window.cs.look({ yaw: ${Math.atan2(-d.x, -d.z)}, pitch: 0.34, dist: 420,
      at: { x: ${near.at.x}, y: ${near.at.y}, z: ${near.at.z} } })`)
    await settle(this.page)
    const px = (await this.page.evaluate(`window.cs.project(${JSON.stringify(near.at)})`)) as P3 | null
    if (!px) {
      await this.page.keyboard.press('Escape')
      return false
    }
    await this.page.mouse.move(px.x, px.y)
    await settle(this.page)
    // The panel counts who is standing in the walk now; closing counts who is on their way into
    // it. A hull under the courier's own flag flying at the burst is the one the snapshot cannot
    // see, so it is read here off the same velocities the sim integrates.
    const shot = (await this.page.evaluate(`(() => {
      const s = window.cs.controls.shot
      if (!s) return null
      const w = window.cs.world
      const sq = w.squadrons.find((q) => q.name === ${JSON.stringify(name)})
      const at = ${JSON.stringify(near.at)}
      let closing = 0
      for (const h of w.ships) {
        if (!h.alive || h.side !== 'blue' || (sq && sq.ships.includes(h.id))) continue
        const o = { x: h.pos.x - at.x, y: h.pos.y - at.y, z: h.pos.z - at.z }
        if (h.vel.x * o.x + h.vel.y * o.y + h.vel.z * o.z < 0) closing++
      }
      return { ok: s.ok, range: Math.round(s.range), red: s.cascade.red, blue: s.cascade.blue,
        bite: s.cascade.reach + ${DEVICE_RADIUS}, standoff: s.standoff, closing }
    })()`)) as
      | {
          ok: boolean
          range: number
          red: number
          blue: number
          bite: number
          standoff: number
          closing: number
        }
      | null
    if (!shot) this.notes.push(`no panel with a hull ${near.d} out under the cursor`)
    if (!shot?.ok || !shot.red || shot.blue || shot.closing) {
      if (shot?.ok) {
        this.held = `at ${shot.range} it read ${shot.red} of theirs, ${shot.blue} of ours, ` +
          `with ${shot.closing} of ours flying at it and ` +
          `${Number.isFinite(shot.standoff) ? Math.round(shot.standoff) : 'nobody'} out ` +
          `of a chain that walks ${Math.round(shot.bite)}`
      }
      await this.page.keyboard.press('Escape')
      return false
    }
    const tally = `(() => {
      const w = window.cs.world
      const sq = w.squadrons.find((q) => q.name === ${JSON.stringify(name)})
      return {
        all: w.stats.deviceKills,
        ours: w.stats.friendlyDeviceKills,
        crew: sq ? sq.ships.filter((id) => w.ships.find((s) => s.id === id && s.alive)).length : 0,
      }
    })()`
    const before = (await this.page.evaluate(tally)) as Tally
    await this.page.mouse.click(px.x, px.y)
    await this.beat()
    // Four seconds is the bolt out at 150 plus the whole walk, which is fourteen generations on
    // a 0.13 fuse. The panel is a forecast, and a harness that prints one without the outcome
    // beside it is reporting a promise as a result. Everything the tally does not attribute to
    // us is theirs, which holds because red carries no charge on any of the six missions here:
    // TAPER on the Last Exam is the only one that does.
    await this.until(near.t + 4)
    const after = (await this.page.evaluate(tally)) as Tally
    const ours = after.ours - before.ours
    const crew = before.crew - after.crew
    this.held = ''
    this.notes.push(
      `released at ${shot.range} on a panel reading ${shot.red} of theirs and none of ours, ` +
        `nobody of the fleet flying at it, the nearest ${Math.round(shot.standoff)} out ` +
        `of a chain that walks ${Math.round(shot.bite)}; ` +
        `it took ${after.all - before.all - ours} of theirs and ${ours} of ours, ` +
        `and the courier lost ${crew} of its own in the same four seconds`,
    )
    return true
  }

  /**
   * Finish it.
   *
   * A plan that stops talking leaves its last wings holding station with nothing to do, and
   * the clock runs on with two hulls against one. That reads as a stalemate and is really a
   * commander who walked away, so every plan ends here: keep naming what the objective names
   * if it names anything, otherwise whatever of theirs is nearest and on the plot, and keep
   * saying it until the mission is decided.
   */
  async mop(deadline: number): Promise<void> {
    for (;;) {
      const t = Number(await this.clock())
      if (t >= deadline) return
      const pick = (await this.page.evaluate(`(() => {
        const w = window.cs.world
        const live = (sq) => sq.ships.filter((id) => w.ships.find((s) => s.id === id && s.alive))
        const mine = w.squadrons.filter((s) => s.side === 'blue' && live(s).length)
        const guns = mine.filter((s) => s.cls !== 'eye').map((s) => s.name)
        // A wing already engaged with something that is still alive is a wing doing its job.
        // Nobody talks over that, which is why this looks at the order the wing is flying.
        const busy = mine.filter((s) => {
          if (s.order.kind !== 'attack') return false
          const on = w.squadrons.find((x) => x.id === s.order.sq)
          return !!on && live(on).length > 0
        }).map((s) => s.name)
        // Nearest, but never their scout while anything of theirs that shoots is still on the
        // plot: sending the fleet after an unarmed hull is how a wing ends up standing in
        // artillery it never saw.
        //
        // What the objective names outranks both. On a mission scored by two named wings, the
        // nearest rule is a commander fighting the wrong battle: their bays put another five
        // needles on the board every seven seconds, so the nearest armed thing is always fresh
        // and the guns never reach the thing that is making it.
        const named = w.objective.targets || []
        let want = null, bd = Infinity, armed = false, keel = false
        for (const sq of w.squadrons) {
          if (sq.side !== 'red') continue
          const shown = live(sq).filter((id) => w.seen.blue.has(id))
          if (!shown.length) continue
          const shoots = sq.cls !== 'eye'
          const wanted = named.includes(sq.name)
          if (keel && !wanted) continue
          if (armed && !shoots && !wanted) continue
          for (const m of mine) {
            const d = Math.hypot(sq.centroid.x - m.centroid.x, sq.centroid.y - m.centroid.y,
              sq.centroid.z - m.centroid.z)
            if (d < bd || (wanted && !keel) || (shoots && !armed)) {
              bd = d; want = sq.name; armed = shoots; keel = wanted
            }
          }
        }
        // Nothing of theirs on the plot is not nothing to do: the dim outlines are where they
        // were, and a blind fleet that stands still is a blind fleet being shelled. Only the
        // fresh ones, though. A mark ten seconds old is a contact that just slipped out of
        // reach; a mark thirty seconds old is usually a hull that died where nobody could see
        // it, and the fleet that goes there is walking to a funeral.
        let go = null
        if (!want) {
          let n = 0, x = 0, y = 0, z = 0
          for (const g of w.ghosts.values()) {
            if (w.t - g.at > 10) continue
            n++; x += g.pos.x; y += g.pos.y; z += g.pos.z
          }
          if (n) go = { x: x / n, y: y / n, z: z / n }
        }
        return { guns: guns, busy: busy, want: want, go: go }
      })()`)) as {
        guns: string[]
        busy: string[]
        want: string | null
        go: P3 | null
      }
      if (pick.want && pick.guns.length) {
        for (let i = 0; i < pick.guns.length; i++) await this.select(pick.guns[i], i > 0)
        await this.attack(pick.want, 2)
      } else if (pick.go) {
        const idle = pick.guns.filter((n) => !pick.busy.includes(n))
        for (let i = 0; i < idle.length; i++) await this.select(idle[i], i > 0)
        if (idle.length) await this.move(pick.go)
      }
      // Four seconds, because a lance volleys every 2.6 and one shell takes a needle off the
      // board. This used to re-read the board every eight, which on Shoal is how three lances
      // died holding station: their artillery climbed out of the belt at T+29 and the order to
      // shoot back went in at T+38, three volleys after it was drawn.
      if (!(await this.until(t + 4))) return
    }
  }

  /**
   * Keep giving ground, which is what one mission asks for in place of a finish.
   *
   * `mop` is the wrong ending for a mission scored on lasting 90 seconds: it names whatever of
   * theirs is nearest, and a fleet outnumbered two to one that turns and fights the pursuit is
   * a fleet being counted. Overwhelm ended in `mop` and died at 69 seconds of the 90 on two
   * seeds in three, the notes filling with wings waiting on artillery they were never going to
   * see, which is the plan clicking at fog rather than reading the card.
   *
   * So the ending is the card: put the fleet 300 further from their centre of mass and say it
   * again six seconds later, which is what the scripted plan does with `hold` orders. Their
   * centre of mass is only the part of it the fleet can see, since a hand cannot average over
   * hulls nobody has found.
   *
   * A carrier is run out of the same loop instead of being watched in a phase of its own, and
   * that is the whole difference between this holding 90 seconds and not. Watching for the
   * release costs the rest of the fleet its re-tasking for as long as the watch lasts, so the
   * retreat stops while the pursuit does not, and a courier that rides inside the retreat is a
   * charge released in the middle of its own fleet. Here the fleet gives ground while the
   * courier hangs back into the pursuit, so the gap grows about 450 a cadence and the burst
   * happens where the fleet is not.
   *
   * The fleet is re-tasked every six seconds and the panel is read every two, because those
   * are different jobs. A retreat re-stated more often than that is a fleet that never gets
   * anywhere, while the release is a window a few seconds wide: the courier is two hulls with
   * no guns, and on the cadence that first put it behind the fleet the pursuit reached it and
   * killed it between one look at the panel and the next, with the charge still aboard and the
   * fleet 475 clear.
   */
  async withdraw(deadline: number, carrier?: string): Promise<void> {
    let charge = carrier ?? ''
    let restation = -1
    for (;;) {
      const t = Number(await this.clock())
      if (t >= deadline) break
      const read = (await this.page.evaluate(`(() => {
        const w = window.cs.world
        const mid = (ps) => ps.reduce((a, p) => ({
          x: a.x + p.x / ps.length, y: a.y + p.y / ps.length, z: a.z + p.z / ps.length,
        }), { x: 0, y: 0, z: 0 })
        const carrier = ${JSON.stringify(charge)}
        const live = (sq) => sq.ships.filter((id) => w.ships.find((s) => s.id === id && s.alive)).length
        const wings = w.squadrons.filter((s) => s.side === 'blue' && live(s) && s.name !== carrier)
        const ours = w.ships.filter((s) => s.alive && s.side === 'blue').map((s) => s.pos)
        if (!ours.length) return null
        const seen = w.ships.filter((s) => s.alive && s.side === 'red' && w.seen.blue.has(s.id))
        // Fresh ghosts when nothing of theirs is lit, because a pursuit that has just gone dark
        // is still coming from the same direction it was last seen coming from.
        const from = seen.length ? seen.map((s) => s.pos)
          : [...w.ghosts.values()].filter((g) => w.t - g.at <= 10).map((g) => g.pos)
        if (!from.length) return null
        const b = mid(ours), c = mid(from)
        const d = { x: b.x - c.x, y: b.y - c.y, z: b.z - c.z }
        const n = Math.hypot(d.x, d.y, d.z)
        if (n < 1) return null
        const sq = w.squadrons.find((s) => s.name === carrier)
        // Held inside the theatre, because "300 further out" means as far out along this line as
        // the board has: from T+30 or so this fleet is against the wall, and asking for a point
        // past it had the plan clicking 300 into the void and the harness reporting the clamp that
        // caught it as an interface fault, nine times a seed.
        const out = (p) => {
          const r = Math.hypot(p.x, p.y, p.z), keep = w.bounds - 2
          return r > keep ? { x: p.x * keep / r, y: p.y * keep / r, z: p.z * keep / r } : p
        }
        return {
          wings: wings.map((s) => s.name),
          away: out({ x: b.x + (d.x / n) * 300, y: b.y + (d.y / n) * 300, z: b.z + (d.z / n) * 300 }),
          // The carrier goes the other way by half as much, which is the rearguard. Sending it
          // at the biggest knot of theirs instead is what the scripted plan does, and by hand it
          // flew the courier clean across the theatre at a wing that was never the pursuit: dead
          // at T+18 with the charge still aboard, on a knot 800 the wrong side of the retreat.
          rear: { x: b.x - (d.x / n) * 150, y: b.y - (d.y / n) * 150, z: b.z - (d.z / n) * 150 },
          armed: !!sq && sq.device > 0,
          alive: !!sq && live(sq) > 0,
        }
      })()`)) as { wings: string[]; away: P3; rear: P3; armed: boolean; alive: boolean } | null
      if (charge && read && !(read.armed && read.alive)) {
        // Still armed and no longer flying means the courier was caught carrying it, which is the
        // most common ending on Overwhelm and used to leave nothing in the notes but an incidental
        // complaint that nothing was selected to move.
        if (read.armed) {
          this.notes.push(
            `${charge} was killed at T+${Math.round(t)} with the charge still aboard` +
              (this.held ? `; last panel ${this.held}` : ', having never had a shot on the panel'),
          )
        }
        charge = ''
      } else if (charge && (await this.letGo(charge))) charge = ''
      if (read && t >= restation) {
        restation = t + 6
        if (read.wings.length) {
          for (let i = 0; i < read.wings.length; i++) await this.select(read.wings[i], i > 0)
          await this.move(read.away)
        }
        if (charge) {
          await this.select(charge)
          await this.move(read.rear)
        }
      }
      if (!(await this.until(t + 2))) return
    }
    if (charge) {
      this.notes.push(
        `the charge was still aboard at T+${await this.clock()}` +
          (this.held ? `; last panel ${this.held}` : ', having never had a shot on the panel'),
      )
    }
  }

  /**
   * Run the clock until a wing has arrived, which is how a player paces a route: the next leg
   * is given when the wing is there, not when a stopwatch says so. Pace on the slowest wing in
   * the group, or the fast ones sit alone at the waypoint while the guns are still crossing.
   */
  async arrive(to: P3, opts: { pace?: string; within?: number; patience?: number } = {}): Promise<void> {
    const within = opts.within ?? 140
    const patience = opts.patience ?? 60
    const start = Number(await this.clock())
    for (;;) {
      const lead = opts.pace ?? (await this.leadName())
      const at = lead ? await where(this.page, lead) : null
      if (!at) return
      if (Math.hypot(at.x - to.x, at.y - to.y, at.z - to.z) < within) return
      const now = Number(await this.clock())
      if (now - start >= patience) {
        this.notes.push(`${lead} was still ${fmt(at)} at T+${now.toFixed(0)}, short of ${fmt(to)}`)
        return
      }
      if (!(await this.until(now + 2))) return
    }
  }

  /**
   * Run the clock until a named enemy wing is off the board, or until the deadline. The phase
   * a plan is waiting on is usually something happening rather than a stopwatch: "their swarm
   * is gone, now go for their guns" is a reading a player can act on, and a fixed sixty
   * seconds is a guess at when that will be true.
   */
  async gone(name: string, deadline: number): Promise<void> {
    for (;;) {
      const t = Number(await this.clock())
      if (t >= deadline) return
      const live = (await this.page.evaluate(`(() => {
        const w = window.cs.world
        const sq = w.squadrons.find((s) => s.name === ${JSON.stringify(name)})
        if (!sq) return 0
        return sq.ships.filter((id) => w.ships.find((s) => s.id === id && s.alive)).length
      })()`)) as number
      if (live === 0) return
      if (!(await this.until(Number(await this.clock()) + 2))) return
    }
  }

  /** Run the clock to a wall time, stopping early if the mission is decided. */
  async until(t: number): Promise<boolean> {
    for (let i = 0; i < 200; i++) {
      const now = (await this.page.evaluate('({ t: window.cs.world.t, o: window.cs.world.outcome })')) as {
        t: number
        o: string
      }
      if (now.t >= this.traced + 4) {
        this.traced = now.t
        await this.trace()
      }
      if (now.o !== 'running') return false
      if (now.t >= t) return true
      await this.page.evaluate(`window.cs.advance(${Math.min(2, t - now.t)})`)
      await settle(this.page)
    }
    return true
  }

  clock = async (): Promise<string> => ((await this.page.evaluate('window.cs.world.t')) as number).toFixed(0)

  /** The radius of the theatre, which is what a move order past it gets clamped to. */
  bounds = async (): Promise<number> => (await this.page.evaluate('window.cs.world.bounds')) as number

  async result(): Promise<string> {
    const r = (await this.page.evaluate(`(() => {
      const w = window.cs.world
      const live = (side) => w.ships.filter((s) => s.alive && s.side === side).length
      const start = (side) => w.ships.filter((s) => s.side === side).length
      return { t: w.t, o: w.outcome, blue: live('blue'), blue0: start('blue'), red: live('red'), red0: start('red') }
    })()`)) as {
      t: number
      o: string
      blue: number
      blue0: number
      red: number
      red0: number
    }
    return `${r.o.padEnd(7)} at ${r.t.toFixed(0).padStart(3)}s, ours ${r.blue}/${r.blue0}, theirs ${r.red}/${r.red0}`
  }
}

const fmt = (p: P3): string => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`

/** Where a wing is right now, or nothing if the plan is talking about a wing it has lost. */
const where = (page: Page, name: string): Promise<P3 | null> =>
  page.evaluate(`(() => {
    const sq = window.cs.world.squadrons.find((s) => s.name === ${JSON.stringify(name)})
    return sq ? { x: sq.centroid.x, y: sq.centroid.y, z: sq.centroid.z } : null
  })()`) as Promise<P3 | null>

interface Plan {
  mission: string
  /** The reading of the brief this plan is testing, in one line. */
  reading: string
  fly(h: Hand, page: Page): Promise<void>
}

const PLANS: Plan[] = [
  {
    mission: 'first-contact',
    reading: 'move up the corridor, then put the wing on them once they are on screen',
    async fly(h) {
      await h.select('HOPPER')
      await h.move({ x: 20, y: 10, z: 20 })
      await h.attack('DRIFT')
      await h.mop(60)
    },
  },
  {
    mission: 'gate-is-down',
    reading: 'needles massed through the lane the moon buys, lances holding wide behind them',
    async fly(h) {
      await h.select('LOVELACE')
      await h.stance('wide')
      await h.until(1)
      await h.select('HOPPER')
      await h.stance('tight')
      // Around the near side of Cusp rather than over it, which is the lane out of THORN's
      // cone the card is pointing at.
      await h.move({ x: 170, y: 60, z: 60 })
      await h.until(14)
      await h.attack('DRIFT')
      await h.until(30)
      await h.select('LOVELACE')
      await h.attack('DRIFT')
      await h.mop(90)
    },
  },
  {
    mission: 'deep-well',
    reading: 'over the top of Sorrow and down the far side, both wings together, then mob their artillery',
    async fly(h) {
      // Over the top rather than around the side, which is the route the scripted plan wins
      // with: the question here is only whether a hand can say it.
      const legs = [
        { x: -40, y: 300, z: 20 },
        { x: 120, y: 60, z: 260 },
      ]
      for (const leg of legs) {
        await h.select('HOPPER')
        await h.select('LOVELACE', true)
        await h.stance('tight')
        await h.move(leg)
        // Paced on the guns rather than the needles: LOVELACE is the slow wing, and the needles
        // waiting for it is the whole point of going around.
        await h.arrive(leg, { pace: 'LOVELACE' })
      }
      // Both wings onto their artillery at once, needles open so one bracket cannot take the
      // wing and the guns tight, which is what they are for.
      await h.select('HOPPER')
      await h.stance('open')
      await h.attack('THORN', 30)
      await h.select('LOVELACE')
      await h.stance('tight')
      await h.attack('THORN', 20)
      // Straight into the finishing loop rather than sitting on the two orders until T+70.
      // The scripted plan that wins this mission twelve times in twelve re-reads the board
      // every two seconds, and the gap between the two is what a hand actually loses here:
      // once THORN is wrecked the wings hold station on nothing, and 40 seconds of that is
      // long enough for the needles they were mobbing to come back around.
      await h.mop(140)
    },
  },
  {
    mission: 'shoal',
    reading:
      'eye out wide and kept there, the fleet over the belt rather than through it, their lances first',
    async fly(h) {
      /*
       * The eye holds one post through the whole first half and does not move, and the post is
       * a number: it sees 470, the longest gun in the volume reaches 240, and the brawl happens
       * at our own line, so a post 330 off that line and level with it watches everything in
       * the fight while nothing of theirs can touch it. Selecting the wing draws both circles,
       * which is what took the numbers off this comment and put them on the plot where a player
       * can fly to them.
       *
       * There are two ways to get this wrong and I flew both, each of them costing the fleet its
       * sensors. Read the standoff off their artillery alone and a post at -200,210,90 clears
       * their lances by 400 while sitting 440 from fourteen needles that would rather shoot a
       * scout than anything else on the board: both eyes were dead by T+13, before the guns were
       * in range of anything. Measure the standoff off whatever is nearest on the plot instead,
       * so the post moves as they move, and the arithmetic tears itself apart: once their swarm
       * is in among our guns the leg from the nearest mark to our own line is 200 long, pushing
       * the station out to 400 along it puts the wing a couple of hundred units behind the
       * fleet, and which mark is nearest changes every few seconds. On seed 1000 that walked the
       * scout to 600 behind the fight with the only working sensors in the fleet aboard, and
       * clamping the leg so it could not overshoot our line walked it into the swarm instead,
       * dead at T+27. What a scout stands behind is its own fleet, and that is a place rather
       * than a formula.
       */
      await h.select('WINLOCK')
      await h.stance('wide')
      await h.move({ x: -330, y: 210, z: -70 })
      /*
       * The line stands on our own side of the belt, high, and lets their needles come up to
       * it. Crossing over the top to meet them was the reading I flew first and it is the wrong
       * one, because the far side is where their needles and their artillery both are: twelve
       * needles walked into that and were wiped by T+23 in two runs of three, which left the
       * lances to fight the second half of the battle alone.
       *
       * Nothing descends into the belt, because it blinds and grinds whatever is inside.
       */
      await h.select('HOPPER')
      await h.stance('open')
      await h.move({ x: -20, y: 190, z: -60 })
      // Two hundred behind the screen and level with it, which is the number that matters: a
      // lance reaches 240 and a needle 100, so from here their guns cover the brawl our
      // needles are in and nothing in it can reach back. Held at the deployment line the wing
      // is out of the fight, and walked forward with the screen it is just a soft needle.
      await h.select('LOVELACE')
      await h.stance('tight')
      await h.move({ x: 10, y: 200, z: -250 })
      /*
       * Their swarm first, with the artillery, and the order goes in the moment the swarm is
       * drawn rather than on a count: a lance one-shots a needle, so three of them shelling a
       * wing of fourteen is three needles a volley, and how many volleys land before the two
       * swarms meet is the whole battle. Waiting until T+14 to say it costs two of them.
       *
       * The plan used to save the lances for their artillery on the argument that artillery is
       * the answer to artillery. That argument spends the screen first and then fights the
       * second half a wing down.
       */
      await h.select('LOVELACE')
      await h.attack('SHOAL', 40)
      await h.gone('SHOAL', 120)
      /*
       * Their artillery is the second half of the mission and it is a seeing contest rather
       * than a shooting one: three lances against three, both reaching 240, so whoever is drawn
       * first dies. They win that contest from inside the rock, where a 470 sensor reads 150 and
       * a lance's own 240 reads 77, which is how their guns cross the belt unseen and open at a
       * range the fleet has nothing drawn to answer. On seed 1000 it was the whole loss: THORN
       * climbed out at T+29 and all three of ours were wrecked by T+41 without firing.
       *
       * So the scout goes forward and low, into the gap between our guns and the rock, because
       * that is the one thing that beats the trick. Their artillery has to come inside 240 of our
       * lances to shoot them, the approach passes underneath this post, and 150 is enough to
       * catch it there. The wing is inside their reach while it does this and that is the price:
       * a scout is two points, a volley spent on one is a volley not spent on a lance, and either
       * way our guns get the first answer they have had all mission.
       */
      await h.select('WINLOCK')
      await h.move({ x: 0, y: 150, z: -60 })
      await h.mop(200)
    },
  },
  {
    mission: 'aegis',
    reading: 'guns onto the screens, needles onto their swarm, our own screen walking with the needles',
    async fly(h, page) {
      const liveRed = async (): Promise<string[]> =>
        (await page.evaluate(`(() => {
          const w = window.cs.world
          return w.squadrons.filter((s) => s.side === 'red' &&
            s.ships.some((id) => w.ships.find((x) => x.id === id && x.alive))).map((s) => s.name)
        })()`)) as string[]

      /*
       * The field goes over the needles, and that is the card read the other way round. Their
       * screens make our small arms worthless, which is the half the card says out loud; ours
       * does the same to theirs, and that half is where the mission is won, because sixteen of
       * their needles do 2.6 a bolt and a field bites 2.4 out of every one of them. Over the
       * guns it buys almost nothing: what shoots at artillery is artillery, and 34 minus 2.4 is
       * still three bolts to a lance.
       *
       * Flown with the screen over the guns instead, the needles fought their swarm in the open
       * and went from sixteen to six in the ten seconds after contact, and the whole plan won
       * two seeds in five.
       */
      const guns = { x: 40, y: 10, z: -240 }
      const swarm = { x: -60, y: 50, z: -200 }
      await h.select('LOVELACE')
      await h.stance('tight')
      await h.move(guns)
      await h.select('HOPPER')
      await h.stance('open')
      await h.move(swarm)
      await h.select('WINLOCK')
      await h.stance('tight')
      await h.move(swarm)
      await h.arrive(guns, { pace: 'LOVELACE' })
      // Sixteen needles against a field that bites every bolt is exactly the arithmetic the
      // card says we lose, so the swarm is the needles' work and the screens are the guns'.
      await h.select('HOPPER')
      await h.attack('DRIFT', 40)
      await h.select('LOVELACE')
      await h.attack('HUSK', 40)
      // An order names a place, never a wing to follow, so keeping our screen over the brawl is
      // something the commander has to keep saying, from the moment the shooting starts and on
      // the cadence the shooting happens at. This used to open at T+42 on a fourteen second
      // cadence, which is a screen that arrives twenty seconds after the fight and then holds
      // station on where the fight was: on three of five seeds it was already dead at its
      // deployment station before the loop said anything to it at all.
      for (let t = 16; t < 120; t += 6) {
        if (!(await h.until(t))) break
        const at = await where(page, 'HOPPER')
        if (at) {
          await h.select('WINLOCK')
          await h.move(at)
        }
        const live = await liveRed()
        const want = ['HUSK', 'THORN', 'DRIFT'].find((n) => live.includes(n))
        if (!want) break
        await h.select('LOVELACE')
        await h.attack(want, 4)
        if (!live.includes('DRIFT')) {
          await h.select('HOPPER')
          await h.attack(want, 4)
        }
      }
      await h.mop(190)
    },
  },
  {
    mission: 'keel',
    reading: 'wide of their artillery and in at the bays from behind, then everything onto one keel',
    async fly(h) {
      // The card says three things and they add up to one route: their six lances cover the
      // straight line to both bays, every heavy hull in the volume is slow, and the fleet does
      // not have to sweep anything. So the fleet goes out past their guns and comes at the bays
      // from behind, which is two waypoints and then a normal fight against the thing it came for.
      const legs = [
        { x: 640, y: -300, z: 60 },
        { x: 560, y: -180, z: 700 },
      ]
      for (const leg of legs) {
        await h.select('HOPPER')
        await h.select('LOVELACE', true)
        await h.select('WINLOCK', true)
        await h.stance('tight')
        await h.move(leg)
        // Paced on the guns, which are the wing that has to arrive: nine lances are the only
        // thing in the fleet that gets through 700 of hull, and the screen only matters where
        // they are standing.
        await h.arrive(leg, { pace: 'LOVELACE' })
      }
      // Needles open for the arrival, because what answers a fleet at the bays is five fresh
      // needles at a time out of them, and a tight wing hands a bracket the whole thing.
      await h.select('HOPPER')
      await h.stance('open')
      await h.mop(220)
    },
  },
  {
    mission: 'overwhelm',
    reading: 'give ground, spend the charge on the pursuit, keep opening the range',
    async fly(h) {
      // One direction chosen off the briefing camera, since the first leg is the only one a
      // commander gives before knowing anything, and after that the fleet's own back is the
      // reading: `withdraw` keeps putting it 300 further from whatever it can see of them.
      await h.select('HOPPER')
      await h.select('LOVELACE', true)
      await h.select('WINLOCK', true)
      await h.stance('open')
      await h.move({ x: -260, y: 120, z: -620 })
      // Then the retreat runs itself, courier included: JOHNSON walks at the pursuit while the
      // rest back away from it, so the charge goes off behind the fleet rather than inside it.
      //
      // No turning to name their artillery, which is what this plan used to do: THORN was still
      // unseen after twenty seconds of waiting on all three seeds, because a fleet that is
      // opening the range is a fleet that never has their guns on screen. Twenty seconds of
      // clicking at fog is not a reading of this card, it is the plan refusing to believe the
      // mission is about giving ground.
      await h.withdraw(140, 'JOHNSON')
    },
  },
]

async function main(): Promise<void> {
  const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1000, 2273, 4242]
  const browser = await chromium.launch({
    channel: 'msedge',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
  })
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  })
  page.on('pageerror', (e) => console.error('  page error:', e.message))

  const tally: string[] = []
  for (const plan of PLANS) {
    if (TRACE && plan.mission !== TRACE) continue
    console.log(`\n${plan.mission}: ${plan.reading}`)
    let won = 0
    for (const seed of seeds) {
      const h = new Hand(page, plan.mission)
      await h.open(seed)
      await plan.fly(h, page)
      const line = await h.result()
      if (line.startsWith('won')) won++
      console.log(`  seed ${seed}: ${line}`)
      for (const n of h.notes) console.log(`      ${n}`)
    }
    tally.push(`${plan.mission.padEnd(14)} ${won} of ${seeds.length}`)
  }

  console.log('\nflown by hand off the briefing card:')
  for (const line of tally) console.log(`  ${line}`)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
