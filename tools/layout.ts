/**
 * Build every scenario and report squadrons deployed uncomfortably close to a
 * solid body. addSquadron throws on a genuine overlap; this catches the near
 * misses, where a squadron survives spawning but drifts into the crust.
 *
 *   npx tsx tools/layout.ts
 */
import { SCENARIOS } from '../src/sim/scenarios'
import { squadronsOf } from '../src/sim/world'
import { dist } from '../src/sim/vec3'

for (const s of SCENARIOS) {
  try {
    const { world } = s.build(1000)
    const notes: string[] = []
    for (const sq of [...squadronsOf(world, 'blue'), ...squadronsOf(world, 'red')]) {
      for (const b of world.bodies) {
        if (b.kind !== 'planet' && b.kind !== 'moon') continue
        const d = dist(sq.centroid, b.pos)
        if (d < b.radius + 110) notes.push(`${sq.side} ${sq.name} ${d.toFixed(0)}/${b.radius} ${b.name}`)
      }
    }
    console.log(`ok   ${s.id.padEnd(14)} ${notes.join(' | ')}`)
  } catch (e) {
    console.log(`FAIL ${s.id.padEnd(14)} ${(e as Error).message}`)
  }
}
