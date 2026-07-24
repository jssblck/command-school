import type { Vec3 } from './vec3'
import type { Rng } from './rng'

export type Side = 'blue' | 'red'
export const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue')

export type ClassId = 'needle' | 'lance' | 'aegis' | 'keel' | 'eye'

export interface ShipClass {
  id: ClassId
  name: string
  /** Rough hull length in world units, used for rendering scale and hit radius. */
  size: number
  hp: number
  maxSpeed: number
  accel: number
  /** Radians per second the hull can swing its nose around. */
  turn: number
  sensor: number
  /** Points value, used to describe fleet strength and to score the campaign. */
  cost: number
  weapon?: Weapon
  /** Aegis hulls project a regenerating absorption field over nearby allies. */
  field?: Field
  /** Keel hulls launch needles to replace losses. */
  launch?: { every: number; cap: number }
}

export interface Field {
  radius: number
  /** Total damage the field can absorb before it drops. */
  pool: number
  /** Pool recovered per second. */
  regen: number
  /**
   * Damage the field takes off each individual impact. This is the whole reason
   * to buy a screen: it resists per bolt rather than per point, so a swarm's
   * small arms arrive as almost nothing while one heavy bolt barely notices.
   */
  bite: number
}

export interface Weapon {
  range: number
  damage: number
  /** Seconds between shots. */
  cycle: number
  /** Half-angle of the firing cone, in radians. Capitals get a full sphere. */
  arc: number
  /** Bolt travel speed; slow bolts curve visibly through gravity wells. */
  boltSpeed: number
  /** Hit chance against a stationary target at point blank range. */
  accuracy: number
  /** How much of the accuracy budget the target's speed can eat. */
  evasionWeight: number
}

export interface Ship {
  id: number
  side: Side
  cls: ClassId
  sq: number
  pos: Vec3
  vel: Vec3
  /** Unit heading. Weapons only bear within the class arc of this. */
  fwd: Vec3
  hp: number
  shield: number
  /**
   * The field currently covering this hull, or null. Cached by the coverage pass
   * rather than rescanned per hit, and it carries the ceiling, the recharge and
   * the bite together, because all three belong to whichever screen is over you.
   */
  cover: Field | null
  reload: number
  target: number
  /** Index into the squadron formation, so slots stay stable across frames. */
  slot: number
  alive: boolean
  /** Decays after firing; the renderer uses it to flare the muzzle. */
  heat: number
  /** Decays after taking a hit; the renderer uses it to flash the hull. */
  stress: number
  /** Per-hull phase offset so idle drift and jink do not move in lockstep. */
  phase: number
  spawnAt: number
  /** Keel hulls only: seconds until the next needle rolls out of the bay. */
  launchTimer: number
}

export type Stance = 'tight' | 'open' | 'wide'

export type Order =
  | { kind: 'move'; to: Vec3 }
  | { kind: 'attack'; sq: number }
  | { kind: 'hold'; at: Vec3 }
  | { kind: 'device'; to: Vec3 }

export interface Squadron {
  id: number
  side: Side
  name: string
  cls: ClassId
  ships: number[]
  order: Order
  /**
   * What is in flight down the comm channel, with the time it lands. A signal is a whole
   * instruction, a task and the shape to carry it out in, because that is how a commander
   * speaks: nobody says "wide" into a channel and then says where to go in a second call.
   * A wing hears one thing at a time, so saying anything again supersedes what has not
   * arrived, which is why the stance travels with the order rather than beside it.
   */
  pending: { order: Order; stance: Stance; at: number } | null
  /** The shape the wing is flying now. What has been said to it since is in `pending`. */
  stance: Stance
  /** Facing the formation presents; the axis a wall or wedge is built around. */
  facing: Vec3
  centroid: Vec3
  /** Device charges this squadron carries. Zero for everyone in early missions. */
  device: number
  /** Set while a device bolt of theirs is in flight, to block double taps. */
  deviceLock: number
  /** Rolling count of hulls lost, for the after action report. */
  lost: number
  /**
   * Squadrons stay single class so formations and standoff stay legible. A keel
   * squadron therefore feeds its replacement needles into a paired wing.
   */
  wing?: number
}

