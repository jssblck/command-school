import { cls, hitRadius, personalSpace } from './classes'
import { facingToward, formationRadius, slotOffset, standoff } from './formation'
import type { Body, Bolt, DeviceNode, Ship, ShipClass, Side, Squadron, Stance, World } from './types'
import { other } from './types'
import {
  aliveCount,
  fleetStrength,
  gravityAt,
  insideDisc,
  occluded,
  sensorFactorAt,
  shipById,
  spawnShip,
  squadronById,
  squadronsOf,
  updateCentroids,
} from './world'
import {
  add,
  anyPerp,
  clampLenInto,
  clone,
  copy,
  cross,
  dist,
  dist2,
  dot,
  len,
  len2,
  normalize,
  normalizeInto,
  scale,
  scaledAddInto,
  segmentDist,
  set,
  sub,
  v3,
  type Vec3,
} from './vec3'

export const DT = 1 / 60

/**
 * How long a lost contact stays on the plot. It is one number rather than a sim
 * retention and a separate drawing cutoff: nothing but the ghost markers reads this
 * memory, so a second lifetime in the renderer only meant the longer of the two was
 * dead weight that looked like a knob.
 */
export const GHOST_MEMORY = 14

/** Root radius of a molecular disruption node, before generational decay. */
export const DEVICE_RADIUS = 48
/**
 * How far a carrier can throw a charge, measured to the point where the cascade
 * would start. Two constraints set this number and both are tight. It has to be
 * shorter than a needle's sensors, or a carrier can release at something it cannot
 * see; and it has to be shorter than the depth of the guard around a homeworld, or
 * the release point sits outside everything defending it and the run in is free.
 */
export const DEVICE_RANGE = 130
const DEVICE_MAX_DEPTH = 14
const DEVICE_MAX_NODES = 260
const DEVICE_CHAIN = 0.86
/** What each generation keeps of its parent's radius. */
const DEVICE_DECAY = 0.93
/**
 * How far the cascade can walk from where it starts, adding up what every generation
 * can reach. This is the number that decides whether a shot is safe, and nothing in
 * the panel used to say it: reach is three times release range, so a carrier that
 * fires into a fight it is part of is inside its own weapon. A count of who is
 * standing in the blast cannot substitute, because the hulls that die are the ones
 * that fly into the burning volume during the two seconds it spends spreading.
 */
export const DEVICE_REACH = (() => {
  let radius = DEVICE_RADIUS
  let total = 0
  for (let i = 0; i <= DEVICE_MAX_DEPTH; i++) {
    total += radius
    radius *= DEVICE_DECAY
  }
  return total
})()
/** Seconds between cascade generations. Slow enough to watch it spread. */
const DEVICE_FUSE = 0.13
/** How fast a released charge crosses to its release point. */
const DEVICE_BOLT_SPEED = 150
/**
 * How close an enemy hull has to be to trip the charge in flight. Under the root
 * radius, so the hull that arms it is inside the burst rather than on its edge.
 */
const DEVICE_TRIP = DEVICE_RADIUS * 0.7
/**
 * What a wing keeps of its top speed while it is still carrying a charge. Measured on
 * the Last Exam, which is the mission that lives or dies on a charge run: at full speed
 * a beeline won it 92 percent of the time in 26 seconds, at half speed the run never
 * arrives at all, and at 0.7 it wins a third of the time in 75 seconds, which is long
 * enough that what the rest of the fleet is doing decides it.
 */
const CARRY_SPEED = 0.7

// Scratch vectors: the per-ship loop runs a few hundred times a frame and there
// is no reason to allocate in it.
const _grav = v3()
const _slot = v3()
const _des = v3()
const _sep = v3()
const _steer = v3()
const _tmp = v3()
const _anchor = v3()
const _facing = v3()
const _away = v3()
const _prev = v3()
const _rel = v3()
const _los = v3()
const _lean = v3()

/**
 * Seconds of slew the aim trails by, per radian per second of crossing rate the
 * mount cannot keep up with. This is the whole to-hit model: a shot at a target
 * crossing within the mount's traverse goes exactly where the lead says, and one
 * at a target crossing faster lands behind it by the excess times this.
 */
const TRACK_LAG = 0.35
/**
 * Thrust available off the nose, as a fraction of full burn. One number for every
 * class rather than a knob each: the differences fall out of turn rate, since a
 * needle realigns its nose in a frame and a lance spends seconds paying this tax.
 * The floor is manoeuvring thrusters, so station keeping still works; the slope
 * is why a hull visibly wheels before it goes anywhere.
 */
const LATERAL_THRUST = 0.35
/**
 * How far ahead of itself, in radians around the target, a needle wing chases its
 * attack anchor. A constant lead angle makes the orbit self-sustaining with no
 * stored state: the anchor is always a step around the circle, so the wing
 * streams past its target instead of parking at standoff, and the crossing rate
 * that motion buys is the class's evasion under the tracking model.
 */
const ORBIT_LEAD = 0.95

export function step(w: World, dt = DT): void {
  w.t += dt
  w.tick++

  resolveOrders(w)
  updateCentroids(w)
  if (w.tick % 15 === 1) updateSensors(w)

  for (const sq of w.squadrons) {
    if (sq.deviceLock > 0) sq.deviceLock -= dt
    if (aliveCount(w, sq) === 0) continue
    driveSquadron(w, sq, dt)
  }

  stepBolts(w, dt)
  stepDevice(w, dt)
  stepFields(w, dt)
  stepHazards(w, dt)
  checkObjective(w)
}

// ---------------------------------------------------------------------------
// Orders

/**
 * The shape a wing will be flying once everything said to it has arrived: what is on the
 * wire if anything is, and what it is flying otherwise. Anything that has to reason about
 * the formation an order will be carried out in wants this rather than `sq.stance`, which
 * is only the shape the wing is holding at this instant.
 */
export function flownStance(sq: Squadron): Stance {
  return sq.pending?.stance ?? sq.stance
}

/**
 * Push an order into a squadron's comm channel; it lands after the lag, in the stance it
 * was sent with. The stance defaults to whatever was last said, so an order does not quietly
 * cancel a shape the player asked for a moment earlier.
 */
export function issueOrder(w: World, sq: Squadron, order: Squadron['order'], stance = flownStance(sq)): void {
  // Set before lifting, because the lift has to clear the formation this order will be flown
  // in, and that is the stance in this signal rather than the one the wing is holding now.
  sq.pending = { order, stance, at: w.t + w.commLag }
  if (order.kind === 'move' || order.kind === 'hold') {
    liftClear(w, sq, order.kind === 'move' ? order.to : order.at)
  }
}

/**
 * Whether this wing is quitting the volume: it has been told to fly to a point outside the
 * theatre, which is the one order the edge of the map does not argue with.
 *
 * Derived from the order rather than kept as a flag, so a withdrawal is a thing a commander
 * says and can take back, not a state a wing enters. The player can say it too, though
 * flying hulls off the board only ever loses them.
 */
export function leaving(w: World, sq: Squadron): boolean {
  return sq.order.kind === 'move' && len2(sq.order.to) > w.bounds * w.bounds
}

/**
 * Change the shape a wing flies in. A stance is something you say out loud, so it travels
 * like everything else you say: it rides in a signal with the task the wing is already
 * carrying out, and the whole instruction lands together. Saying it while an order is still
 * in the channel therefore holds that order back rather than throwing it away, which costs
 * the player time for talking, and there is no path left that mutates a wing from the
 * keyboard without going through the channel.
 *
 * Returns whether anything was actually said. Naming the shape a wing is already flying, or
 * already on its way to hearing, is not an order: it would spend a fresh comm delay on
 * whatever else is in that wing's channel and buy nothing. Selecting everything and then
 * setting a stance is a habit rather than a corner case, so without this a fleet already
 * open pays the delay across every wing and reports nine orders it was not given.
 */
export function issueStance(w: World, sq: Squadron, stance: Stance): boolean {
  if (flownStance(sq) === stance) return false
  // A copy of the order, because the lift pushes a destination clear of the formation it will
  // be flown in and a wider stance needs more room: lifting in place would edit the order the
  // wing is carrying out right now, and a wing stationed near a planet would slide outward the
  // instant the key went down, having been told nothing yet.
  issueOrder(w, sq, structuredClone(sq.pending?.order ?? sq.order), stance)
  return true
}

