// How the campaign plays against a blue commander who never says anything at all.
// Red thinks; blue's wings keep their opening orders. One line per mission.
import { SCENARIOS } from '../src/sim/scenarios'
import { think } from '../src/sim/ai'
import { DT, step } from '../src/sim/step'

const seeds = [1000, 2000, 2091, 3000, 4000, 5000, 6284, 9109]
for (const sc of SCENARIOS) {
  let won = 0
  const times: number[] = []
  for (const seed of seeds) {
    const { world, enemy } = sc.build(seed)
    while (world.outcome === 'running' && world.t < 300) {
      think(world, enemy, DT)
      step(world)
    }
    if (world.outcome === 'won') {
      won++
      times.push(Math.round(world.t))
    }
  }
  console.log(
    `${sc.id.padEnd(18)} passive blue wins ${won}/${seeds.length}` +
      (times.length ? ` (T+${Math.min(...times)}..${Math.max(...times)})` : ''),
  )
}
