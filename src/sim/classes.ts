import type { ClassId, ShipClass } from './types'

const deg = (d: number) => (d * Math.PI) / 180

/**
 * Five hulls, each answering a different question, so that fleet composition is
 * a rock-paper-scissors read rather than a strength check:
 *
 *   needle beats lance (closes the gap and out-turns the bolt)
 *   lance  beats keel  (out-ranges the turrets)
 *   aegis  beats needle swarms (its field bites a fixed amount out of every bolt,
 *          and small arms are nothing but bolts)
 *   keel   beats attrition (replaces its own losses)
 *   eye    beats ignorance (sees the fleet you have not found yet)
 *
 * The triangle used to be asserted by a to-hit formula and is now supposed to fall
 * out of the mounts. What separates the guns is `traverse`, how fast a mount can
 * track: a needle crossing close sweeps a lance's sky faster than the whole hull
 * can turn, so the lance's shells land where the needle was, while the same needle
 * charging straight in has no angular rate at all and eats a 34 point shell.
 * "Out-turns the bolt" is a fact about geometry now rather than a dice weight.
 *
 * The lance is the one deliberate fixed mount: a spinal gun uses the whole hull as
 * its mount, which is why it hits thirteen times harder and why firing means
 * facing. Aegis and keel guns are turrets and track on their own; the needle's
 * guns are bolted to a hull that turns 220 degrees a second, which is a turret by
 * other means.
 *
 * Aegis is the one class that cannot win a duel: it has a token gun, so a screen
 * on its own only ever draws. Its points are spent on somebody else's survival,
 * which is why tools/balance.ts measures it by whether a mixed fleet does better
 * with one than the same points spent on more guns. The rest are checked head to
 * head at equal points, where the triangle above should hold.
 */
export const CLASSES: Record<ClassId, ShipClass> = {
  needle: {
    id: 'needle',
    name: 'Needle',
    size: 2.2,
    hp: 32,
    maxSpeed: 58,
    accel: 92,
    turn: deg(220),
    sensor: 165,
    cost: 1,
    weapon: {
      range: 100,
      damage: 2.6,
      cycle: 0.45,
      arc: deg(48),
      boltSpeed: 340,
      traverse: deg(200),
      dispersion: deg(1.6),
    },
  },

  lance: {
    id: 'lance',
    name: 'Lance',
    size: 5.4,
    hp: 88,
    maxSpeed: 30,
    accel: 26,
    turn: deg(48),
    // Further than the gun, not shorter. At 185 a lance could shoot to 240 and
    // see to 185, so a battery sweeping toward an unseen enemy marched inside
    // its own artillery advantage before it knew there was anything to shell,
    // and under ballistic gunnery that walk is the class duel lost on approach.
    sensor: 275,
    cost: 3,
    // The traverse is the class's whole vulnerability: anything that gets close
    // and crosses is untouchable, and anything slow or approaching is dead.
    weapon: {
      range: 240,
      damage: 34,
      cycle: 2.6,
      arc: deg(22),
      boltSpeed: 240,
      traverse: deg(12),
      dispersion: deg(0.7),
    },
  },

  aegis: {
    id: 'aegis',
    name: 'Aegis',
    size: 4.6,
    hp: 140,
    maxSpeed: 36,
    accel: 34,
    turn: deg(90),
    sensor: 175,
    cost: 3,
    // The field has to be wide enough to actually cover a squadron in formation,
    // otherwise a screen only ever protects itself. The bite sits just under a
    // needle's bolt and far under a lance's: that one number is what makes a
    // screen the answer to a swarm and no answer at all to artillery. The pool
    // is sized against a swarm that concentrates: at 85 a focused wing stripped
    // one hull's cover in under two seconds and the class stopped meaning
    // anything.
    field: { radius: 78, pool: 130, regen: 16, bite: 2.4 },
    // A flak turret rather than a token. Under ballistic gunnery this is the one
    // mount in the fleet that out-tracks an orbiting needle, so the screen is
    // itself the threat to the swarm it blunts; artillery still shells it from
    // far beyond this gun's reach, which keeps the class unable to win a duel.
    weapon: {
      range: 100,
      damage: 5,
      cycle: 0.85,
      arc: Math.PI,
      boltSpeed: 300,
      traverse: deg(140),
      dispersion: deg(1.8),
    },
  },

  keel: {
    id: 'keel',
    name: 'Keel',
    size: 12,
    hp: 700,
    maxSpeed: 17,
    accel: 13,
    turn: deg(26),
    sensor: 210,
    cost: 9,
    launch: { every: 7, cap: 8 },
    weapon: {
      range: 130,
      damage: 14,
      cycle: 0.8,
      // Capitals ring themselves with turrets, so anything in range bears.
      arc: Math.PI,
      boltSpeed: 280,
      traverse: deg(55),
      dispersion: deg(1.4),
    },
  },

  eye: {
    id: 'eye',
    name: 'Eye',
    size: 3,
    hp: 46,
    maxSpeed: 74,
    accel: 110,
    turn: deg(260),
    sensor: 470,
    cost: 2,
  },
}

export const cls = (id: ClassId): ShipClass => CLASSES[id]

/**
 * The longest gun anyone fields. A scout's standoff is the one distance in the game
 * that has to be read against every other class rather than against its own numbers,
 * so it comes from here instead of being written down twice.
 */
export const LONGEST_RANGE = Math.max(...Object.values(CLASSES).map((c) => c.weapon?.range ?? 0))

/** Hit radius: generous enough that bolts read as hitting the hull they touch. */
export const hitRadius = (id: ClassId): number => CLASSES[id].size * 0.7 + 1.4

/**
 * Formation spacing scales with hull size so capitals do not clip each other.
 * Kept deliberately tight relative to weapon range: a squadron whose footprint
 * is wider than its reach can never bring more than its nose hulls to bear.
 */
export const slotSpacing = (id: ClassId): number => 4.5 + CLASSES[id].size * 1.2

/** Hulls hold station this far apart, always inside their own slot spacing. */
export const personalSpace = (id: ClassId): number => slotSpacing(id) * 0.72
