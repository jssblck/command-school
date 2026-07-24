/**
 * Headless playtest harness.
 *
 * The sim has no three.js dependency, so a battle can be run thousands of times
 * faster than real time with a commander driving both sides. That gives real
 * numbers for the questions that matter: is a mission winnable, is it winnable
 * too easily, does the fight end in a reasonable span, and does either fleet
 * hold a structural advantage at equal points.
 *
 *   npx tsx tools/balance.ts            full campaign sweep
 *   npx tsx tools/balance.ts duel       equal-points class matchups
 *   npx tsx tools/balance.ts screen     whether an aegis screen earns its points
 *   npx tsx tools/balance.ts well       verify the planet mission is about route
 *   npx tsx tools/balance.ts bays       verify the keel mission has a way through
 *   npx tsx tools/balance.ts hold       verify the survive mission is holdable
 *   npx tsx tools/balance.ts exam       verify the last mission is solvable
 */
import { makeCommander, think, type Commander, type CommanderConfig } from '../src/sim/ai'
import {
  DEVICE_RANGE,
  DEVICE_REACH,
  deviceAim,
  DT,
  issueOrder,
  issueStance,
  previewCascade,
  step,
} from '../src/sim/step'
import { SCENARIOS, scenarioById } from '../src/sim/scenarios'
import type { ClassId, Objective, Squadron, World } from '../src/sim/types'
import { aliveCount, createWorld, addSquadron, fleetStrength, squadronsOf } from '../src/sim/world'
import { add, clone, dist, normalize, scale, sub, v3, type Vec3 } from '../src/sim/vec3'

const CAP_SECONDS = 300

interface Result {
  outcome: 'won' | 'lost' | 'timeout'
  seconds: number
  bluePoints: number
  redPoints: number
  blueStart: number
  redStart: number
  deviceKills: number
  friendlyDeviceKills: number
}

