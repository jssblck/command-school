/**
 * Timeline dump for a single engagement. Used to answer "why did that side
 * lose" questions that the aggregate sweep in balance.ts can only raise.
 *
 *   npx tsx tools/debug.ts needle lance 24
 */
import { makeCommander, think } from '../src/sim/ai'
import { DT, step } from '../src/sim/step'
import type { ClassId, Objective } from '../src/sim/types'
import { addSquadron, createWorld, fleetStrength, shipById } from '../src/sim/world'
import { dist, v3 } from '../src/sim/vec3'

const a = (process.argv[2] ?? 'needle') as ClassId
const b = (process.argv[3] ?? 'needle') as ClassId
const budget = Number(process.argv[4] ?? 24)
const costs: Record<ClassId, number> = { needle: 1, lance: 3, aegis: 3, keel: 9, eye: 2 }

const objective: Objective = { kind: 'annihilate', text: 'duel' }
const w = createWorld(12345, objective, 700)
w.commLag = 0.5
const A = addSquadron(w, {
  side: 'blue',
  cls: a,
  name: 'A',
  count: Math.max(1, Math.round(budget / costs[a])),
  at: v3(0, 0, -220),
  facing: v3(0, 0, 1),
})
const B = addSquadron(w, {
  side: 'red',
  cls: b,
  name: 'B',
  count: Math.max(1, Math.round(budget / costs[b])),
  at: v3(0, 0, 220),
  facing: v3(0, 0, -1),
})

const red = makeCommander('red', { skill: 0.5 })
const blue = makeCommander('blue', { skill: 0.5 })

const live = (sq: typeof A) => sq.ships.filter((id) => shipById(w, id)?.alive).length
const hp = (sq: typeof A) =>
  sq.ships.reduce((t, id) => {
    const s = shipById(w, id)
    return t + (s && s.alive ? s.hp + s.shield : 0)
  }, 0)

console.log(`${a} x${A.ships.length} (blue) vs ${b} x${B.ships.length} (red)`)
console.log('   t  Alive Ahp  Border  Bhp   gap  Aorder        Border        shots')
let lastShots = 0
while (w.outcome === 'running' && w.t < 200) {
  think(w, red, DT)
  think(w, blue, DT)
  step(w)
  if (w.tick % 60 === 0) {
    const gap = dist(A.centroid, B.centroid)
    console.log(
      `${w.t.toFixed(0).padStart(4)} ${String(live(A)).padStart(5)} ${hp(A).toFixed(0).padStart(5)} ` +
        `${String(live(B)).padStart(5)} ${hp(B).toFixed(0).padStart(5)} ${gap.toFixed(0).padStart(6)}  ` +
        `${A.order.kind.padEnd(13)} ${B.order.kind.padEnd(13)} ${w.stats.shots - lastShots}`,
    )
    lastShots = w.stats.shots
  }
}
console.log(
  `outcome=${w.outcome} t=${w.t.toFixed(1)} blue=${fleetStrength(w, 'blue')} red=${fleetStrength(w, 'red')} ` +
    `shots=${w.stats.shots}`,
)
