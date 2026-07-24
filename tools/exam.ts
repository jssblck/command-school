/**
 * Does the last mission contain a decision, or only one trick?
 *
 * Three plans are run against the same seeds. `straight` sends the carrier up
 * the middle, which should die. `wide` stages high off one flank and dives,
 * which is the intended solution. `alone` runs the same flank but leaves the
 * rest of the fleet sitting at home, which tells us whether the screen is
 * actually buying anything or is just scenery.
 *
 *   npx tsx tools/exam.ts [trials]
 */
import { makeCommander, think } from '../src/sim/ai'
import { DEVICE_RANGE, deviceAim, DT, issueOrder, issueStance, step } from '../src/sim/step'
import { scenarioById } from '../src/sim/scenarios'
import { fleetStrength, shipById } from '../src/sim/world'
import { clone, dist, v3, type Vec3 } from '../src/sim/vec3'
import type { Squadron, World } from '../src/sim/types'

type Plan = 'straight' | 'wide' | 'alone'

interface Run {
  outcome: World['outcome'] | 'timeout'
  seconds: number
  fired: boolean
  /** Hulls left in the carrier when it fired, or when it died. */
  runnerLeft: number
  bluePoints: number
}

function play(plan: Plan, seed: number, trace = false): Run {
  const { world: w, enemy } = scenarioById('last-exam')!.build(seed)
  const blue = makeCommander('blue', { aggression: 0.9, skill: 0.4 })
  const home = w.bodies.find((b) => b.consumable)!
  const runner = w.squadrons.find((sq) => sq.side === 'blue' && sq.device > 0)!
  blue.reserved.add(runner.id)
  // `alone` keeps the whole fleet out of it, so the run is unscreened.
  if (plan === 'alone') for (const sq of w.squadrons) if (sq.side === 'blue') blue.reserved.add(sq.id)

  const stage: Vec3 =
    plan === 'straight'
      ? clone(home.pos)
      : v3(home.pos.x - 520, home.pos.y + 430, home.pos.z - 520)

  let phase: 'stage' | 'dive' | 'fire' | 'done' = 'stage'
  let fired = false
  let runnerLeft = aliveIn(w, runner)

  if (trace) console.log('   t  runner  toHome  phase  order    sight  points  chasing')
  while (w.outcome === 'running' && w.t < 300) {
    think(w, enemy, DT)
    think(w, blue, DT)

    if (w.tick % 20 === 0 && aliveIn(w, runner) > 0) {
      // A new signal replaces whatever is still in the comm channel, so speaking every tick
      // would reset the delay forever. Only speak on a phase change. The stance is safe to
      // ask for on every pass because naming the shape already being flown sends nothing.
      issueStance(w, runner, 'wide')
      if (phase === 'stage') {
        issueOrder(w, runner, { kind: 'move', to: clone(stage) })
        phase = plan === 'straight' ? 'fire' : 'dive'
      } else if (phase === 'dive' && dist(runner.centroid, stage) < 150) {
        issueOrder(w, runner, { kind: 'move', to: clone(home.pos) })
        phase = 'fire'
      } else if (
        phase === 'fire' &&
        // Judged where the charge would actually go off, on the near skin of the
        // planet, rather than at the centre the order is aimed at.
        dist(runner.centroid, deviceAim(w, runner.centroid, home.pos)) < DEVICE_RANGE * 0.9 &&
        runner.deviceLock <= 0
      ) {
        issueOrder(w, runner, { kind: 'device', to: clone(home.pos) })
        fired = true
        runnerLeft = aliveIn(w, runner)
        phase = 'done'
      }
    }

    step(w)
    if (!fired) runnerLeft = aliveIn(w, runner)

    if (trace && w.tick % 120 === 0) {
      const spotted = runner.ships.some((id) => w.seen.red.has(id) && shipById(w, id)?.alive)
      const chasers = w.squadrons
        .filter((sq) => sq.side === 'red' && sq.order.kind === 'attack' && sq.order.sq === runner.id)
        .map((sq) => sq.name)
      console.log(
        `${w.t.toFixed(0).padStart(4)} ${String(aliveIn(w, runner)).padStart(7)} ` +
          `${dist(runner.centroid, home.pos).toFixed(0).padStart(7)}  ${phase.padEnd(6)} ` +
          `${runner.order.kind.padEnd(8)} ${(spotted ? 'seen' : '-').padEnd(5)} ` +
          `${fleetStrength(w, 'blue')}/${fleetStrength(w, 'red')}  ${chasers.join(',')}`,
      )
    }
  }

  return {
    outcome: w.outcome === 'running' ? 'timeout' : w.outcome,
    seconds: w.t,
    fired,
    runnerLeft,
    bluePoints: fleetStrength(w, 'blue'),
  }
}

const aliveIn = (w: World, sq: Squadron): number =>
  sq.ships.reduce((n, id) => n + (shipById(w, id)?.alive ? 1 : 0), 0)

const trials = Number(process.argv[2] ?? 10)
if (process.argv[2] === 'trace') {
  play('wide', 2000, true)
} else {
  console.log(`\nlast exam, ${trials} seeds per plan`)
  console.log('plan       won   fired  mean t  runner left  blue left')
  for (const plan of ['straight', 'wide', 'alone'] as Plan[]) {
    const runs = Array.from({ length: trials }, (_, i) => play(plan, 2000 + i * 91))
    const won = runs.filter((r) => r.outcome === 'won').length
    const mean = (f: (r: Run) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length
    console.log(
      `${plan.padEnd(10)} ${`${won}/${trials}`.padStart(5)} ` +
        `${`${runs.filter((r) => r.fired).length}/${trials}`.padStart(6)} ` +
        `${mean((r) => r.seconds).toFixed(0).padStart(7)} ` +
        `${mean((r) => r.runnerLeft).toFixed(1).padStart(12)} ` +
        `${mean((r) => r.bluePoints).toFixed(0).padStart(10)}`,
    )
  }
}