/**
 * Push a destination out of any solid body it lands in. Flying into a planet is
 * never what anybody meant, and under a second of comm lag it is easy to do by
 * accident: aim at a world, and by the time your leaders hear you they are
 * already inside it. Gravity can still drag a squadron down onto a surface,
 * which is the version of that hazard worth keeping.
 *
 * Exported because the interface has to draw where an order will land, not where
 * the pointer was. Anything that previews a move has to apply the same lift or it
 * promises a destination the simulation is about to move.
 */
export function liftClear(w: World, sq: Squadron, to: Vec3): void {
  // An order places a formation, not a point, so the clearance has to cover the
  // formation's own radius. Lifting the centre by a hull's width instead put the
  // inward half of a wide wing inside the rock: a fleet told to take station against
  // a planet lost its leading hulls to the surface on arrival, which reads as the
  // interface having accepted an order it then declined to carry out.
  const margin = cls(sq.cls).size * 2 + 24 + formationRadius(sq.cls, flownStance(sq), aliveCount(w, sq))
  for (const b of w.bodies) {
    if (b.integrity <= 0) continue
    if (b.kind !== 'planet' && b.kind !== 'moon') continue
    const keep = b.radius + margin
    const d = dist(to, b.pos)
    if (d >= keep) continue
    // Straight out along the radius, or along the squadron's facing when the
    // order landed exactly on the centre and there is no radius to follow.
    const out = d > 1e-3 ? normalize(sub(to, b.pos)) : normalize(scale(sq.facing, -1))
    to.x = b.pos.x + out.x * keep
    to.y = b.pos.y + out.y * keep
    to.z = b.pos.z + out.z * keep
  }
}

function resolveOrders(w: World): void {
  for (const sq of w.squadrons) {
    if (!sq.pending || w.t < sq.pending.at) continue
    const { order, stance } = sq.pending
    sq.pending = null

    // Nobody left to hear it. A charge gets a word back because the player bet the
    // mission on that click and there is no second one: flying the Last Exam by hand,
    // three runs in six read "in reach, catches Hive", clicked, and then watched the
    // battle end with the planet untouched, because the courier died inside the comm
    // delay and `fireDevice` returned on a dead wing without saying anything. Every
    // other order goes quiet instead, since a wiped wing acknowledging one reads as the
    // order having been carried out.
    if (aliveCount(w, sq) === 0) {
      if (order.kind === 'device') {
        const pos = clone(sq.centroid)
        w.events.push({ kind: 'order', pos, side: sq.side, sq: sq.id, text: 'lost with the charge still aboard' })
      }
      continue
    }

    sq.stance = stance
    if (order.kind === 'device') {
      fireDevice(w, sq, order.to)
      sq.order = { kind: 'hold', at: clone(sq.centroid) }
    } else {
      sq.order = order
    }
    w.events.push({ kind: 'order', pos: clone(sq.centroid), side: sq.side, sq: sq.id })
  }
}

// ---------------------------------------------------------------------------
// Squadron level: turn one order into an anchor point and a formation facing

function driveSquadron(w: World, sq: Squadron, dt: number): void {
  const c = cls(sq.cls)
  copy(_anchor, sq.centroid)
  copy(_facing, sq.facing)

  const foe = nearestVisibleEnemy(w, sq.side, sq.centroid)
  /*
   * Contact means guns may already be tracking this wing, and that is when hulls
   * weave, not when they have picked a target of their own. Keyed to acquisition
   * it started at 190 for a needle while a lance shell reaches 240, so the last
   * fifty units of every approach were flown straight into the guns, which under
   * ballistic fire is the whole approach lost.
   *
   * Taking fire counts as contact even with nothing on sensors. A needle sees 165
   * and a lance shells it from 240, so the first volley out of the dark is
   * unavoidable, which is what scouts are for; flying on straight through the
   * second one because the shooter is still invisible is not.
   */
  let stung = false
  for (const id of sq.ships) {
    const s = shipById(w, id)
    if (s && s.alive && s.stress > 0) {
      stung = true
      break
    }
  }
  const hot = stung || (foe !== null && dist(foe.pos, sq.centroid) < 300)

  const order = sq.order
  if (order.kind === 'move') {
    copy(_anchor, order.to)
    const d = dist(sq.centroid, order.to)
    if (d > 25) copy(_facing, facingToward(sq.centroid, order.to))
    else if (foe) copy(_facing, facingToward(sq.centroid, foe.pos))
  } else if (order.kind === 'hold') {
    copy(_anchor, order.at)
    if (foe) copy(_facing, facingToward(sq.centroid, foe.pos))
  } else if (order.kind === 'attack') {
    const target = squadronById(w, order.sq)
    if (!target || aliveCount(w, target) === 0) {
      // Objective gone: hold where we are and let the AI or player retask us.
      sq.order = { kind: 'hold', at: clone(sq.centroid) }
    } else {
      copy(_facing, facingToward(sq.centroid, target.centroid))
      const away = normalize(sub(sq.centroid, target.centroid))
      const theirs = cls(target.cls).weapon?.range ?? 0
      const keep = c.weapon ? standoff(sq.cls, c.weapon.range, theirs) : standoff(sq.cls, 0)
      /*
       * Brawlers circulate instead of parking. The anchor is placed a fixed angle
       * ahead of the wing on its own ring around the target, so arriving is joining
       * a ring the wing then chases forever. From far out the approach is still the
       * straight line the order describes; the gate is what keeps a wing crossing
       * the volume from spiralling.
       *
       * This is where the needle-beats-lance leg of the triangle now lives. Parked
       * at standoff a needle is a zero-rate target and a lance shell takes it off
       * the board; on the ring it crosses the lance's sky at several times the
       * mount's traverse and the shells land behind it. Artillery holds its line,
       * because a wall that has to bear on its work cannot also stream around it.
       */
      const d = dist(sq.centroid, target.centroid)
      if (sq.cls === 'needle' && d < keep * 2.2) {
        orbitStep(away, sq.id % 2 === 0 ? ORBIT_LEAD : -ORBIT_LEAD)
      }
      set(
        _anchor,
        target.centroid.x + away.x * keep,
        target.centroid.y + away.y * keep,
        target.centroid.z + away.z * keep,
      )
    }
  }

  // Ease the formation facing so squadrons wheel instead of snapping.
  const turnRate = Math.min(1, dt * 2.2)
  sq.facing.x += (_facing.x - sq.facing.x) * turnRate
  sq.facing.y += (_facing.y - sq.facing.y) * turnRate
  sq.facing.z += (_facing.z - sq.facing.z) * turnRate
  normalizeInto(sq.facing)

  for (const id of sq.ships) {
    const s = shipById(w, id)
    if (!s || !s.alive) continue
    driveShip(w, sq, s, _anchor, hot, dt)
  }
}

/**
 * Rotate the radial `away` by `theta` around the world's vertical, in place, which
 * sweeps the attack anchor around the target in a mostly horizontal ring. Near the
 * poles the vertical is useless as an axis, so any perpendicular serves; the ring
 * tilts, and a tilted ring circulates just as well.
 */
function orbitStep(away: Vec3, theta: number): void {
  const k = Math.abs(away.y) < 0.85 ? UP_AXIS : anyPerp(away)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const d = dot(k, away)
  const cx = k.y * away.z - k.z * away.y
  const cy = k.z * away.x - k.x * away.z
  const cz = k.x * away.y - k.y * away.x
  set(
    away,
    away.x * cos + cx * sin + k.x * d * (1 - cos),
    away.y * cos + cy * sin + k.y * d * (1 - cos),
    away.z * cos + cz * sin + k.z * d * (1 - cos),
  )
  normalizeInto(away)
}

const UP_AXIS = v3(0, 1, 0)

// ---------------------------------------------------------------------------
// Ship level: hold a slot, keep the nose on the target, shoot when it bears