function run(
  world: World,
  enemy: Commander,
  blue: Commander | null,
  hook?: (w: World) => void,
): Result {
  while (world.outcome === 'running' && world.t < CAP_SECONDS) {
    think(world, enemy, DT)
    if (blue) think(world, blue, DT)
    hook?.(world)
    step(world)
  }
  return {
    outcome: world.outcome === 'running' ? 'timeout' : world.outcome,
    seconds: world.t,
    bluePoints: fleetStrength(world, 'blue'),
    redPoints: fleetStrength(world, 'red'),
    blueStart: world.stats.blueStart,
    redStart: world.stats.redStart,
    deviceKills: world.stats.deviceKills,
    friendlyDeviceKills: world.stats.friendlyDeviceKills,
  }
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`
const pad = (s: string, n: number) => s.padEnd(n)
const padL = (s: string, n: number) => s.padStart(n)

function campaign(trials = 12, blueCfg: Partial<CommanderConfig> = { aggression: 0.6, skill: 0.55 }) {
  console.log(`\ncampaign sweep, ${trials} trials per mission, both sides on AI`)
  console.log(
    pad('mission', 20) +
      padL('win', 6) +
      padL('loss', 6) +
      padL('t/o', 5) +
      padL('secs', 7) +
      padL('blue kept', 11) +
      padL('red kept', 10) +
      padL('points', 12),
  )
  for (const scenario of SCENARIOS) {
    let won = 0
    let lost = 0
    let timeout = 0
    let secs = 0
    let blueKept = 0
    let redKept = 0
    let ratio = ''
    for (let i = 0; i < trials; i++) {
      const { world, enemy } = scenario.build(1000 + i * 77)
      if (!ratio) ratio = `${world.stats.blueStart}v${world.stats.redStart}`
      const blue = makeCommander('blue', blueCfg)
      const r = run(world, enemy, blue)
      if (r.outcome === 'won') won++
      else if (r.outcome === 'lost') lost++
      else timeout++
      secs += r.seconds
      blueKept += r.bluePoints / Math.max(1, r.blueStart)
      redKept += r.redPoints / Math.max(1, r.redStart)
    }
    console.log(
      pad(scenario.name, 20) +
        padL(pct(won, trials), 6) +
        padL(pct(lost, trials), 6) +
        padL(pct(timeout, trials), 5) +
        padL((secs / trials).toFixed(0), 7) +
        padL(pct(blueKept, trials), 11) +
        padL(pct(redKept, trials), 10) +
        padL(ratio, 12),
    )
  }
}

/**
 * Equal-points head to head for every class pairing, to check the triangle.
 * Aegis is left out on purpose: a screen has a token gun, so a duel it is in can
 * only ever draw, and `screens()` asks the question that actually decides whether
 * its points are worth spending.
 */
// Twenty four rather than ten because ten is not enough to read: a mirror matchup
// measured at ten trials came back 70/30 and sits at 59/41 over eighty runs, so the
// first table was reporting noise as a class advantage.
function duels(trials = 24) {
  const kinds: ClassId[] = ['needle', 'lance', 'keel']
  const budget = 24
  const costs: Record<ClassId, number> = { needle: 1, lance: 3, aegis: 3, keel: 9, eye: 2 }
  console.log(`\nequal-points duels at ${budget} points, ${trials} trials each`)
  console.log(pad('', 10) + kinds.map((k) => padL(k, 12)).join(''))
  for (const a of kinds) {
    let row = pad(a, 10)
    for (const b of kinds) {
      let wins = 0
      let stales = 0
      for (let i = 0; i < trials; i++) {
        const objective: Objective = { kind: 'annihilate', text: 'duel' }
        const w = createWorld(500 + i * 31, objective, 700)
        w.commLag = 0.5
        const na = Math.max(1, Math.round(budget / costs[a]))
        const nb = Math.max(1, Math.round(budget / costs[b]))
        addSquadron(w, { side: 'blue', cls: a, name: 'A', count: na, at: v3(0, 0, -220), facing: v3(0, 0, 1) })
        addSquadron(w, { side: 'red', cls: b, name: 'B', count: nb, at: v3(0, 0, 220), facing: v3(0, 0, -1) })
        const r = run(w, makeCommander('red', { skill: 0.5 }), makeCommander('blue', { skill: 0.5 }))
        if (r.outcome === 'won') wins++
        else if (r.outcome === 'timeout') stales++
      }
      row += padL(`${pct(wins, trials)}${stales ? ` /${pct(stales, trials)}s` : ''}`, 12)
    }
    console.log(row)
  }
  console.log('read as: row class wins this often against column class, /s = stalemate rate')
}

/**
 * Does a screen earn its points? A support class cannot be judged by whether it
 * wins fights, only by whether the same points spent on it beat the same points
 * spent on more guns. Run one blue fleet both ways against the same enemy, and
 * do it against a swarm and against artillery, because the field is supposed to
 * be the answer to the first and no answer at all to the second.
 */
function screens(trials = 24) {
  const budget = 24
  console.log(`\nscreen value at ${budget} points, ${trials} trials each`)
  console.log(pad('', 22) + padL('vs swarm', 12) + padL('vs artillery', 14))

  const build = (screened: boolean, enemy: ClassId) => (seed: number) => {
    const w = createWorld(seed, { kind: 'annihilate', text: 'duel' }, 700)
    w.commLag = 0.5
    if (screened) {
      addSquadron(w, { side: 'blue', cls: 'lance', name: 'GUNS', count: 6, at: v3(0, 0, -220), facing: v3(0, 0, 1) })
      // Close in front of the guns, so the field actually covers them.
      addSquadron(w, { side: 'blue', cls: 'aegis', name: 'SCREEN', count: 2, at: v3(0, 0, -190), facing: v3(0, 0, 1) })
    } else {
      addSquadron(w, { side: 'blue', cls: 'lance', name: 'GUNS', count: 8, at: v3(0, 0, -220), facing: v3(0, 0, 1) })
    }
    const count = enemy === 'needle' ? 24 : 8
    addSquadron(w, { side: 'red', cls: enemy, name: 'THEM', count, at: v3(0, 0, 220), facing: v3(0, 0, -1) })
    return w
  }

  for (const screened of [false, true]) {
    let row = pad(screened ? 'six guns and a screen' : 'eight guns, no screen', 22)
    for (const enemy of ['needle', 'lance'] as ClassId[]) {
      let wins = 0
      for (let i = 0; i < trials; i++) {
        const w = build(screened, enemy)(500 + i * 31)
        const r = run(w, makeCommander('red', { skill: 0.5 }), makeCommander('blue', { skill: 0.5 }))
        if (r.outcome === 'won') wins++
      }
      row += padL(pct(wins, trials), enemy === 'needle' ? 12 : 14)
    }
    console.log(row)
  }
}

/**
 * The survive mission is the one the campaign sweep loses more often than it wins,
 * and a win rate cannot tell the difference between a mission that is too hard and
 * a commander that plays it badly. So play it the way the objective is worded: hold
 * the volume, not a position. The fleet keeps opening the range from red's centre of
 * mass while the two scouts run the charge into the thickest part of the pursuit.
 *
 * The plan this replaced parked the whole fleet inside its own aegis screen, which is
 * what the fleet composition seems to suggest and holds one run in twelve: three fields
 * cannot cover twenty five hulls against a fleet that outnumbers them, and standing
 * still lets red arrive all at once instead of strung out behind.
 *
 * This plan is also what set the mission's clock, since it is never wiped at any clock
 * length out to 200 seconds. Whether it wins is therefore not what the clock decides;
 * what the clock decides is how long the plans that plant themselves last, and those
 * die at a median of 78 seconds standing still and 86 behind Anvil.
 */
function hold(trials = 12) {
  const scenario = scenarioById('overwhelm')!
  console.log(`\noverwhelm, ${trials} runs with a scripted "give ground and charge the pursuit" plan`)
  let held = 0
  let secs = 0
  let fires = 0
  let kept = 0

  /**
   * Densest knot within reach, what a charge there would take, and how far the rest of
   * the fleet is standing from the burst.
   *
   * The standoff skips the courier's own wing for the same reason the panel does: a
   * legal shot is within 130 and the cascade walks 455, so counting the carrier makes
   * the number a constant. Judging the shot on the old count of blue hulls inside the
   * blast was what broke this plan when the charge started landing where it was aimed.
   * That count is structurally zero, so the gate passed every time, and the plan spent
   * its charge in twelve runs of twelve and finished with one percent of the fleet.
   */
  const bestShot = (w: World, carrier: number, from: Vec3) => {
    let at: Vec3 | null = null
    let take = 0
    let standoff = 0
    for (const sq of squadronsOf(w, 'red')) {
      if (dist(from, sq.centroid) > DEVICE_RANGE * 0.9) continue
      // Aimed the way the panel aims it, so the count is the count the burst gets.
      const burst = deviceAim(w, from, sq.centroid)
      const p = previewCascade(w, burst)
      if (p.red <= take) continue
      take = p.red
      at = clone(sq.centroid)
      standoff = Infinity
      for (const s of w.ships) {
        if (!s.alive || s.side !== 'blue' || s.sq === carrier) continue
        standoff = Math.min(standoff, dist(s.pos, burst))
      }
    }
    return { at, take, standoff }
  }

  for (let i = 0; i < trials; i++) {
    const { world, enemy } = scenario.build(1000 + i * 77)
    // The plan owns every wing, including the scouts: they carry the charge here, so
    // running them is the plan rather than a side errand.
    const blue = makeCommander('blue', { aggression: 0.4, skill: 0.55 })
    const mine = squadronsOf(world, 'blue')
    const screen = mine.find((sq) => sq.cls === 'aegis')!
    const carrier = mine.find((sq) => sq.device > 0)!
    for (const sq of mine) blue.reserved.add(sq.id)

    let restation = 0
    let shot = false

    const r = run(world, enemy, blue, (w) => {
      // Keep opening the range from red's centre of mass. Standing still loses every
      // run in twelve: three fields cannot cover a fleet that outnumbers you two to
      // one, and the objective says hold the volume rather than hold a position, so
      // the whole volume is available to spend. Putting Anvil between the fleet and
      // the mass is the plan that looks clever and holds two runs in twelve, because
      // a rock that blocks fire also pins you against something red can englobe.
      if (w.t >= restation) {
        restation = w.t + 6
        const reds = w.ships.filter((s) => s.alive && s.side === 'red')
        const c = v3()
        for (const s of reds) {
          c.x += s.pos.x / reds.length
          c.y += s.pos.y / reds.length
          c.z += s.pos.z / reds.length
        }
        const blues = w.ships.filter((s) => s.alive && s.side === 'blue')
        const b = v3()
        for (const s of blues) {
          b.x += s.pos.x / blues.length
          b.y += s.pos.y / blues.length
          b.z += s.pos.z / blues.length
        }
        const post = add(b, scale(normalize(sub(b, c)), 300))
        const carrying = carrier.device > 0 && !shot
        for (const sq of mine) {
          if (aliveCount(w, sq) === 0) continue
          // The courier is flying its own errand until the charge is away, and gets
          // pulled back into the retreat afterwards like everyone else.
          if (carrying && sq.id === carrier.id) continue
          issueOrder(w, sq, { kind: 'hold', at: clone(post) }, sq.id === screen.id ? 'tight' : 'wide')
        }
        // Send it at the biggest knot, which is the pursuit: red arrives strung out
        // behind a fleet that keeps backing away, so the knot is usually the wing that
        // committed hardest and is furthest from the rest of blue.
        if (carrying && aliveCount(w, carrier) > 0) {
          let knot: Vec3 | null = null
          let most = 0
          for (const sq of squadronsOf(w, 'red')) {
            const n = aliveCount(w, sq)
            if (n > most) {
              most = n
              knot = sq.centroid
            }
          }
          if (knot && dist(carrier.centroid, knot) > DEVICE_RANGE * 0.8) {
            issueOrder(w, carrier, { kind: 'move', to: clone(knot) }, 'tight')
          }
        }
      }
      if (shot || carrier.device <= 0 || carrier.deviceLock > 0 || aliveCount(w, carrier) === 0) return
      const { at, take, standoff } = bestShot(w, carrier.id, carrier.centroid)
      // Worth a charge, and the fleet it is being fired for is clear of the walk.
      if (at && take >= 10 && standoff >= DEVICE_REACH) {
        issueOrder(w, carrier, { kind: 'device', to: at })
        shot = true
        fires++
      }
    })
    if (r.outcome === 'won') held++
    secs += r.seconds
    kept += r.bluePoints / Math.max(1, r.blueStart)
  }
  console.log(
    `  held ${pct(held, trials)} (${held}/${trials}), mean ${(secs / trials).toFixed(0)}s of the 90 asked for, ` +
      `${pct(kept, trials)} of the fleet left, charge spent in ${fires}/${trials}`,
  )
}

/**
 * The last mission cannot be solved by trading hulls, so the generic commander
 * will always lose it. This checks that the intended solution is reachable: the
 * fleet goes in first and the carrier leaves a beat behind it, straight at the
 * planet, while the defence is busy coming forward to meet everybody else.
 *
 * If a scripted plan this crude cannot land the shot, the mission is not hard,
 * it is impossible, and that is a design bug rather than a difficulty setting.
 *
 * The beat is the whole plan and it is worth stating what it costs to get wrong,
 * because the number came out of a sweep rather than out of taste. Launching with
 * the fleet wins one run in twelve, eighteen seconds later wins ten, and the curve
 * either side is gentle: ten seconds wins six, twenty two wins seven, and by
 * thirty four it is down to three. Late is worse than early, since by then the
 * escort has been ground up and the defence is free again. The plan that came
 * before this one staged the carrier high and wide of the fight before diving,
 * which was free when a carrier flew at full speed and now wins two runs in twelve:
 * carrying costs a third of the wing's speed, so the extra distance is paid in
 * seconds handed to the defence.
 */
// Twenty four runs rather than ten. The plan wins roughly half of them, and ten
// samples of a coin cannot tell 30 percent from 50: an earlier pass read 3/10 here
// against 6/12 from the same seeds driven in a different order, which is noise being
// mistaken for a regression.
function exam(trials = 24) {
  const scenario = scenarioById('last-exam')!
  console.log(`\nlast exam, ${trials} runs with a scripted "send the fleet, then the courier" plan`)
  let won = 0
  let secs = 0
  let fires = 0
  const times: number[] = []
  for (let i = 0; i < trials; i++) {
    const { world, enemy } = scenario.build(2000 + i * 91)
    // Deliberately timid: the escort's job is to be shot at, not to win.
    const blue = makeCommander('blue', { aggression: 0.9, skill: 0.4 })
    const home = world.bodies.find((b) => b.consumable)!
    // The plan owns the carrier; the commander screens with everything else.
    const runnerId = world.squadrons.find((sq) => sq.side === 'blue' && sq.device > 0)!.id
    blue.reserved.add(runnerId)

    // A new order replaces whatever is still in the comm channel, so re-issuing
    // every tick would reset the delay forever and nothing would ever land.
    // Only speak when the plan actually changes phase.
    let phase: 'wait' | 'fire' | 'done' = 'wait'
    const r = run(world, enemy, blue, (w) => {
      if (w.tick % 20 !== 0) return
      const runner = squadronsOf(w, 'blue').find((sq) => sq.id === runnerId)
      if (!runner) return
      // The shape travels like the order does. Asking on every pass is safe because naming a
      // shape a wing is already flying says nothing and sends nothing; otherwise this would
      // put a fresh signal on the wire every second and nothing would ever arrive.
      issueStance(w, runner, 'wide')
      const reach = (p: Vec3) =>
        Math.hypot(runner.centroid.x - p.x, runner.centroid.y - p.y, runner.centroid.z - p.z)

      if (phase === 'wait') {
        // Sitting on the deployment line while the rest of the fleet closes.
        if (w.t < 18) return
        issueOrder(w, runner, { kind: 'move', to: clone(home.pos) })
        phase = 'fire'
      } else if (phase === 'fire' && runner.deviceLock <= 0) {
        // Aimed at the planet the way a player clicks on it, and judged by where
        // the charge would actually go off: the near skin, not the centre.
        if (reach(deviceAim(w, runner.centroid, home.pos)) < DEVICE_RANGE * 0.9) {
          issueOrder(w, runner, { kind: 'device', to: clone(home.pos) })
          fires++
          phase = 'done'
        }
      }
    })
    if (r.outcome === 'won') {
      won++
      times.push(r.seconds)
    }
    secs += r.seconds
  }
  console.log(
    `  won ${pct(won, trials)} (${won}/${trials}), ${fires} charges fired, mean run ${(secs / trials).toFixed(0)}s` +
      (times.length ? `, mean win at ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)}s` : ''),
  )
}

/**
 * The Bay Doors, played the way its geometry asks to be played: around their artillery
 * rather than through it.
 *
 * THORN is six lances holding high over the ring, covering the straight line to both
 * bays. A lance does 34 and a needle has 32, so anything small that crosses in the open
 * is one-shot at 240, and an aegis field bites 2.4 out of a bolt that size, which is
 * nothing. Lances move at thirty and keels at seventeen, so the whole defence is too slow
 * to answer a fleet that swings wide and comes at the bays from behind. That is the whole
 * plan: two waypoints and then a normal fight against the thing you came for.
 *
 * The numbers that chose this over the alternatives, twelve runs each on the shipped
 * mission: straight in 0 percent, cross in the giant's shadow 0, clear their artillery
 * first 0, hold inside your own screen and make them come 0. Every one of them died in
 * the middle of the volume. The flank wins 7 of 12 while the generic commander still
 * loses every run, which is the shape a back half mission wants: there is something to
 * see, and pointing squadrons at whatever is nearest does not see it.
 */
function bays(trials = 12) {
  const scenario = scenarioById('keel')!
  console.log(`\nthe bay doors, ${trials} runs with a scripted "go around their artillery" plan`)
  let won = 0
  let secs = 0
  let kept = 0
  let closed = 0

  for (let i = 0; i < trials; i++) {
    const { world, enemy } = scenario.build(1000 + i * 77)
    const blue = makeCommander('blue', { aggression: 0.6, skill: 0.55 })
    const mine: Record<string, Squadron> = {}
    for (const sq of squadronsOf(world, 'blue')) {
      mine[sq.cls] = sq
      blue.reserved.add(sq.id)
    }
    // Out to the flank, deep past the bays, then in. Legs advance on arrival rather than
    // on a clock, so a fleet held up on the way does not get left behind by its own plan.
    const legs = [v3(640, -300, 60), v3(560, -180, 700)]
    let leg = 0
    let next = 0

    const r = run(world, enemy, blue, (w) => {
      if (w.t < next) return
      next = w.t + 2
      const guns = mine.lance
      const anchor = aliveCount(w, guns) > 0 ? guns.centroid : mine.needle.centroid
      if (leg < legs.length && dist(anchor, legs[leg]) < 130) leg++

      const target = squadronsOf(w, 'red')
        .filter((sq) => (sq.name === 'COIL' || sq.name === 'SPIRAL') && aliveCount(w, sq) > 0)
        .sort((a, b) => dist(anchor, a.centroid) - dist(anchor, b.centroid))[0]

      for (const sq of Object.values(mine)) {
        if (aliveCount(w, sq) === 0) continue
        // The scout stays where it was put: it sees 470 and dies to anything.
        if (sq.cls === 'eye') continue
        if (leg < legs.length) {
          issueOrder(w, sq, { kind: 'move', to: clone(legs[leg]) }, 'tight')
        } else if (sq.cls === 'lance' && target) {
          issueOrder(w, sq, { kind: 'attack', sq: target.id }, 'tight')
        } else {
          // Needles and the screen both stand on the guns: the needles to intercept what
          // comes for them, the screen to make small arms worth two tenths a bolt.
          issueOrder(w, sq, { kind: 'hold', at: clone(anchor) }, sq.cls === 'needle' ? 'open' : 'tight')
        }
      }
    })
    if (r.outcome === 'won') won++
    secs += r.seconds
    kept += r.bluePoints / Math.max(1, r.blueStart)
    // Scanned off `world.squadrons` rather than `squadronsOf`, which only returns
    // squadrons that still have hulls: the ones this wants to count are the wiped ones.
    closed += world.squadrons.filter(
      (sq) => (sq.name === 'COIL' || sq.name === 'SPIRAL') && aliveCount(world, sq) === 0,
    ).length
  }
  console.log(
    `  won ${pct(won, trials)} (${won}/${trials}), mean ${(secs / trials).toFixed(0)}s, ` +
      `${pct(kept, trials)} of the fleet left, bays closed ${closed}/${trials * 2}`,
  )
}

/**
 * Deep Well reads 8 percent for the generic commander, which is the same kind of reading
 * The Bay Doors gave before it turned out to be unwinnable, and the harness had no plan to
 * tell those two cases apart. Blue is outpointed 24 to 25 and holds four lances against
 * five, and a lance one-shots a needle, so twelve of blue's twenty four points are food if
 * they have to cross open volume in front of artillery.
 *
 * Route is the whole mission, and six plans over twelve runs each settle it: straight in
 * wins 3, straight while massing on their guns wins 0, and every way around the rock wins
 * 11 or 12, over the top, under, or swinging wide of the well. Target priority rides along
 * for free once the route is right (over the top takes all twelve either way) and costs
 * three runs without it, since naming the guns from the start line is an order to march at
 * them.
 *
 * So the mission is fair and the low generic rate is the mission working: pointing
 * squadrons at whatever is nearest walks them across the front of five lances.
 */
function well(trials = 12) {
  const scenario = scenarioById('deep-well')!
  console.log(`\ndeep well, ${trials} runs with a scripted "go around the rock, guns first" plan`)
  let won = 0
  let secs = 0
  let kept = 0

  for (let i = 0; i < trials; i++) {
    const { world, enemy } = scenario.build(1000 + i * 77)
    const blue = makeCommander('blue', { aggression: 0.6, skill: 0.55 })
    const mine: Record<string, Squadron> = {}
    for (const sq of squadronsOf(world, 'blue')) {
      mine[sq.cls] = sq
      blue.reserved.add(sq.id)
    }
    // Over the top of Sorrow, then down onto their side of it. Two waypoints, and legs
    // advance on arrival rather than on a clock so a wing held up is not left behind.
    const legs = [v3(-40, 300, 20), v3(120, 60, 260)]
    let leg = 0
    let next = 0

    const r = run(world, enemy, blue, (w) => {
      if (w.t < next) return
      next = w.t + 2
      const guns = mine.lance
      const anchor = aliveCount(w, guns) > 0 ? guns.centroid : mine.needle.centroid
      if (leg < legs.length && dist(anchor, legs[leg]) < 120) leg++
      const reds = squadronsOf(w, 'red').filter((sq) => aliveCount(w, sq) > 0)
      // Their artillery first, by name. It is five lances against four and it is what
      // makes the needles food, so it is what the whole fleet mobs.
      const want = reds.find((sq) => sq.name === 'THORN') ?? reds[0]
      for (const sq of Object.values(mine)) {
        if (aliveCount(w, sq) === 0) continue
        if (leg < legs.length) {
          issueOrder(w, sq, { kind: 'move', to: clone(legs[leg]) }, 'tight')
        } else if (want) {
          issueOrder(w, sq, { kind: 'attack', sq: want.id }, sq.cls === 'needle' ? 'open' : 'tight')
        }
      }
    })
    if (r.outcome === 'won') won++
    secs += r.seconds
    kept += r.bluePoints / Math.max(1, r.blueStart)
  }
  console.log(
    `  won ${pct(won, trials)} (${won}/${trials}), mean ${(secs / trials).toFixed(0)}s, ` +
      `${pct(kept, trials)} of the fleet left`,
  )
}

const mode = process.argv[2] ?? 'all'
const t0 = Date.now()
if (mode === 'all' || mode === 'campaign') campaign()
if (mode === 'all' || mode === 'duel') duels()
if (mode === 'all' || mode === 'screen') screens()
if (mode === 'all' || mode === 'well') well()
if (mode === 'all' || mode === 'bays') bays()
if (mode === 'all' || mode === 'hold') hold()
if (mode === 'all' || mode === 'exam') exam()
console.log(`\nharness ran in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
