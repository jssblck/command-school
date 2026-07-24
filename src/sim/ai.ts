import { cls } from './classes'
import { DEVICE_RANGE, DEVICE_REACH, deviceAim, issueOrder, leaving, previewCascade } from './step'
import type { ClassId, Ship, Side, Squadron, World } from './types'
import { other } from './types'
import { aliveCount, canStillKill, shipById, squadronsOf } from './world'
import { anyPerp, clone, cross, dist, len, normalize, scale, sub, v3, type Vec3 } from './vec3'

export interface CommanderConfig {
  /** How often the commander re-reads the board, in seconds. */
  period: number
  /** 0 sits back and reacts, 1 throws everything at the priority target. */
  aggression: number
  /** 0 charges straight in, 1 flanks, focuses fire and uses cover. */
  skill: number
  /** Minimum enemy hulls in a cluster before the device is worth a charge. */
  deviceThreshold: number
}

export const DEFAULT_COMMANDER: CommanderConfig = {
  period: 1.7,
  aggression: 0.6,
  skill: 0.5,
  deviceThreshold: 7,
}

export interface Commander {
  side: Side
  cfg: CommanderConfig
  next: number
  /** Squadron id the commander is currently massing on. */
  priority: number
  /**
   * Squadrons the commander will not touch. A scripted plan (a mission hook, or
   * the player taking direct control of a wing) needs to be able to hold a
   * squadron without the commander countermanding it two seconds later.
   */
  reserved: Set<number>
  /** Per squadron: the flank waypoint it is running to before it engages. */
  approach: Map<number, Vec3>
}

export function makeCommander(side: Side, cfg: Partial<CommanderConfig> = {}): Commander {
  return {
    side,
    cfg: { ...DEFAULT_COMMANDER, ...cfg },
    next: 0.4,
    priority: -1,
    reserved: new Set(),
    approach: new Map(),
  }
}

/**
 * How much each hull class wants to pick a fight with each other class.
 * These numbers are the whole personality of the AI: needles hunt lances and
 * scouts, lances shell capitals, and nobody volunteers to chew through an aegis.
 */
const PREFERENCE: Record<ClassId, Record<ClassId, number>> = {
  // Needles push through the screen rather than around it: the aegis is the
  // reason their fire is not landing, so it is the thing worth dying to reach.
  needle: { needle: 1, lance: 1.7, aegis: 1.2, keel: 1.15, eye: 1.5 },
  lance: { needle: 0.7, lance: 1, aegis: 1.1, keel: 1.8, eye: 0.6 },
  aegis: { needle: 1, lance: 0.9, aegis: 0.8, keel: 0.9, eye: 0.7 },
  keel: { needle: 1, lance: 1.2, aegis: 0.9, keel: 1.2, eye: 0.6 },
  eye: { needle: 0, lance: 0, aegis: 0, keel: 0, eye: 0 },
}

export function think(w: World, cmd: Commander, dt: number): void {
  cmd.next -= dt
  if (cmd.next > 0) return
  cmd.next = cmd.cfg.period * w.rng.range(0.85, 1.15)

  const mine = squadronsOf(w, cmd.side).filter((sq) => !cmd.reserved.has(sq.id))
  const foeSide = other(cmd.side)

  if (!canStillKill(w, cmd.side)) {
    for (const sq of mine) withdraw(w, sq)
    return
  }

  const theirs = squadronsOf(w, foeSide).filter((sq) => visibleTo(w, cmd.side, sq))
  if (mine.length === 0) return

  if (theirs.length === 0) {
    // Nothing on sensors: sweep towards the last place we saw anything, and push
    // the scouts out wide to find them again.
    for (const sq of mine) sweep(w, cmd, sq)
    return
  }

  cmd.priority = pickPriority(w, cmd, theirs)
  // The carrier is held out of everything below once the charge has claimed it: a
  // device order waits in `pending` for the comm delay, so any other order issued
  // to the same squadron in the same think throws the shot away before it lands.
  const runner = tryDevice(w, cmd, mine, theirs)
  const rest = runner < 0 ? mine : mine.filter((sq) => sq.id !== runner)
  const chasing = intercept(w, cmd, rest, theirs)

  for (const sq of rest) {
    if (chasing.has(sq.id)) continue
    if (sq.cls === 'eye') {
      shadow(w, cmd, sq, theirs)
      continue
    }
    if (sq.cls === 'aegis') {
      // `rest`, so a screen never follows the carrier in: a charge run is a hull
      // spent on purpose, and an aegis that goes with it spends the line's cover
      // on the one wing that was always going to die.
      escort(w, cmd, sq, rest)
      continue
    }
    commit(w, cmd, sq, theirs)
  }
}