/**
 * How fast a hull in this wing can actually fly, which is less while it is carrying.
 *
 * This is the number that makes defending a volume possible at all. Every armed hull
 * tops out at 58 or below, so a carrier at full speed crossed any volume in the game
 * untouched: a chase from behind never closes against equal speed, and a wing passed at
 * a hundred and thirteen units is outside gun range, so the Last Exam's whole defence
 * in depth cost a beeline two hulls out of ten and the corridor it was built around
 * might as well not have been there. Slowed, a charge run is a commitment. It has to be
 * escorted, the defence has time to come to it, and spending the fleet to hold that
 * attention is the plan rather than a flourish. Releasing the charge gives the speed
 * back, which is the right shape too: what was slowing the wing down is gone.
 */
function topSpeed(sq: Squadron, c: ShipClass): number {
  return sq.device > 0 ? c.maxSpeed * CARRY_SPEED : c.maxSpeed
}

function driveShip(w: World, sq: Squadron, s: Ship, anchor: Vec3, hot: boolean, dt: number): void {
  const c = cls(s.cls)
  const top = topSpeed(sq, c)

  if (s.heat > 0) s.heat = Math.max(0, s.heat - dt * 3)
  if (s.stress > 0) s.stress = Math.max(0, s.stress - dt * 2.5)

  if ((w.tick + s.id) % 18 === 0) acquireTarget(w, s)

  const off = slotOffset(s.cls, sq.stance, s.slot, sq.facing)
  set(_slot, anchor.x + off.x, anchor.y + off.y, anchor.z + off.z)

  // Desired velocity: close on the slot, easing in over the last stretch.
  sub2(_des, _slot, s.pos)
  const d = len(_des)
  const approach = Math.min(top, d * 1.7)
  if (d > 1e-4) scaleTo(_des, approach / d)

  /*
   * Hulls in contact weave. This is real evasion now rather than theatre: the
   * lead a gun computes extrapolates current velocity, and a velocity that is a
   * sine wave makes that extrapolation wrong by more than a hull's width over a
   * long shell's flight, so the weave is what lets a wing cross an artillery
   * envelope at all. It costs speed made good, which is why it only runs when
   * somebody is close enough to be shooting.
   */
  const tgt = s.target >= 0 ? shipById(w, s.target) : undefined
  if (hot || (tgt && tgt.alive)) {
    const jinkAxis = anyPerp(s.fwd)
    const amp = top * (s.cls === 'needle' ? 0.34 : s.cls === 'eye' ? 0.3 : 0.1)
    const wobble = Math.sin(w.t * 2.4 + s.phase) * amp
    scaledAddInto(_des, jinkAxis, wobble)
  }

  separation(w, sq, s, _sep)
  scaledAddInto(_des, _sep, 1)
  avoidBodies(w, s.pos, s.vel, c.size, top, _des)
  clampLenInto(_des, top)

  sub2(_steer, _des, s.vel)

  /*
   * Nose before thrust, because thrust follows the nose. A hull with a fixed gun
   * points at its target while one is near and the order says fight; under a move
   * order it runs nose-first with its guns silent, which is the spinal trade told
   * straight: you cannot retreat at full burn and keep firing a gun that is bolted
   * to the hull. A hull whose gun is a turret owes its nose to nothing and points
   * it down the burn, which is what makes a wheeling fleet read as a fleet flying
   * rather than sliding.
   *
   * A pinned nose still leans. The mount's spare arc is spent toward the burn, so
   * a needle holds its target at the edge of its 48 degree cone and puts the rest
   * of its nose into the turn, which is most of what lets it circle fast enough
   * to beat a tracking mount. A lance's 22 degrees buys it almost nothing, on
   * purpose.
   */
  const turret = !c.weapon || c.weapon.arc >= Math.PI - 1e-3
  const fighting = sq.order.kind !== 'move'
  const aimAt =
    fighting && !turret && tgt && tgt.alive && c.weapon && dist(s.pos, tgt.pos) < c.weapon.range * 1.5
      ? tgt.pos
      : null
  if (aimAt) {
    sub2(_tmp, aimAt, s.pos)
    normalizeInto(_tmp)
    if (len(_steer) > 1e-4) {
      copy(_lean, _steer)
      normalizeInto(_lean)
      turnToward(_tmp, _lean, c.weapon!.arc * 0.75)
    }
  } else if (len(_steer) > c.accel * 0.12) copy(_tmp, _steer)
  else copy(_tmp, len(s.vel) > 2 ? s.vel : sq.facing)
  normalizeInto(_tmp)
  turnToward(s.fwd, _tmp, c.turn * dt)

  // Full burn only near the nose, thrusters everywhere else. Direction is
  // unchanged: a hull can always creep sideways, it just cannot fight that way.
  const want = len(_steer)
  if (want > 1e-4) {
    const along = Math.max(0, (s.fwd.x * _steer.x + s.fwd.y * _steer.y + s.fwd.z * _steer.z) / want)
    const eff = LATERAL_THRUST + (1 - LATERAL_THRUST) * along * along
    clampLenInto(_steer, c.accel * dt * eff)
    scaledAddInto(s.vel, _steer, 1)
  }

  // Gravity is not compensated: hulls fight wells with their thrust budget only,
  // which is what makes a slingshot or a botched close pass matter.
  gravityAt(w, s.pos, _grav)
  scaledAddInto(s.vel, _grav, dt)

  /*
   * The edge of the theatre is a soft wall for anything still fighting, and a door for a
   * wing that has been told to leave. A hull that goes through it is out of the battle and
   * that is all: no wreck, and no line on the tally, because the after-action card counts
   * what the fleet shot down and something that ran is something nobody caught.
   */
  const r = len(s.pos)
  if (r > w.bounds) {
    if (leaving(w, sq)) {
      s.alive = false
      return
    }
    copy(_tmp, s.pos)
    scaleTo(_tmp, -1 / r)
    scaledAddInto(s.vel, _tmp, c.accel * dt * 1.5)
  }

  scaledAddInto(s.pos, s.vel, dt)

  if (c.launch) stepLaunch(w, sq, s, dt)
  if (!c.weapon) return

  s.reload -= dt
  if (s.reload > 0 || !tgt || !tgt.alive) return

  const dt2 = dist2(s.pos, tgt.pos)
  if (dt2 > c.weapon.range * c.weapon.range) return
  sub2(_tmp, tgt.pos, s.pos)
  normalizeInto(_tmp)
  const bearing = _tmp.x * s.fwd.x + _tmp.y * s.fwd.y + _tmp.z * s.fwd.z
  if (bearing < Math.cos(c.weapon.arc)) return
  if (occluded(w, s.pos, tgt.pos)) return

  fire(w, s, tgt, Math.sqrt(dt2))
}

/** How far ahead a transit forecast looks, and how often it emits a point. */
const TRACK_SECONDS = 34
const TRACK_SAMPLE = 0.25

export interface Track {
  /**
   * Flat x, y, z triples along the forecast, oldest first, `TRACK_SAMPLE` apart.
   * Flat and caller owned because this is recomputed every frame for every
   * selected squadron, and a hundred and forty fresh vectors per track per frame
   * is a steady drip of garbage for a number the player only glances at.
   */
  path: number[]
  /** Points in `path`, which is what to iterate; the array keeps its capacity. */
  count: number
  /**
   * How far the run departs from the straight line to the destination, at its widest,
   * which is what a world in the lane costs. Avoidance holds a wing clear of a surface
   * whatever it was told, so the order goes out straight and the run comes back a curve
   * that lands late and to one side.
   */
  detour: number
}

export const emptyTrack = (): Track => ({ path: [], count: 0, detour: 0 })

// Scratch for the forecast alone. It cannot borrow the step's pool: it is called
// from the renderer between steps, and lending the hot loop's vectors outside the
// step is the aliasing bug that shows up as one wrong frame in fifty.
const _tpos = v3()
const _tto = v3()
const _tvel = v3()
const _tdes = v3()
const _tsteer = v3()
const _tgrav = v3()
const _tfrom = v3()
const _taxis = v3()
const _toff = v3()

