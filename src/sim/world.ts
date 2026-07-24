import { cls } from './classes'
import { makeRng } from './rng'
import type {
  Body,
  BodyKind,
  ClassId,
  Objective,
  Ship,
  Side,
  Squadron,
  Stance,
  World,
} from './types'
import { copy, dist, len, normalize, v3, type Vec3 } from './vec3'

export function createWorld(seed: number, objective: Objective, bounds = 900): World {
  return {
    t: 0,
    tick: 0,
    rng: makeRng(seed),
    ships: [],
    squadrons: [],
    bodies: [],
    bolts: [],
    deviceBolts: [],
    nodes: [],
    events: [],
    seen: { blue: new Set(), red: new Set() },
    ghosts: new Map(),
    objective,
    outcome: 'running',
    commLag: 0.55,
    bounds,
    nextId: 1,
    stats: {
      blueLost: 0,
      redLost: 0,
      blueStart: 0,
      redStart: 0,
      shots: 0,
      deviceKills: 0,
      friendlyDeviceKills: 0,
    },
  }
}

export interface BodySpec {
  kind: BodyKind
  name: string
  pos: Vec3
  radius: number
  mu?: number
  sensorFactor?: number
  consumable?: boolean
  normal?: Vec3
  thickness?: number
}

export function addBody(w: World, spec: BodySpec): Body {
  const body: Body = {
    id: w.nextId++,
    kind: spec.kind,
    name: spec.name,
    pos: spec.pos,
    radius: spec.radius,
    // Default gravity scales with radius so bigger bodies pull harder without
    // every scenario having to hand-tune a mu.
    mu: spec.mu ?? (spec.kind === 'planet' || spec.kind === 'moon' ? spec.radius * spec.radius * 5.2 : 0),
    sensorFactor: spec.sensorFactor ?? (spec.kind === 'field' ? 0.32 : spec.kind === 'ring' ? 0.6 : 1),
    consumable: spec.consumable ?? false,
    normal: normalize(spec.normal ?? v3(0, 1, 0)),
    thickness: spec.thickness ?? (spec.kind === 'ring' ? 28 : spec.radius),
    // A drawn ring has a clear hub between the planet and the first band, and the
    // sim has to agree with the picture: flying that gap is meant to be flying in
    // the open. Fields are solid to the middle.
    inner: spec.kind === 'ring' ? spec.radius * 0.58 : 0,
    integrity: 1,
    seed: w.nextId * 7919,
  }
  w.bodies.push(body)
  return body
}

export interface SquadronSpec {
  side: Side
  cls: ClassId
  name: string
  count: number
  at: Vec3
  facing?: Vec3
  stance?: Stance
  device?: number
  scatter?: number
}

export function addSquadron(w: World, spec: SquadronSpec): Squadron {
  const facing = normalize(spec.facing ?? v3(0, 0, 1))
  assertClearOfBodies(w, spec)
  const sq: Squadron = {
    id: w.nextId++,
    side: spec.side,
    name: spec.name,
    cls: spec.cls,
    ships: [],
    order: { kind: 'hold', at: copy(v3(), spec.at) },
    pending: null,
    stance: spec.stance ?? 'open',
    facing,
    centroid: copy(v3(), spec.at),
    device: spec.device ?? 0,
    deviceLock: 0,
    lost: 0,
  }
  w.squadrons.push(sq)

  const scatter = spec.scatter ?? 26
  for (let i = 0; i < spec.count; i++) {
    const off = w.rng.sphere(scatter)
    const ship = spawnShip(w, sq, {
      x: spec.at.x + off.x,
      y: spec.at.y + off.y,
      z: spec.at.z + off.z,
    })
    ship.slot = i
  }
  return sq
}

/**
 * A squadron deployed inside a planet is destroyed by the crash check on the
 * first tick, silently, which reads as a balance problem rather than a layout
 * mistake. Scenario layouts are authored data, so this is a hard error.
 */
function assertClearOfBodies(w: World, spec: SquadronSpec): void {
  const margin = (spec.scatter ?? 26) + cls(spec.cls).size * 2 + 12
  for (const b of w.bodies) {
    if (b.kind !== 'planet' && b.kind !== 'moon') continue
    const d = dist(spec.at, b.pos)
    if (d < b.radius + margin) {
      throw new Error(
        `scenario layout: ${spec.side} ${spec.name} deploys ${d.toFixed(0)} from ${b.name} ` +
          `(radius ${b.radius}), needs at least ${(b.radius + margin).toFixed(0)}`,
      )
    }
  }
}

export function spawnShip(w: World, sq: Squadron, pos: Vec3): Ship {
  const c = cls(sq.cls)
  const ship: Ship = {
    id: w.nextId++,
    side: sq.side,
    cls: sq.cls,
    sq: sq.id,
    pos: copy(v3(), pos),
    vel: v3(),
    fwd: copy(v3(), sq.facing),
    hp: c.hp,
    shield: 0,
    cover: null,
    reload: w.rng.range(0, c.weapon?.cycle ?? 1),
    target: -1,
    slot: sq.ships.length,
    alive: true,
    heat: 0,
    stress: 0,
    phase: w.rng.range(0, Math.PI * 2),
    spawnAt: w.t,
    launchTimer: c.launch ? c.launch.every * w.rng.range(0.4, 1) : 0,
  }
  w.ships.push(ship)
  sq.ships.push(ship.id)
  if (sq.side === 'blue') w.stats.blueStart += c.cost
  else w.stats.redStart += c.cost
  return ship
}