function visibleTo(w: World, side: Side, sq: Squadron): boolean {
  const seen = w.seen[side]
  for (const id of sq.ships) {
    const s = shipById(w, id)
    if (s && s.alive && seen.has(s.id)) return true
  }
  return false
}

function value(w: World, sq: Squadron): number {
  return aliveCount(w, sq) * cls(sq.cls).cost
}

/** The squadron worth massing on: soft, valuable and close to our centre. */
function pickPriority(w: World, cmd: Commander, theirs: Squadron[]): number {
  const centre = fleetCentre(w, cmd.side)
  // What we are guarding, if anything, and how deep into it they have got. A wing
  // closing on the homeworld is the battle, whatever else is on the board: without
  // this term the front wings all massed on blue's main fleet and a ten-hull runner
  // threaded between them at a hundred and thirteen units, arriving at the shell with
  // eight hulls and unmaking the planet in twenty six seconds. Nothing about the
  // corridor mattered, which made every piece of cover in it decoration.
  const keep = keepPoint(w, cmd.side)
  let best = -1
  let bestScore = -Infinity
  for (const sq of theirs) {
    const n = aliveCount(w, sq)
    const hurt = 1 - hullFraction(w, sq)
    const d = dist(centre, sq.centroid)
    let score = cls(sq.cls).cost * n * 0.5 + hurt * 22 - d * 0.035 + (sq.cls === 'keel' ? 14 : 0)
    if (keep) {
      // Scaled by depth rather than switched on at a threshold, so the whole fleet
      // does not turn around the moment anything crosses a line.
      const depth = Math.max(0, 1 - dist(sq.centroid, keep.at) / (keep.reach * 3))
      score += depth * depth * 90
    }
    if (score > bestScore) {
      bestScore = score
      best = sq.id
    }
  }
  return best
}

/**
 * The thing this side loses the battle by losing. Objectives are written as
 * blue's task, so the asset under guard is always red's: the homeworld it is
 * standing in front of, or the capitals somebody has been sent to decapitate.
 * In a straight fight there is nothing to defend, so nothing can be raided.
 */
function keepPoint(w: World, side: Side): { at: Vec3; reach: number } | null {
  if (side !== 'red') return null
  const obj = w.objective
  if (obj.kind === 'unmake') {
    const body = w.bodies.find((b) => b.id === obj.body)
    // A planet can only be unmade by a charge carried into reach of its surface, so
    // the radius worth patrolling is that reach measured from the surface, plus a
    // margin to meet a carrier before it is in range rather than as it releases.
    return body && body.integrity > 0
      ? { at: body.pos, reach: body.radius + DEVICE_RANGE * 1.7 }
      : null
  }
  if (obj.kind === 'decapitate' && obj.targets) {
    const names = obj.targets
    const guarded = squadronsOf(w, 'red').filter((sq) => names.includes(sq.name))
    if (guarded.length === 0) return null
    const c = v3()
    for (const sq of guarded) {
      c.x += sq.centroid.x / guarded.length
      c.y += sq.centroid.y / guarded.length
      c.z += sq.centroid.z / guarded.length
    }
    return { at: c, reach: 380 }
  }
  return null
}

/**
 * Enemy squadrons that have come within reach of what we cannot afford to lose.
 * Chasing one costs us the screen, and that is the honest price: the way to move
 * a defending fleet is to threaten the thing it is defending.
 */