/**
 * Where a squadron ordered to `to` would actually end up going.
 *
 * It measures one thing: how far off the straight line the run goes. Hulls steer around
 * a surface they are closing on, and swept over every approach angle and every stance,
 * nothing came within fifty units of a 130 radius planet's skin, so an order aimed
 * through a world is not flown into it. What the world costs is the detour, which lands
 * late and to one side of where the order was pointed, and in front of whatever was
 * waiting. Gravity is not what does it either: the same runs with the well switched off
 * bend within a unit of these, so this is the avoidance turn and not the pull.
 *
 * An earlier version warned about crashes instead, and could not fire: `liftClear` pushes
 * a destination out of any solid and `avoidBodies` turns hulls away from a surface, so
 * the run it warned about does not exist.
 *
 * This re-runs `driveShip`'s integration at the same step, minus the terms that
 * do not survive averaging over a formation: slot offsets and separation cancel
 * around the centroid, and the weave only applies to hulls already in a fight.
 * It is a forecast of an undisturbed run, so it stops being true the moment
 * somebody shoots at them, which is the honest thing for it to be.
 */
export function predictTrack(w: World, sq: Squadron, to: Vec3, out: Track): Track {
  const c = cls(sq.cls)
  const top = topSpeed(sq, c)
  copy(_tpos, sq.centroid)
  // Against the destination the order will actually get, which for a click on a
  // world is the shell around it rather than the rock.
  liftClear(w, sq, copy(_tto, to))
  set(_tvel, 0, 0, 0)
  let n = 0
  for (const id of sq.ships) {
    const s = shipById(w, id)
    if (!s || !s.alive) continue
    scaledAddInto(_tvel, s.vel, 1)
    n++
  }
  if (n > 0) scaleTo(_tvel, 1 / n)

  out.count = 0
  out.detour = 0
  emit(out, _tpos)

  // The straight line the order describes, kept as a unit vector from the start, so
  // each forecast sample can be dropped onto it to measure how far the run has been
  // pushed off the lane the player drew.
  copy(_tfrom, _tpos)
  sub2(_taxis, _tto, _tfrom)
  const span = len(_taxis)
  if (span > 1e-3) scaleTo(_taxis, 1 / span)

  const steps = Math.round(TRACK_SECONDS / DT)
  const every = Math.round(TRACK_SAMPLE / DT)

  for (let i = 1; i <= steps; i++) {
    sub2(_tdes, _tto, _tpos)
    const d = len(_tdes)
    if (d < c.size * 2 + 8) break
    // At the speed the wing will actually fly, which for a carrier is the slower one:
    // a forecast drawn at full speed ends the run seconds early and reads as a crossing
    // the defence has no time to meet.
    scaleTo(_tdes, Math.min(top, d * 1.7) / d)
    // With a hull's own margin, not the wing's, because that is the turn the hulls
    // will actually fly, and the turn is the whole thing being forecast.
    avoidBodies(w, _tpos, _tvel, c.size, top, _tdes)

    sub2(_tsteer, _tdes, _tvel)
    clampLenInto(_tsteer, c.accel * DT)
    scaledAddInto(_tvel, _tsteer, 1)

    gravityAt(w, _tpos, _tgrav)
    scaledAddInto(_tvel, _tgrav, DT)

    const r = len(_tpos)
    if (r > w.bounds) scaledAddInto(_tvel, _tpos, (-c.accel * DT * 1.5) / r)

    scaledAddInto(_tpos, _tvel, DT)

    if (span > 1e-3) {
      sub2(_toff, _tpos, _tfrom)
      scaledAddInto(_toff, _taxis, -dot(_toff, _taxis))
      out.detour = Math.max(out.detour, len(_toff))
    }
    if (i % every === 0) emit(out, _tpos)
  }
  // A run ends where the wing arrives, which is nowhere near the sampling stride, so the
  // last point goes in whatever the stride was doing. Without it the drawn line stops up
  // to a quarter second short of where the squadron actually stops.
  emit(out, _tpos)
  return out
}

/** Append a point, reusing slots the last forecast already grew the array into. */
function emit(t: Track, p: Vec3): void {
  const i = t.count * 3
  if (i < t.path.length) {
    t.path[i] = p.x
    t.path[i + 1] = p.y
    t.path[i + 2] = p.z
  } else {
    t.path.push(p.x, p.y, p.z)
  }
  t.count++
}

function stepLaunch(w: World, sq: Squadron, s: Ship, dt: number): void {
  const launch = cls(s.cls).launch!
  s.launchTimer -= dt
  if (s.launchTimer > 0) return
  s.launchTimer = launch.every

  const wingId = sq.wing
  if (wingId === undefined) return
  const wing = squadronById(w, wingId)
  if (!wing) return
  if (aliveCount(w, wing) >= launch.cap) return

  const off = w.rng.sphere(cls(s.cls).size * 1.6)
  const born = spawnShip(w, wing, {
    x: s.pos.x + off.x,
    y: s.pos.y + off.y,
    z: s.pos.z + off.z,
  })
  copy(born.vel, s.vel)
  // Slot into the first hole left by a casualty, so the wing stays compact.
  born.slot = firstFreeSlot(w, wing, born.id)
  w.events.push({ kind: 'launch', pos: clone(born.pos), side: s.side, cls: 'needle' })
}

function firstFreeSlot(w: World, sq: Squadron, exclude: number): number {
  const used = new Set<number>()
  for (const id of sq.ships) {
    if (id === exclude) continue
    const s = shipById(w, id)
    if (s && s.alive) used.add(s.slot)
  }
  for (let i = 0; ; i++) if (!used.has(i)) return i
}

/**
 * Steer away from a surface the hull is closing on, by bending `out` (a desired
 * velocity) around it.
 *
 * Nothing in the flight model knew about rock, so a wing ordered across a planet
 * flew into it, and a fleet chasing an enemy parked behind one did the same. That
 * turned Overwhelm's planet from cover into a weapon: forty four of the fifty
 * attacking hulls died on Anvil's skin and one died to gunfire, so a mission about
 * holding a volume against three to one odds was really a mission about standing
 * behind the right rock. Cover only means anything if the enemy flies around it.
 *
 * Two details make the turn work. The lookahead grows with speed, so a hull
 * committed at full thrust starts turning early enough to make it; and the closing
 * part of the desired velocity is cancelled rather than reversed, so a wing crossing
 * a body slides around the limb instead of stalling in front of it. A hull that
 * arrives too fast still hits. This is a steering preference, not a guarantee, the
 * same way gravity is something hulls fight rather than something they cancel.
 */
function avoidBodies(w: World, pos: Vec3, vel: Vec3, size: number, maxSpeed: number, out: Vec3): void {
  for (const b of w.bodies) {
    if (b.integrity <= 0) continue
    if (b.kind !== 'planet' && b.kind !== 'moon') continue
    sub2(_away, pos, b.pos)
    const d = len(_away)
    const keep = b.radius + size * 2 + 30 + len(vel) * 1.2
    if (d >= keep || d < 1e-4) continue
    scaleTo(_away, 1 / d)
    const closing = Math.max(0, -dot(out, _away))
    const depth = Math.min(1, Math.max(0, 1 - (d - b.radius) / (keep - b.radius)))
    scaledAddInto(out, _away, closing + maxSpeed * depth * depth * 1.4)
  }
}

function separation(w: World, sq: Squadron, s: Ship, out: Vec3): Vec3 {
  set(out, 0, 0, 0)
  const min = personalSpace(s.cls)
  const min2 = min * min
  for (const id of sq.ships) {
    if (id === s.id) continue
    const o = shipById(w, id)
    if (!o || !o.alive) continue
    const d2 = dist2(s.pos, o.pos)
    if (d2 > min2 || d2 < 1e-6) continue
    const d = Math.sqrt(d2)
    const push = (1 - d / min) * cls(s.cls).maxSpeed * 0.9
    out.x += ((s.pos.x - o.pos.x) / d) * push
    out.y += ((s.pos.y - o.pos.y) / d) * push
    out.z += ((s.pos.z - o.pos.z) / d) * push
  }
  return out
}