// Index maintained lazily; ships are never removed from the array, only killed.
let indexCache: { world: World | null; map: Map<number, Ship> } = { world: null, map: new Map() }

export function shipById(w: World, id: number): Ship | undefined {
  if (indexCache.world !== w || indexCache.map.size !== w.ships.length) {
    const map = new Map<number, Ship>()
    for (const s of w.ships) map.set(s.id, s)
    indexCache = { world: w, map }
  }
  return indexCache.map.get(id)
}

export function squadronById(w: World, id: number): Squadron | undefined {
  return w.squadrons.find((s) => s.id === id)
}

export function aliveCount(w: World, sq: Squadron): number {
  let n = 0
  for (const id of sq.ships) {
    const s = shipById(w, id)
    if (s && s.alive) n++
  }
  return n
}

export function squadronsOf(w: World, side: Side): Squadron[] {
  return w.squadrons.filter((sq) => sq.side === side && aliveCount(w, sq) > 0)
}

export function fleetStrength(w: World, side: Side): number {
  let pts = 0
  for (const s of w.ships) if (s.alive && s.side === side) pts += cls(s.cls).cost
  return pts
}

/**
 * Whether this side has any way left to wreck a hull by firing: a gun on something still
 * flying, or a charge aboard a wing that still has hulls to carry it.
 *
 * Nothing in the rules turns on this. It is read by the interface, because a fleet of
 * scouts still reads as four wings present and under orders, and the commander is owed the
 * news that the orders can no longer take anything off the board.
 */
export function canStillKill(w: World, side: Side): boolean {
  for (const s of w.ships) if (s.alive && s.side === side && cls(s.cls).weapon) return true
  for (const sq of w.squadrons) {
    if (sq.side === side && sq.device > 0 && aliveCount(w, sq) > 0) return true
  }
  return false
}

/** Total acceleration from every gravitating body at a point. */
export function gravityAt(w: World, p: Vec3, out: Vec3): Vec3 {
  out.x = 0
  out.y = 0
  out.z = 0
  for (const b of w.bodies) {
    if (b.mu <= 0 || b.integrity <= 0) continue
    const dx = b.pos.x - p.x
    const dy = b.pos.y - p.y
    const dz = b.pos.z - p.z
    const d2 = dx * dx + dy * dy + dz * dz
    // Softened at the surface so grazing passes do not produce silly impulses.
    const soft = Math.max(d2, b.radius * b.radius)
    const a = b.mu / (soft * Math.sqrt(soft))
    out.x += dx * a
    out.y += dy * a
    out.z += dz * a
  }
  return out
}

/** Sensor multiplier for a hull sitting at `p`: debris and rings blind it. */
export function sensorFactorAt(w: World, p: Vec3): number {
  let f = 1
  for (const b of w.bodies) {
    if (b.sensorFactor >= 1 || b.integrity <= 0) continue
    if (insideDisc(b, p)) f = Math.min(f, b.sensorFactor)
  }
  return f
}

export function insideDisc(b: Body, p: Vec3): boolean {
  const dx = p.x - b.pos.x
  const dy = p.y - b.pos.y
  const dz = p.z - b.pos.z
  const along = dx * b.normal.x + dy * b.normal.y + dz * b.normal.z
  if (Math.abs(along) > b.thickness * 0.5) return false
  const r2 = dx * dx + dy * dy + dz * dz - along * along
  return r2 < b.radius * b.radius && r2 >= b.inner * b.inner
}

/** True when a solid body sits across the segment, blocking line of fire. */
export function occluded(w: World, a: Vec3, b: Vec3): boolean {
  for (const body of w.bodies) {
    if (body.integrity <= 0) continue
    if (body.kind !== 'planet' && body.kind !== 'moon') continue
    const abx = b.x - a.x
    const aby = b.y - a.y
    const abz = b.z - a.z
    const l2 = abx * abx + aby * aby + abz * abz
    if (l2 < 1e-6) continue
    let t = ((body.pos.x - a.x) * abx + (body.pos.y - a.y) * aby + (body.pos.z - a.z) * abz) / l2
    if (t <= 0 || t >= 1) continue
    const cx = a.x + abx * t - body.pos.x
    const cy = a.y + aby * t - body.pos.y
    const cz = a.z + abz * t - body.pos.z
    if (cx * cx + cy * cy + cz * cz < body.radius * body.radius) return true
  }
  return false
}

export function updateCentroids(w: World): void {
  for (const sq of w.squadrons) {
    let n = 0
    let x = 0
    let y = 0
    let z = 0
    for (const id of sq.ships) {
      const s = shipById(w, id)
      if (!s || !s.alive) continue
      x += s.pos.x
      y += s.pos.y
      z += s.pos.z
      n++
    }
    if (n > 0) {
      sq.centroid.x = x / n
      sq.centroid.y = y / n
      sq.centroid.z = z / n
    }
  }
}

/** Nearest live hull of `side` to a point, ignoring sensor state. */
export function nearestShip(w: World, side: Side, p: Vec3): Ship | null {
  let best: Ship | null = null
  let bd = Infinity
  for (const s of w.ships) {
    if (!s.alive || s.side !== side) continue
    const d = dist(s.pos, p)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

export const speedOf = (s: Ship): number => len(s.vel)
