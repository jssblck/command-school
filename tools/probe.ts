// One duel under a microscope: hull counts, range, and gunnery per side every
// few seconds. For chasing why a class matchup reads the way it does.
//   npx tsx tools/probe.ts needle lance 500
import { makeCommander, think } from '../src/sim/ai'
import { DT, step } from '../src/sim/step'
import type { ClassId, Objective, World } from '../src/sim/types'
import { addSquadron, createWorld } from '../src/sim/world'
import { dist, v3 } from '../src/sim/vec3'

const a = (process.argv[2] ?? 'needle') as ClassId
const b = (process.argv[3] ?? 'lance') as ClassId
const seed = Number(process.argv[4] ?? 500)
const budget = 24
const costs: Record<ClassId, number> = { needle: 1, lance: 3, aegis: 3, keel: 9, eye: 2 }

const objective: Objective = { kind: 'annihilate', text: 'duel' }
const w: World = createWorld(seed, objective, 700)
w.commLag = 0.5
const sqA = addSquadron(w, { side: 'blue', cls: a, name: 'A', count: Math.max(1, Math.round(budget / costs[a])), at: v3(0, 0, -220), facing: v3(0, 0, 1) })
const sqB = addSquadron(w, { side: 'red', cls: b, name: 'B', count: Math.max(1, Math.round(budget / costs[b])), at: v3(0, 0, 220), facing: v3(0, 0, -1) })
const red = makeCommander('red', { skill: 0.5 })
const blue = makeCommander('blue', { skill: 0.5 })

const alive = (side: 'blue' | 'red') => w.ships.filter((s) => s.alive && s.side === side).length
// In a class duel the victim's class names its side, so hits split into the ones
// that landed on the enemy and the ones that landed on the shooter's own wing.
const tally = {
  blue: { shots: 0, hits: 0, own: 0 },
  red: { shots: 0, hits: 0, own: 0 },
}
let mark = 0

console.log(`${a} (blue x${sqA.ships.length}) vs ${b} (red x${sqB.ships.length}), seed ${seed}`)
while (w.outcome === 'running' && w.t < 180) {
  think(w, red, DT)
  think(w, blue, DT)
  step(w)
  for (const e of w.events) {
    if (e.kind === 'shot') tally[e.side].shots++
    else if (e.kind === 'hit' && e.cls) {
      const victimBlue = e.cls === a && !(a === b && e.side === 'red')
      if ((e.side === 'blue') === victimBlue) tally[e.side].own++
      else tally[e.side].hits++
    }
  }
  w.events.length = 0
  if (w.t >= mark) {
    mark += 4
    console.log(
      `T+${w.t.toFixed(0).padStart(3)} blue ${String(alive('blue')).padStart(2)} red ${String(alive('red')).padStart(2)}` +
        ` range ${dist(sqA.centroid, sqB.centroid).toFixed(0).padStart(4)}` +
        ` | blue ${tally.blue.hits}+${tally.blue.own}own/${tally.blue.shots}` +
        ` red ${tally.red.hits}+${tally.red.own}own/${tally.red.shots}` +
        ` | orders A:${sqA.order.kind} B:${sqB.order.kind}`,
    )
  }
}
console.log(`outcome ${w.outcome} at T+${w.t.toFixed(0)}`)