function acquireTarget(w: World, s: Ship): void {
  const c = cls(s.cls)
  if (!c.weapon) {
    s.target = -1
    return
  }
  const current = s.target >= 0 ? shipById(w, s.target) : undefined
  // Stay on a live target that is still in reach: switching wastes reload time.
  if (current && current.alive && dist2(s.pos, current.pos) < (c.weapon.range * 1.4) ** 2) return

  const acquire = c.weapon.range * 1.9
  const foe = other(s.side)
  const seen = w.seen[s.side]
  let best = -1
  let bestScore = Infinity
  for (const t of w.ships) {
    if (!t.alive || t.side !== foe) continue
    const d2 = dist2(s.pos, t.pos)
    if (d2 > acquire * acquire) continue
    if (!seen.has(t.id) && d2 > 120 * 120) continue
    // Prefer close targets, but weight towards hulls already hurt so that fire
    // concentrates and squadrons actually finish kills.
    const hpFrac = t.hp / cls(t.cls).hp
    const score = Math.sqrt(d2) * (0.65 + hpFrac * 0.5)
    if (score < bestScore) {
      bestScore = score
      best = t.id
    }
  }
  s.target = best
}

/**
 * Loose a round at `tgt`, and where it goes is the whole combat model. The gun
 * computes an honest lead, trails it by whatever crossing rate the mount cannot
 * follow, scatters it by the weapon's dispersion, and from that point the bolt is
 * on its own: no roll was made and nothing steers. Every tactical fact falls out
 * of those three lines. Range works because the same scatter cone subtends less
 * hull further away; crossing works because the lag is real; and a tight enemy
 * formation is a better target than a wide one because a round that misses its
 * mark keeps flying into whoever is behind it.
 */
function fire(w: World, s: Ship, tgt: Ship, d: number): void {
  const weapon = cls(s.cls).weapon!

  // One fixed-point pass on the lead: aim where the target will be, then correct
  // the flight time for where that is. A second pass moves the answer under a
  // tenth of a unit at these speeds.
  let flight = d / weapon.boltSpeed
  const aim = v3(tgt.pos.x + tgt.vel.x * flight, tgt.pos.y + tgt.vel.y * flight, tgt.pos.z + tgt.vel.z * flight)
  flight = dist(s.pos, aim) / weapon.boltSpeed
  set(aim, tgt.pos.x + tgt.vel.x * flight, tgt.pos.y + tgt.vel.y * flight, tgt.pos.z + tgt.vel.z * flight)

  // The crossing rate is relative, so a fast shooter suffers it against a parked
  // target exactly as a parked shooter suffers it against a fast one.
  sub2(_rel, tgt.vel, s.vel)
  sub2(_los, aim, s.pos)
  normalizeInto(_los)
  scaledAddInto(_rel, _los, -dot(_rel, _los))
  const omega = len(_rel) / Math.max(d, 1)
  const lag = Math.min(0.5, Math.max(0, omega - weapon.traverse) * TRACK_LAG)
  if (lag > 0) {
    // Behind the target's apparent motion: the mount is late, not wrong at random.
    normalizeInto(_rel)
    scaledAddInto(aim, _rel, -lag * d)
  }

  // A friendly standing in the lane holds the shot, before any of it is spent, so
  // the gun fires the moment the lane clears. This is what a formation's shape now
  // costs and buys: a wall bears everything it has, a ball masks its own rear
  // ranks, and firing over your own screen into a melee is a thing you choose.
  for (const o of w.ships) {
    if (!o.alive || o.side !== s.side || o.id === s.id) continue
    if (dist2(s.pos, o.pos) >= d * d) continue
    if (segmentDist(s.pos, aim, o.pos) < hitRadius(o.cls) + 2) return
  }

  s.reload = weapon.cycle * w.rng.range(0.92, 1.08)
  s.heat = 1
  w.stats.shots++

  const muzzle = v3(
    s.pos.x + s.fwd.x * cls(s.cls).size * 0.6,
    s.pos.y + s.fwd.y * cls(s.cls).size * 0.6,
    s.pos.z + s.fwd.z * cls(s.cls).size * 0.6,
  )
  const scatter = w.rng.sphere(weapon.dispersion)
  const dir = normalize(sub(aim, muzzle))
  dir.x += scatter.x
  dir.y += scatter.y
  dir.z += scatter.z
  normalizeInto(dir)

  w.bolts.push({
    id: w.nextId++,
    side: s.side,
    from: s.id,
    pos: muzzle,
    vel: v3(dir.x * weapon.boltSpeed, dir.y * weapon.boltSpeed, dir.z * weapon.boltSpeed),
    damage: weapon.damage,
    // Enough flight to arrive plus a short overrun, per shot rather than per
    // weapon. A miss still sprays the formation standing behind the target, but
    // it does not carry on across a whole melee: a ring of needles firing inward
    // at a wing it surrounds was taking more of its own hulls off the far side
    // of the ring than lances it was ringing.
    life: dist(muzzle, aim) / weapon.boltSpeed + 0.15,
    cls: s.cls,
  })
  w.events.push({ kind: 'shot', pos: clone(s.pos), side: s.side, cls: s.cls })
}

// ---------------------------------------------------------------------------
// Bolts

function stepBolts(w: World, dt: number): void {
  const live: Bolt[] = []
  for (const b of w.bolts) {
    b.life -= dt
    if (b.life <= 0) continue

    gravityAt(w, b.pos, _grav)
    scaledAddInto(b.vel, _grav, dt)

    copy(_prev, b.pos)
    scaledAddInto(b.pos, b.vel, dt)

    /*
     * Swept against every hull on both sides, because a bolt no longer knows who it
     * was for. The first hull along the path takes it, friend or foe: that is what
     * makes interposition a tactic and stray fire a cost. Swept rather than point
     * tested since a round moves five to six units a frame and a needle is three
     * wide, so a point test would tunnel through the very hulls dodging matters for.
     */
    const step = len(b.vel) * dt
    let struck: Ship | null = null
    let along = Infinity
    for (const ship of w.ships) {
      if (!ship.alive || ship.id === b.from) continue
      const hr = hitRadius(ship.cls) + 1.5
      const cull = step + hr
      if (dist2(_prev, ship.pos) > cull * cull) continue
      if (segmentDist(_prev, b.pos, ship.pos) >= hr) continue
      const t = dist2(_prev, ship.pos)
      if (t < along) {
        along = t
        struck = ship
      }
    }
    if (struck) {
      damage(w, struck, b.damage, b.side)
      w.events.push({ kind: 'hit', pos: clone(struck.pos), side: b.side, cls: struck.cls, power: b.damage })
      continue
    }

    // Bolts that plough into a planet stop there.
    let swallowed = false
    for (const body of w.bodies) {
      if (body.integrity <= 0) continue
      if (body.kind !== 'planet' && body.kind !== 'moon') continue
      if (dist2(b.pos, body.pos) < body.radius * body.radius) {
        w.events.push({ kind: 'hit', pos: clone(b.pos), side: b.side, power: 0.4 })
        swallowed = true
        break
      }
    }
    if (!swallowed) live.push(b)
  }
  w.bolts = live
}

export function damage(w: World, s: Ship, amount: number, from: Side): void {
  let left = amount
  if (s.shield > 0 && s.cover) {
    // Per impact, not per point. A field that soaked damage one for one would be
    // nothing but spare hit points, which is a strength check rather than a
    // counter: it would help most against whatever hits hardest. Biting a fixed
    // amount out of every bolt inverts that, and inverting it is the whole
    // tactical point of a screen.
    const absorbed = Math.min(s.shield, s.cover.bite, left)
    s.shield -= absorbed
    left -= absorbed
  }
  s.hp -= left
  s.stress = 1
  if (s.hp > 0) return
  kill(w, s, from === s.side ? 'friendly' : 'enemy')
}

/**
 * `friendly` and `friendlyDevice` mean the hull was taken by its own side. The tally
 * counts the device case for blue only, because the after-action card is written from
 * blue's chair and "our own, by cascade" is the mistake the player most needs named.
 * It used to be indexed on the victim's side instead, so an enemy charge landing in
 * your formation read as your own doing.
 */