function intercept(w: World, cmd: Commander, mine: Squadron[], theirs: Squadron[]): Set<number> {
  const chasing = new Set<number>()
  const keep = keepPoint(w, cmd.side)
  if (!keep) return chasing

  const raiders = theirs
    .filter((sq) => dist(sq.centroid, keep.at) < keep.reach)
    .sort((a, b) => dist(a.centroid, keep.at) - dist(b.centroid, keep.at))

  for (const raider of raiders) {
    let chaser: Squadron | null = null
    let best = -Infinity
    for (const sq of mine) {
      if (chasing.has(sq.id) || !cls(sq.cls).weapon) continue
      // Send whoever can actually catch them: speed first, distance second.
      const score = cls(sq.cls).maxSpeed * 4 - dist(sq.centroid, raider.centroid) * 0.12
      if (score > best) {
        best = score
        chaser = sq
      }
    }
    if (!chaser) break
    issueOrder(w, chaser, { kind: 'attack', sq: raider.id }, pickStance(w, chaser, raider))
    chasing.add(chaser.id)
  }
  return chasing
}

function hullFraction(w: World, sq: Squadron): number {
  let hp = 0
  let max = 0
  for (const id of sq.ships) {
    const s = shipById(w, id)
    if (!s || !s.alive) continue
    hp += s.hp
    max += cls(s.cls).hp
  }
  return max > 0 ? hp / max : 0
}

function fleetCentre(w: World, side: Side): Vec3 {
  let n = 0
  const c = v3()
  for (const s of w.ships) {
    if (!s.alive || s.side !== side) continue
    c.x += s.pos.x
    c.y += s.pos.y
    c.z += s.pos.z
    n++
  }
  if (n > 0) {
    c.x /= n
    c.y /= n
    c.z /= n
  }
  return c
}

/** Choose a target and either engage it or run a flank first. */
function commit(w: World, cmd: Commander, sq: Squadron, theirs: Squadron[]): void {
  let target: Squadron | null = null
  let bestScore = -Infinity
  for (const t of theirs) {
    const pref = PREFERENCE[sq.cls][t.cls]
    const d = dist(sq.centroid, t.centroid)
    let score = pref * 40 - d * 0.09 + (1 - hullFraction(w, t)) * 18
    if (t.id === cmd.priority) score += 55 * cmd.cfg.aggression
    if (score > bestScore) {
      bestScore = score
      target = t
    }
  }
  if (!target) return

  // Lances that have been caught by interceptors give ground rather than trade,
  // unless they are the ones holding a charge. Backing away is what kept the device
  // in the bay for whole battles: the reach of the charge is shorter than the range
  // a battery likes to sit at, so a carrier that keeps its distance never gets to
  // use the one thing it was given.
  if (sq.cls === 'lance' && sq.device <= 0) {
    const threat = nearestThreat(w, sq, 'needle')
    if (threat && dist(threat.pos, sq.centroid) < 130) {
      const away = normalize(sub(sq.centroid, threat.pos))
      issueOrder(w, sq, { kind: 'move', to: offset(sq.centroid, away, 260) }, 'open')
      return
    }
  }

  const d = dist(sq.centroid, target.centroid)
  // Flank only from outside the ring the waypoint sits on. Testing against a flat
  // 330 instead let a fleet orbit its target for a whole battle: the waypoint lands
  // 392 out at default skill, arriving there passed the same test again, and the
  // next think picked a fresh angle at the same radius. Deriving the trigger from
  // the geometry is what makes the approach terminate.
  const wantsFlank = cmd.cfg.skill > 0.35 && d > flankReach(cmd.cfg.skill) * 1.25 && sq.cls !== 'keel'
  if (wantsFlank && !cmd.approach.has(sq.id)) {
    cmd.approach.set(sq.id, flankPoint(w, sq, target, cmd.cfg.skill))
  }

  const waypoint = cmd.approach.get(sq.id)
  if (waypoint) {
    if (dist(sq.centroid, waypoint) < 90 || d < 240) {
      cmd.approach.delete(sq.id)
    } else {
      issueOrder(w, sq, { kind: 'move', to: clone(waypoint) }, 'open')
      return
    }
  }

  issueOrder(w, sq, { kind: 'attack', sq: target.id }, pickStance(w, sq, target))
}

