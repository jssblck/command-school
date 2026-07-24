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
      accuracy: 0.92,
      evasionWeight: 0.45,
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
    sensor: 185,
    cost: 3,
    weapon: {
      range: 240,
      damage: 34,
      cycle: 2.6,
      arc: deg(22),
      boltSpeed: 240,
      accuracy: 0.95,
      evasionWeight: 0.72,
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
    // screen the answer to a swarm and no answer at all to artillery.
    field: { radius: 78, pool: 85, regen: 9, bite: 2.4 },
    weapon: {
      range: 100,
      damage: 2,
      cycle: 0.85,
      arc: deg(120),
      boltSpeed: 300,
      accuracy: 0.9,
      evasionWeight: 0.4,
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
      accuracy: 0.88,
      evasionWeight: 0.5,
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