export type BodyKind = 'planet' | 'moon' | 'field' | 'ring'

export interface Body {
  id: number
  kind: BodyKind
  name: string
  pos: Vec3
  radius: number
  /** Gravitational parameter. Zero for debris fields, which only occlude. */
  mu: number
  /**
   * How much of a hull's sensor reach survives inside this body. It also sets how
   * fast the rock wears the hull down, since both come from the same density: see
   * `stepHazards`.
   */
  sensorFactor: number
  /** True for the target of the last exam. */
  consumable: boolean
  /** Rings and fields are discs; this is the disc normal. */
  normal: Vec3
  /**
   * Full thickness of the slab, so a hull is inside it within `thickness / 2` of
   * the disc plane. The renderer scatters its dust over exactly this slab: the
   * band you can see has to be the band that blinds you.
   */
  thickness: number
  /** Inner radius, so a ring is an annulus with the clear hub the renderer draws. */
  inner: number
  /** Drops to zero as the device eats it. */
  integrity: number
  seed: number
}

export interface Bolt {
  id: number
  side: Side
  pos: Vec3
  vel: Vec3
  damage: number
  life: number
  /** Aim point; a miss is modelled by offsetting this at fire time. */
  aim: Vec3
  target: number
  hit: boolean
  cls: ClassId
}

export interface DeviceBolt {
  id: number
  side: Side
  pos: Vec3
  vel: Vec3
  to: Vec3
  life: number
  /**
   * True when `to` is a point on a surface, which stops the charge tripping on hulls
   * it passes. A charge aimed at open space is aimed at where hulls were standing when
   * the order went out, and they have moved by the time it arrives, so it goes off on
   * the first one it touches. A planet is still where the player left it.
   */
  contact: boolean
}

/** One generation of the molecular disruption cascade. */
export interface DeviceNode {
  id: number
  pos: Vec3
  radius: number
  /** Seconds until this node fires and spawns its children. */
  fuse: number
  depth: number
  side: Side
  fired: boolean
  age: number
}

export type ObjectiveKind = 'annihilate' | 'survive' | 'breakthrough' | 'unmake' | 'decapitate'

export interface Objective {
  kind: ObjectiveKind
  /** Seconds, for `survive`. */
  seconds?: number
  /** Body id, for `unmake`. */
  body?: number
  /** Point and ship count, for `breakthrough`. */
  point?: Vec3
  count?: number
  /** Squadron names that must die, for `decapitate`. */
  targets?: string[]
  text: string
}

export type Outcome = 'running' | 'won' | 'lost'

export interface SimEvent {
  kind: 'hit' | 'kill' | 'shot' | 'device' | 'cascade' | 'order' | 'launch' | 'unmade'
  pos: Vec3
  side: Side
  /** Class of the hull involved, where meaningful, for effect sizing. */
  cls?: ClassId
  /** Squadron the event belongs to, where one does. */
  sq?: number
  power?: number
  text?: string
}

export interface World {
  t: number
  tick: number
  rng: Rng
  ships: Ship[]
  squadrons: Squadron[]
  bodies: Body[]
  bolts: Bolt[]
  deviceBolts: DeviceBolt[]
  nodes: DeviceNode[]
  events: SimEvent[]
  /** seen.blue holds the ids of red hulls blue currently has on sensors. */
  seen: Record<Side, Set<number>>
  /** Blue's memory of where red hulls were last seen, for the ghost markers. */
  ghosts: Map<number, { pos: Vec3; at: number; cls: ClassId }>
  objective: Objective
  outcome: Outcome
  /** Seconds an order spends in the comm channel before a squadron acts on it. */
  commLag: number
  bounds: number
  nextId: number
  stats: {
    blueLost: number
    redLost: number
    blueStart: number
    redStart: number
    shots: number
    deviceKills: number
    friendlyDeviceKills: number
  }
}