function pickStance(w: World, sq: Squadron, target: Squadron): Squadron['stance'] {
  const n = aliveCount(w, sq)
  // Artillery fights from a line: a wall gets every barrel onto the target and
  // keeps the squadron thin enough that one area shot cannot take the battery.
  if (sq.cls === 'lance') return n >= 3 ? 'wide' : 'open'
  // A crowd inside artillery reach is a gift to any area weapon, so spread out.
  if (n >= 8 && target.cls === 'lance') return 'wide'
  if (sq.cls === 'keel') return 'open'
  if (n <= 4) return 'tight'
  return 'open'
}

function nearestThreat(w: World, sq: Squadron, of: ClassId): Ship | null {
  const foe = other(sq.side)
  const seen = w.seen[sq.side]
  let best: Ship | null = null
  let bd = Infinity
  for (const s of w.ships) {
    if (!s.alive || s.side !== foe || s.cls !== of) continue
    if (!seen.has(s.id)) continue
    const d = dist(s.pos, sq.centroid)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

/** How far off the axis a flank swings, and how far short of the target it stops. */
const flankSpread = (skill: number): number => 200 + 220 * skill
const FLANK_STAND = 240

/** The radius the waypoint lands on, which is the range a flank closes to. */
function flankReach(skill: number): number {
  return Math.hypot(FLANK_STAND, flankSpread(skill))
}

/**
 * A point off the target's flank, biased to whichever side is emptier, so
 * attacks arrive from an axis the defender is not already facing.
 */
function flankPoint(w: World, sq: Squadron, target: Squadron, skill: number): Vec3 {
  const axis = normalize(sub(sq.centroid, target.centroid))
  const right = anyPerp(axis)
  const up = cross(axis, right)
  const angle = w.rng.range(0, Math.PI * 2)
  const spread = flankSpread(skill)
  const lateral = v3(
    right.x * Math.cos(angle) + up.x * Math.sin(angle),
    right.y * Math.cos(angle) + up.y * Math.sin(angle),
    right.z * Math.cos(angle) + up.z * Math.sin(angle),
  )
  return v3(
    target.centroid.x + axis.x * FLANK_STAND + lateral.x * spread,
    target.centroid.y + axis.y * FLANK_STAND + lateral.y * spread,
    target.centroid.z + axis.z * FLANK_STAND + lateral.z * spread,
  )
}

function escort(w: World, cmd: Commander, sq: Squadron, mine: Squadron[]): void {
  let best: Squadron | null = null
  let bestVal = -Infinity
  for (const other of mine) {
    if (other.id === sq.id || other.cls === 'aegis' || other.cls === 'eye') continue
    const val = value(w, other)
    if (val > bestVal) {
      bestVal = val
      best = other
    }
  }
  if (!best) {
    issueOrder(w, sq, { kind: 'hold', at: clone(sq.centroid) })
    return
  }
  // Sit just ahead of the charge so the field covers the hulls taking fire.
  const lead = scale(best.facing, 26)
  issueOrder(w, sq, { kind: 'move', to: offset(best.centroid, lead, 1) }, 'tight')
  void cmd
}

function shadow(w: World, cmd: Commander, sq: Squadron, theirs: Squadron[]): void {
  let far: Squadron | null = null
  let bd = -Infinity
  const centre = fleetCentre(w, cmd.side)
  for (const t of theirs) {
    const d = dist(centre, t.centroid)
    if (d > bd) {
      bd = d
      far = t
    }
  }
  const focus = far ?? theirs[0]
  const away = normalize(sub(centre, focus.centroid))
  issueOrder(w, sq, { kind: 'move', to: offset(focus.centroid, away, 300) }, 'wide')
}

/**
 * Nothing this fleet still has aboard can take a hull off the board, so it runs for the
 * nearest edge of the volume and out.
 *
 * Without this, a mission could reach a state neither side could end. Shoal on seed 1000:
 * blue traded down to two lances, red to a single scout, and the scout is the fastest thing
 * in the game at 74 against a needle's 58 and a lance's 30, so nothing armed can ever run one
 * down. The board sat unchanged from T+38 to T+202, both wings holding an attack order on a
 * wing they could not reach, and the run ended on the harness clock rather than on anything
 * that happened. A fleet that has lost its guns has lost the battle, and a commander who can
 * see that flies what is left out rather than parking it in someone's sights.
 *
 * Only the AI does this, and the asymmetry is the point: withdrawing is a commander's
 * decision, and blue's commander is the player, who may well have a reason to stay. Blue
 * keeps the mission open after its last gun dies, which is what the channel line about the
 * guns being gone is for, and on seed 1308 that was worth a win: a disarmed blue scout towed
 * red's last lance into the debris belt and the rock finished it at T+84.
 */
function withdraw(w: World, sq: Squadron): void {
  if (leaving(w, sq)) return
  // Radially out, because from anywhere in the volume that is the shortest way to an edge,
  // and the hull-level steering still swings the wing around anything in the way.
  const out = len(sq.centroid) > 1 ? normalize(sq.centroid) : clone(sq.facing)
  issueOrder(w, sq, { kind: 'move', to: scale(out, w.bounds + 260) }, 'wide')
}

function sweep(w: World, cmd: Commander, sq: Squadron): void {
  const foe = other(cmd.side)
  let guess: Vec3 | null = null
  // Head for the enemy's opening deployment if we have nothing better. Live hulls
  // only: a wreck sits where it died, so the first dead hull in the list would send
  // the sweep to the one place the enemy is known not to be.
  for (const s of w.ships) {
    if (!s.alive || s.side !== foe) continue
    guess = clone(s.pos)
    break
  }
  if (!guess) return
  const jitter = w.rng.sphere(sq.cls === 'eye' ? 380 : 140)
  issueOrder(w, sq, {
    kind: 'move',
    to: v3(guess.x + jitter.x, guess.y + jitter.y, guess.z + jitter.z),
  })
}

/**
 * What a charge bursting at `at` puts at risk on your own side, as a weight rather
 * than a body count.
 *
 * The count of your own hulls standing inside the first node is the obvious measure
 * and it is worthless: it reads zero for nearly every shot worth taking, because the
 * cascade spends two seconds walking outward and what it eats is whatever closes on it
 * meanwhile. Scoring that way, red spent three of its own hulls for every one of
 * blue's in the exam. Reach is the honest measure, since it is a fixed property of the
 * weapon and standoff is the one thing a commander can decide.
 *
 * The player's panel deliberately measures something else, how far the chain in front of
 * the cursor actually walks, because a warning has to be either on or off and 455 was on
 * for every shot in the game. A weight can afford the weapon's bound: a hull at 341
 * contributes a quarter here rather than a shout, so the falloff says roughly what the
 * chain says without having to trace it for every candidate target in the pass.
 */
function cascadeRisk(w: World, side: Side, at: Vec3): number {
  let risk = 0
  for (const s of w.ships) {
    if (!s.alive || s.side !== side) continue
    const d = dist(s.pos, at)
    if (d < DEVICE_REACH) risk += 1 - d / DEVICE_REACH
  }
  return risk
}

/**
 * Carry the charge to what it is for, and release it when it is in reach.
 *
 * Returns the carrier if it has been given an order here, so the caller can hold it
 * out of the rest of the pass: the order waits in `pending` for the comm delay, and
 * anything else said to the same wing in the same think replaces it.
 *
 * The run in is the half that was missing. A release only ever became available when
 * the carrier already happened to be within a hundred and thirty of a crowd, which for
 * a battle wing means in the melee, and firing from inside a melee is firing into your
 * own formation: red spent three of its own hulls per one of blue's that way. Nothing
 * else in the pass would move a wing to a release point on purpose, so the charge was
 * either an accident or unused. Taking it there deliberately is what makes a courier
 * a plan, and it is the same thing a player does by hand.
 */
function tryDevice(w: World, cmd: Commander, mine: Squadron[], theirs: Squadron[]): number {
  const carrier = mine.find((sq) => sq.device > 0 && sq.deviceLock <= 0)
  if (!carrier) return -1

  // A homeworld outranks any number of hulls, because unmaking it ends the battle.
  // Nothing else in the pass reads the objective, so without this the autopilot flew
  // its runner into the escort and fought there, and the one mission the campaign
  // builds toward was a mission no commander ever attempted.
  const home = homeworldTarget(w, cmd.side)
  if (home) {
    const at = deviceAim(w, carrier.centroid, home)
    if (dist(carrier.centroid, at) <= DEVICE_RANGE * 0.92) {
      // The order carries the centre of the world, not the burst point resolved from
      // it. `fireDevice` resolves once, and handing it a point already sitting on the
      // skin is the one input that arithmetic cannot answer reliably.
      issueOrder(w, carrier, { kind: 'device', to: clone(home) })
    } else {
      issueOrder(w, carrier, { kind: 'move', to: clone(home) }, 'tight')
    }
    return carrier.id
  }

  // Otherwise the densest visible knot, with a cascade preview to be sure the charge
  // pays for itself against how much of our own fleet is standing inside the volume
  // the cascade can walk.
  const seen = w.seen[cmd.side]
  const candidates: Ship[] = []
  for (const sq of theirs) {
    for (const id of sq.ships) {
      const s = shipById(w, id)
      if (s && s.alive && seen.has(s.id)) candidates.push(s)
    }
  }
  if (candidates.length < cmd.cfg.deviceThreshold) return -1

  /** The hull aimed at, not the skin the charge would stop on: see the homeworld branch. */
  let bestTo: Vec3 | null = null
  let bestKills = 0
  let runTo: Vec3 | null = null
  let runKills = 0
  for (const s of candidates) {
    // Counted where the burst would actually happen. A planet between the carrier
    // and the knot stops the charge on its skin, so previewing the aim point
    // instead credits the shot with hulls it would never reach. This is the same
    // correction the panel makes before it shows the player a number.
    const at = deviceAim(w, carrier.centroid, s.pos)
    const preview = previewCascade(w, at)
    const foeKills = cmd.side === 'blue' ? preview.red : preview.blue
    if (foeKills < cmd.cfg.deviceThreshold) continue
    if (dist(carrier.centroid, at) > DEVICE_RANGE * 0.92) {
      // Out of reach, so this is a candidate to run at instead. Judged on the crowd
      // alone: what the shot costs depends on where our own hulls are standing when
      // it goes off, and that is minutes away and not yet decided.
      if (foeKills > runKills) {
        runKills = foeKills
        runTo = at
      }
      continue
    }
    // Own hulls weigh more than enemy hulls: the mission is fought with what survives.
    const net = foeKills - cascadeRisk(w, cmd.side, at) * 2.5
    if (net > bestKills) {
      bestKills = net
      bestTo = clone(s.pos)
    }
  }
  if (bestTo) {
    issueOrder(w, carrier, { kind: 'device', to: bestTo })
    return carrier.id
  }
  if (runTo) {
    issueOrder(w, carrier, { kind: 'move', to: runTo }, 'tight')
    return carrier.id
  }

  return -1
}

/**
 * The surface this side has been sent to unmake, if the objective names one. Written
 * as blue's task, the same way `keepPoint` reads it as red's.
 */
function homeworldTarget(w: World, side: Side): Vec3 | null {
  if (side !== 'blue' || w.objective.kind !== 'unmake') return null
  const body = w.bodies.find((b) => b.id === w.objective.body)
  return body && body.integrity > 0 ? body.pos : null
}

const offset = (from: Vec3, dir: Vec3, k: number): Vec3 =>
  v3(from.x + dir.x * k, from.y + dir.y * k, from.z + dir.z * k)