export function kill(w: World, s: Ship, cause: 'enemy' | 'friendly' | 'device' | 'friendlyDevice' | 'crash'): void {
  if (!s.alive) return
  s.alive = false
  s.hp = 0
  const sq = squadronById(w, s.sq)
  if (sq) sq.lost++
  const cost = cls(s.cls).cost
  if (s.side === 'blue') w.stats.blueLost += cost
  else w.stats.redLost += cost
  const byDevice = cause === 'device' || cause === 'friendlyDevice'
  if (byDevice) {
    w.stats.deviceKills++
    if (cause === 'friendlyDevice' && s.side === 'blue') w.stats.friendlyDeviceKills++
  }
  w.events.push({ kind: 'kill', pos: clone(s.pos), side: s.side, cls: s.cls, power: byDevice ? 2 : 1 })
}


// ---------------------------------------------------------------------------
// Aegis fields

/**
 * Overlapping fields give redundancy, not invulnerability: whichever screen has
 * the largest pool covers the hull, and it alone sets the ceiling, the recharge
 * and the bite. Summing them made a wall of four aegis mathematically unkillable
 * by small arms, which is not a tactical problem, just a wall.
 */
function stepFields(w: World, dt: number): void {
  // Recompute coverage a few times a second; shields are a slow pool, so the
  // extra precision of a per-frame pass would buy nothing.
  if (w.tick % 12 === 1) {
    for (const s of w.ships) s.cover = null
    for (const a of w.ships) {
      if (!a.alive) continue
      const field = cls(a.cls).field
      if (!field) continue
      const r2 = field.radius * field.radius
      for (const s of w.ships) {
        if (!s.alive || s.side !== a.side) continue
        if (dist2(a.pos, s.pos) > r2) continue
        if (!s.cover || field.pool > s.cover.pool) s.cover = field
      }
    }
  }

  for (const s of w.ships) {
    if (!s.alive) continue
    if (!s.cover) {
      // Uncovered hulls bleed off whatever charge they were carrying, so walking
      // out from behind a screen costs you its protection within a few seconds.
      if (s.shield > 0) s.shield = Math.max(0, s.shield - dt * 9)
      continue
    }
    if (s.shield < s.cover.pool) s.shield = Math.min(s.cover.pool, s.shield + dt * s.cover.regen)
  }
}

// ---------------------------------------------------------------------------
// Terrain hazards

function stepHazards(w: World, dt: number): void {
  if (w.tick % 10 !== 3) return
  const slice = dt * 10
  for (const s of w.ships) {
    if (!s.alive) continue
    for (const b of w.bodies) {
      if (b.integrity <= 0) continue
      if (b.kind === 'planet' || b.kind === 'moon') {
        if (dist2(s.pos, b.pos) < (b.radius + cls(s.cls).size) ** 2) {
          kill(w, s, 'crash')
          break
        }
      } else if (insideDisc(b, s.pos)) {
        /*
         * Cover is not free: rock chews on anything sitting in it, and it chews in
         * proportion to how blind it makes you, so the dense field that hides a fleet
         * costs 1.0 a second and a thin ring costs 0.6. One number rather than two,
         * because a disc's density is the only thing that differs between them.
         *
         * The rate was 3.5 for most of the build, which is 2.4 a second in a belt and
         * kills a 32 hull needle in thirteen seconds. Shoal's card says hulls die in
         * there slowly, and thirteen seconds is not slowly: at that price nothing light
         * can lurk in cover, so the concealment the mission is built around was unusable
         * by either side, and the belt was quietly deciding the battle. Six runs of
         * Shoal with both sides on the AI billed red 271 hull to the rock, a third of
         * its fleet, against blue's 139, because the side crossing the volume is the
         * side that pays. At 1.5 a needle lasts half a minute in the worst dust, which
         * is a real price for a real ambush. It moved Shoal from 83 to 67 percent AI
         * against AI, and the scripted run at the homeworld from 23 of 24 to 20 of 24.
         *
         * The price is what had to change, not the flying. Keeping stations out of dust
         * was the first attempt, since a flank waypoint is thrown a few hundred units
         * sideways and lands in the belt about half the time: pushing every station clear
         * of the slab moved red's bill on Shoal from 271 to 275. The time is spent
         * crossing and fighting, not parked, so there was nothing there to fix.
         */
        damage(w, s, 1.5 * (1 - b.sensorFactor) * slice, s.side)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The device

/**
 * Where a charge released from `from` at `to` would actually go off. A world is
 * solid, so a bolt detonates on the first skin it meets rather than at the point
 * the player clicked, which may be deep inside a planet or behind a moon.
 *
 * Resolving that here rather than only in flight is what keeps the interface
 * honest. Reach, the cascade preview and the sphere drawn around the aim point all
 * have to describe the same place, or the panel is quietly promising a shot the
 * simulation will not fire: a click on a planet's centre would read as a hundred
 * and seventy free units of standoff and as a cascade that eats nothing.
 *
 * Callers pass what was aimed at, never a point this function already returned. Its
 * output sits exactly on a skin, and a point on a sphere is the one input the
 * intersection cannot classify reliably: re-resolving one lost the body in seven of
 * twelve measured geometries, which downgraded a surface shot to a fused one and burst
 * the charge on the first hull it passed instead of on the planet.
 */
export function deviceTarget(w: World, from: Vec3, to: Vec3): { at: Vec3; body: Body | null } {
  let nearest = 1
  let hit: Body | null = null
  for (const body of w.bodies) {
    if (body.integrity <= 0) continue
    if (body.kind !== 'planet' && body.kind !== 'moon') continue
    const t = skinHit(from, to, body.pos, body.radius + 4)
    if (t !== null && t < nearest) {
      nearest = t
      hit = body
    }
  }
  return { at: nearest < 1 ? add(from, scale(sub(to, from), nearest)) : clone(to), body: hit }
}

/** The burst point alone, for the callers that only draw or count with it. */
export const deviceAim = (w: World, from: Vec3, to: Vec3): Vec3 => deviceTarget(w, from, to).at

/**
 * Where the segment `from`..`to` first crosses a sphere, as a fraction of its
 * length, or null if it never does.
 */
function skinHit(from: Vec3, to: Vec3, centre: Vec3, radius: number): number | null {
  const d = sub(to, from)
  const m = sub(from, centre)
  const a = dot(d, d)
  if (a < 1e-6) return null
  const b = dot(m, d)
  const disc = b * b - a * (dot(m, m) - radius * radius)
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / a
  return t >= 0 && t <= 1 ? t : null
}

export function fireDevice(w: World, sq: Squadron, to: Vec3): void {
  if (sq.device <= 0 || sq.deviceLock > 0) return
  let from: Ship | undefined
  for (const id of sq.ships) {
    const s = shipById(w, id)
    if (s && s.alive) {
      from = s
      break
    }
  }
  if (!from) return
  // Measured from the squadron rather than from the hull that happens to be
  // carrying, because the squadron is what the player aimed and what the reach
  // ring was drawn around. A formation is wide enough that the difference would
  // show up as a shot refused after the panel said it was good.
  const { at, body } = deviceTarget(w, sq.centroid, to)
  if (dist(sq.centroid, at) > DEVICE_RANGE) {
    w.events.push({ kind: 'order', pos: clone(sq.centroid), side: sq.side, sq: sq.id, text: 'out of reach' })
    return
  }

  sq.device--
  sq.deviceLock = 4
  const dir = normalize(sub(at, from.pos))
  const speed = DEVICE_BOLT_SPEED
  w.deviceBolts.push({
    id: w.nextId++,
    side: sq.side,
    pos: clone(from.pos),
    vel: v3(dir.x * speed, dir.y * speed, dir.z * speed),
    to: at,
    life: 14,
    contact: body !== null,
  })
  w.events.push({ kind: 'device', pos: clone(from.pos), side: sq.side, text: sq.name })
}

function stepDevice(w: World, dt: number): void {
  const liveBolts = []
  for (const b of w.deviceBolts) {
    b.life -= dt
    scaledAddInto(b.pos, b.vel, dt)
    let detonate = b.life <= 0 || dist2(b.pos, b.to) < 64
    if (!detonate && !b.contact) {
      // Trips on the first enemy hull it passes. Without this the charge burst at
      // the coordinate the cursor found, which by the time it arrived (comm delay,
      // then a run at 150) was where the swarm had been a second and a half ago:
      // aiming at a knot of eighteen needles took three of them, and no amount of
      // arithmetic in the panel could have told the player where to aim instead,
      // since hulls turn at two hundred degrees a second while they fight. Tripping
      // on contact moves the burst to the crowd, which is the thing the player
      // actually picked. Only enemy hulls arm it, or it would go off in the
      // launching formation's own face before it had gone anywhere.
      //
      // A charge thrown at a surface is exempt, because the reason for the fuse does
      // not apply there: an aim point in open space goes stale while the order is in
      // flight, and a planet does not move. This is the rule stated properly rather
      // than an exception to it. It was written believing it also fixed the Last Exam,
      // where the release was made in nineteen runs of twenty four and the planet
      // survived eighteen, and it fixed nothing: the sweep came back byte for byte
      // identical, so the charge had never once tripped short on a garrison hull. What
      // was actually eating those runs was the objective being scored after the fleet
      // wipe. The exemption is still correct on its own terms.
      for (const s of w.ships) {
        if (!s.alive || s.side === b.side) continue
        if (dist2(b.pos, s.pos) < DEVICE_TRIP * DEVICE_TRIP) {
          detonate = true
          break
        }
      }
    }
    if (!detonate) {
      for (const body of w.bodies) {
        if (body.integrity <= 0) continue
        if (body.kind !== 'planet' && body.kind !== 'moon') continue
        if (dist2(b.pos, body.pos) < (body.radius + 4) ** 2) {
          detonate = true
          break
        }
      }
    }
    if (detonate) {
      w.nodes.push({
        id: w.nextId++,
        pos: clone(b.pos),
        radius: DEVICE_RADIUS,
        fuse: 0,
        depth: 0,
        side: b.side,
        fired: false,
        age: 0,
      })
    } else {
      liveBolts.push(b)
    }
  }
  w.deviceBolts = liveBolts

  if (w.nodes.length === 0) return

  const spawned: DeviceNode[] = []
  const liveNodes: DeviceNode[] = []
  for (const node of w.nodes) {
    node.age += dt
    if (!node.fired) {
      node.fuse -= dt
      if (node.fuse <= 0) {
        node.fired = true
        detonateNode(w, node, spawned)
      }
    }
    // Keep spent nodes around briefly so the renderer can bloom them out.
    if (node.age < 1.4) liveNodes.push(node)
  }
  for (const n of spawned) {
    if (liveNodes.length + 1 > DEVICE_MAX_NODES) break
    liveNodes.push(n)
  }
  w.nodes = liveNodes
}

function detonateNode(w: World, node: DeviceNode, spawned: DeviceNode[]): void {
  w.events.push({
    kind: 'cascade',
    pos: clone(node.pos),
    side: node.side,
    power: node.radius / DEVICE_RADIUS,
  })

  const r2 = node.radius * node.radius
  for (const s of w.ships) {
    if (!s.alive) continue
    if (dist2(s.pos, node.pos) > r2) continue
    kill(w, s, s.side === node.side ? 'friendlyDevice' : 'device')
    // Every hull the field eats is fuel for the next generation. Loose
    // formations starve it; a packed fleet feeds it all the way through.
    if (node.depth < DEVICE_MAX_DEPTH && w.rng() < DEVICE_CHAIN) {
      spawned.push({
        id: w.nextId++,
        pos: clone(s.pos),
        radius: node.radius * DEVICE_DECAY,
        fuse: DEVICE_FUSE,
        depth: node.depth + 1,
        side: node.side,
        fired: false,
        age: 0,
      })
    }
  }

  for (const body of w.bodies) {
    if (!body.consumable || body.integrity <= 0) continue
    if (dist(node.pos, body.pos) > body.radius + node.radius) continue
    // A planet is effectively infinite fuel: once it catches, it goes.
    body.integrity = Math.max(0, body.integrity - 0.34)
    w.events.push({ kind: 'cascade', pos: clone(body.pos), side: node.side, power: 6 })
    if (body.integrity <= 0) {
      w.events.push({ kind: 'unmade', pos: clone(body.pos), side: node.side, text: body.name })
      // Everything close enough to be standing on it goes with it.
      for (const s of w.ships) {
        if (!s.alive || dist(s.pos, body.pos) >= body.radius * 2.4) continue
        kill(w, s, s.side === node.side ? 'friendlyDevice' : 'device')
      }
    } else if (node.depth < DEVICE_MAX_DEPTH) {
      const off = w.rng.sphere(body.radius * 1.1)
      spawned.push({
        id: w.nextId++,
        pos: v3(body.pos.x + off.x, body.pos.y + off.y, body.pos.z + off.z),
        radius: node.radius,
        fuse: DEVICE_FUSE * 1.6,
        depth: node.depth + 1,
        side: node.side,
        fired: false,
        age: 0,
      })
    }
  }
}

/**
 * How many hulls a device shot at `to` would take, per side, counted where the hulls
 * are standing now.
 *
 * A snapshot is only honest because the charge trips on contact. Aimed at a fixed
 * coordinate it would detonate where the swarm was a second and a half ago (comm
 * delay, then the run out at 150), and the panel would promise eighteen hulls for a
 * burst that took three. Trying to lead the count instead is worse than useless:
 * hulls turn at two hundred degrees a second and weave while they fight, so
 * extrapolating a formation along its current velocity for a second and a half
 * scatters it, and the preview then promises nothing at all. What the fuse gives the
 * count is a burst that happens in the crowd rather than at a stale coordinate, and a
 * crowd is a thing a snapshot describes correctly.
 *
 * Pass `walk` to get the chain itself and not only its total: seven numbers per hop, the
 * hull that catches and the one it catches from, then the odds the chain is still going
 * by the time it gets there. That is what the overlay draws, because the reach is a
 * property of the crowd rather than of the weapon and a radius drawn around the burst
 * would be a lie in both directions at once, promising hulls in empty space and hiding a
 * chain that walks four hundred through a dense one.
 *
 * `reach` is how far this chain gets through this crowd, which is the number the panel
 * warns on. The alternative was DEVICE_REACH, the 455 a chain manages when every
 * generation finds a hull to jump from, and against a real formation that bound fired on
 * every shot worth taking: five releases at a standoff of 275 to 341 all read as inside
 * the walk and all cost the fleet nothing, because the chain had run out of hulls between
 * sixty and a hundred and thirty out. A warning that is on for every shot is a warning the player stops reading.
 */
export function previewCascade(
  w: World,
  to: Vec3,
  walk?: number[],
): { red: number; blue: number; reach: number } {
  const counted = new Set<number>()
  let red = 0
  let blue = 0
  let reach = 0
  if (walk) walk.length = 0
  let frontier = [{ pos: to, radius: DEVICE_RADIUS, depth: 0, odds: 1 }]
  while (frontier.length > 0) {
    const next: typeof frontier = []
    for (const node of frontier) {
      const r2 = node.radius * node.radius
      for (const s of w.ships) {
        if (!s.alive || counted.has(s.id)) continue
        if (dist2(s.pos, node.pos) > r2) continue
        counted.add(s.id)
        if (s.side === 'blue') blue++
        else red++
        reach = Math.max(reach, Math.sqrt(dist2(s.pos, to)))
        if (walk) {
          walk.push(node.pos.x, node.pos.y, node.pos.z, s.pos.x, s.pos.y, s.pos.z, node.odds)
        }
        if (node.depth < DEVICE_MAX_DEPTH) {
          next.push({
            pos: s.pos,
            radius: node.radius * DEVICE_DECAY,
            depth: node.depth + 1,
            odds: node.odds * DEVICE_CHAIN,
          })
        }
      }
    }
    frontier = next
  }
  return { red, blue, reach }
}

/**
 * How far a burst at `to` would be from catching the world the mission names, or null
 * when the mission names none. Zero or less means the first flash reaches it.
 *
 * The panel counted hulls and said nothing about the one thing the Last Exam is scored
 * on. Playing it by hand, the cursor was on the homeworld, the aim snapped to the
 * garrison wing floating in front of it, and the panel read "in reach, takes ten of
 * theirs" over a shot that burst seventy off the rock and never touched it. Nothing it
 * printed was false and the release still failed, which is the same fault as lying.
 *
 * Only the first flash is counted, not the walk. The walk is a chain of coin flips and
 * it is what the player is gambling on when this number is positive; promising it here
 * would turn a gamble into a guarantee the simulation does not offer.
 */
export function objectiveReach(w: World, to: Vec3): { name: string; off: number } | null {
  const o = w.objective
  if (o.kind !== 'unmake') return null
  const body = w.bodies.find((b) => b.id === o.body)
  if (!body || body.integrity <= 0) return null
  return { name: body.name, off: dist(to, body.pos) - body.radius - DEVICE_RADIUS }
}

// ---------------------------------------------------------------------------
// Sensors

function updateSensors(w: World): void {
  /*
   * Deaths are settled against the previous pass's contacts, before the sets below are
   * rebuilt. This loop used to run after the rebuild, where "died while we could see it"
   * could never be true: the rebuild skips dead hulls, so a hull the fleet watched come
   * apart was no longer in `seen` by the time it was asked about, and its marker sat on
   * the wreck for the full memory. Every brawl left a scatter of hollow rings over its
   * own kills, each claiming a contact the player had just watched end.
   *
   * A hull that dies out of contact keeps its last known position, because nobody in the
   * fleet knows it is gone. That is the whole point of a ghost.
   */
  for (const [id, ghost] of w.ghosts) {
    const s = shipById(w, id)
    if (!s || (!s.alive && w.seen.blue.has(id)) || w.t - ghost.at > GHOST_MEMORY) {
      w.ghosts.delete(id)
    }
  }

  for (const side of ['blue', 'red'] as Side[]) {
    const seen = w.seen[side]
    seen.clear()
    const foe = other(side)
    for (const eye of w.ships) {
      if (!eye.alive || eye.side !== side) continue
      const reach = cls(eye.cls).sensor * sensorFactorAt(w, eye.pos)
      for (const t of w.ships) {
        if (!t.alive || t.side !== foe || seen.has(t.id)) continue
        // Sitting in a debris field cuts your own signature too.
        const effective = reach * sensorFactorAt(w, t.pos)
        if (dist2(eye.pos, t.pos) < effective * effective) seen.add(t.id)
      }
    }
  }

  for (const id of w.seen.blue) {
    const s = shipById(w, id)
    if (s && s.alive) w.ghosts.set(id, { pos: clone(s.pos), at: w.t, cls: s.cls })
  }
}

export function nearestVisibleEnemy(w: World, side: Side, p: Vec3): Ship | null {
  const foe = other(side)
  const seen = w.seen[side]
  let best: Ship | null = null
  let bd = Infinity
  for (const s of w.ships) {
    if (!s.alive || s.side !== foe) continue
    if (!seen.has(s.id)) continue
    const d = dist2(s.pos, p)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Objectives

/**
 * The objective is settled before the fleet is, and the order matters more than it
 * looks. A cascade that consumes a homeworld also consumes everything standing on it,
 * which on the Last Exam is the wing that carried the charge in and often the last
 * thing blue has left. Scoring the wipe first turned nineteen runs that unmade Hive
 * into six wins and thirteen losses, reported to the player as a defeat in the moment
 * the planet came apart on screen. Whether the fleet outlives the shot is not what
 * either side was asked.
 */
function checkObjective(w: World): void {
  if (w.outcome !== 'running') return
  const red = fleetStrength(w, 'red')

  const o = w.objective
  switch (o.kind) {
    case 'annihilate':
      if (red <= 0) w.outcome = 'won'
      break
    case 'survive':
      if (w.t >= (o.seconds ?? 120)) w.outcome = 'won'
      break
    case 'unmake': {
      const body = w.bodies.find((b) => b.id === o.body)
      if (body && body.integrity <= 0) w.outcome = 'won'
      break
    }
    case 'breakthrough': {
      if (!o.point) break
      let n = 0
      for (const s of w.ships) {
        if (s.alive && s.side === 'blue' && dist2(s.pos, o.point) < 70 * 70) n++
      }
      if (n >= (o.count ?? 6)) w.outcome = 'won'
      break
    }
    case 'decapitate': {
      const names = o.targets ?? []
      const remaining = squadronsOf(w, 'red').filter((sq) => names.includes(sq.name))
      if (remaining.length === 0) w.outcome = 'won'
      break
    }
  }

  /*
   * Only a wiped fleet has lost, and a fleet with no guns left is not the same thing. That
   * distinction cost a rule: scoring a disarmed fleet as beaten reads as mercy, since the
   * commander has nothing left to order, and it ended Shoal 7 to 27 seconds earlier in the
   * two runs of twelve that reach that state. It also took away a win. On seed 1308 blue's
   * last gun died with red down to one lance on 4 of 88 hull, and that lance flew for 24
   * more seconds before drifting into the belt, which finished it: blue won at T+84 with a
   * single scout alive. The dust kills, so a hull that can still be led into it is a hull
   * that can still be killed, and a scout at speed 74 towing something at 30 is exactly the
   * kind of play this game should be for. What the player is owed there is the news, not a
   * verdict, so the channel says the guns are gone and the battle stays open.
   */
  if (w.outcome === 'running' && fleetStrength(w, 'blue') <= 0 && !stillResolving(w, 'blue')) w.outcome = 'lost'
}

/**
 * True while something this side has already launched could still decide the battle:
 * a charge in flight, or a cascade that has not finished walking.
 *
 * Ordering the objective ahead of the wipe was not enough on its own. A cascade takes
 * a couple of seconds to walk, and on the Last Exam it walks inward through the
 * garrison eating the wing that carried it: playing the mission by hand, the last blue
 * hull died with the field five units short of the homeworld, the battle was scored
 * lost that frame, and the simulation stopped stepping with Hive at full integrity and
 * seven nodes hanging in the air around it. A player who spent their fleet delivering
 * the shot was told the shot failed, when what actually happened was that nobody
 * waited for it.
 *
 * Held rather than special cased to `unmake`, because the same thing decides an
 * annihilation whose last enemy wing is standing inside a cascade. The hold is bounded
 * by the weapon: bolts expire and each generation decays, so this cannot stall a
 * finished battle for more than the walk it is waiting on.
 *
 * Ordinary gunfire counts for the same reason. A fleet's last hull almost always dies with
 * a bolt of its own in the air: 46 of 192 sweep runs across the eight missions reach the
 * wipe holding blue fire, and in 6 of them that fire takes a red hull down after every blue
 * hull is gone. None of those 6 was close enough for the kill to flip the mission, but the
 * flip is the same event with red on its last hull, and a shot already away is a shot the
 * commander spent. The wait is bounded either way, since a bolt lives at most 2.2 seconds.
 */
function stillResolving(w: World, side: Side): boolean {
  for (const b of w.bolts) if (b.side === side) return true
  for (const b of w.deviceBolts) if (b.side === side) return true
  for (const n of w.nodes) if (n.side === side && !n.fired) return true
  return false
}

// ---------------------------------------------------------------------------
// Small helpers kept local to the hot loop

function sub2(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.x - b.x, a.y - b.y, a.z - b.z)
}

function scaleTo(o: Vec3, s: number): Vec3 {
  return set(o, o.x * s, o.y * s, o.z * s)
}

/** Rotate `fwd` towards `to` by at most `maxRad`, keeping it unit length. */
function turnToward(fwd: Vec3, to: Vec3, maxRad: number): void {
  const d = fwd.x * to.x + fwd.y * to.y + fwd.z * to.z
  const clamped = d > 1 ? 1 : d < -1 ? -1 : d
  const angle = Math.acos(clamped)
  if (angle < 1e-4) return
  if (angle <= maxRad) {
    copy(fwd, to)
    return
  }
  const t = maxRad / angle
  // Slerp is overkill here; a normalized lerp along the arc is indistinguishable
  // at 60Hz and avoids the degenerate case when the vectors are opposed.
  if (angle > Math.PI - 1e-3) {
    const perp = anyPerp(fwd)
    fwd.x += perp.x * maxRad
    fwd.y += perp.y * maxRad
    fwd.z += perp.z * maxRad
  } else {
    fwd.x += (to.x - fwd.x) * t
    fwd.y += (to.y - fwd.y) * t
    fwd.z += (to.z - fwd.z) * t
  }
  normalizeInto(fwd)
}

export { cross }
