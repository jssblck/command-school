import { Color, Group, PerspectiveCamera, Vector3 } from 'three'
import { cls } from '../sim/classes'
import { formationRadius } from '../sim/formation'
import { DEVICE_RADIUS, DEVICE_RANGE, GHOST_MEMORY, emptyTrack, liftClear, predictTrack } from '../sim/step'
import { aliveCount, sensorFactorAt, squadronById } from '../sim/world'
import type { Squadron, World } from '../sim/types'
import type { Controls } from '../ui/controls'
import { ATTACK, DEVICE, GHOST, ORDER, SELECT } from './palette'
import { Streaks } from './fx'

/**
 * Two pools of scratch vectors, and the split matters. The primitives below only
 * ever write `_p` and `_q`; the callers only ever write `_a`, `_b`, `_c`. One pool
 * shared by both is a trap, because a caller that builds an endpoint in a scratch
 * vector and hands it to a primitive hands over a vector the primitive is about to
 * overwrite, and every line collapses to a point at one end.
 */
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _p = new Vector3()
const _q = new Vector3()
/** For callers that draw between primitives rather than through them: the track and the walk. */
const _t0 = new Vector3()
const _t1 = new Vector3()

/**
 * Every annotation is scaled by this before it is drawn, and the number is not
 * arbitrary: it holds the brightest interface colour just under the bloom
 * threshold. Overlay lines that bloom go soft and white, which costs them both
 * their colour coding and the crispness that makes them read as an instrument
 * laid over the battle rather than as something burning in it.
 */
const GAIN = 0.5

/**
 * The worst hiding place in the volume, as a fraction of a sensor's reach. One number for
 * the whole theatre rather than one per body, because the question a scout's circle answers
 * is how close it has to be before a fleet that is hiding stops being invisible, and the
 * answer a player can act on is the shortest of them.
 */
function dimmest(w: World): number {
  let f = 1
  for (const b of w.bodies) if (b.integrity > 0) f = Math.min(f, b.sensorFactor)
  return f
}

/**
 * Everything the player draws on the volume, as opposed to everything that is in
 * it. Selection rings, order lines, the aim cursor and the device preview all
 * live here, rebuilt from scratch every frame out of the command state.
 *
 * The recurring problem this solves is that a point of light in a black volume
 * has no depth: two hulls a thousand units apart look identical if they land on
 * the same pixel. So most annotations here come in pairs, a mark out in the
 * volume and a dashed line dropped to the reference plane beneath it, because the
 * drop line is what tells you where the mark actually is.
 */
export class Overlay {
  readonly group = new Group()
  private readonly lines = new Streaks(8000)
  /**
   * One forecast buffer for every track drawn this frame. Safe to share because
   * `track` consumes it before it returns, and it is the difference between an
   * allocation-free overlay and a few thousand dead vectors a second.
   */
  private readonly forecast = emptyTrack()
  /** The camera this frame is being drawn from, so marks can be sized on screen. */
  private cam: PerspectiveCamera | null = null

  constructor() {
    this.group.add(this.lines.lines)
  }

  update(w: World, c: Controls, camera: PerspectiveCamera, fog: boolean): void {
    this.cam = camera
    this.lines.begin()

    if (fog) this.ghosts(w)

    for (const sq of w.squadrons) {
      if (aliveCount(w, sq) === 0) continue
      if (sq.side !== 'blue') {
        // Contacts get brackets and nothing else. The enemy is something you have
        // seen, not something you have information about.
        if (c.hover === sq.id) this.bracket(w, sq)
        continue
      }
      if (c.selected.has(sq.id)) {
        this.ring(w, sq, SELECT, 1)
        this.reach(w, sq)
        this.orders(w, sq)
      } else if (c.hover === sq.id) {
        this.ring(w, sq, SELECT, 0.35)
      }
    }

    this.cursor(w, c)
    this.device(c)
    this.lines.end()
  }

  /**
   * A squadron's mark: a ring at the radius the formation actually occupies, so it
   * doubles as a reading of how far the stance has spread them, and a drop line.
   */
  private ring(w: World, sq: Squadron, color: Color, mag: number): void {
    const r = formationRadius(sq.cls, sq.stance, aliveCount(w, sq)) * 1.15
    _a.set(sq.centroid.x, sq.centroid.y, sq.centroid.z)
    this.circle(_a, r, color, mag)
    _b.set(sq.centroid.x, 0, sq.centroid.z)
    this.dashed(_a, _b, color, mag * 0.28, 26)
  }

  /**
   * How far the squadron's guns carry, drawn faintly. Range is the whole substance
   * of a tactical decision here, so it should be something the player reads off
   * the picture rather than something they learn by losing a wing to a lance.
   *
   * A screen gets no reach circle, because it already has a circle. An aegis field
   * is 78 units plus six tenths of the formation's spread, which is 88 to 114 over
   * every stance and hull count, against a gun that reaches a flat 100: select a
   * screen and the two marks land within a dozen units of each other, in the same
   * dim blue, and neither one reads. The field is the mark worth keeping. It is the
   * reason the class is in the fleet, while the gun is a two point pinprick nobody
   * positions a screen to use.
   *
   * A scout carries no gun, so the circle that matters is the one it was bought
   * for. Drawing its sensors puts the mission's own arithmetic on the plot: the
   * scout sees 470 and the longest gun in the volume reaches 240, so the band
   * between the two circles is where it watches a line that cannot touch it.
   * Playing Shoal by hand, both mistakes cost the same fleet: too close and the
   * scout dies, too far and the fleet is chasing marks half a minute old.
   *
   * Sensors are the one reach a body can take away, so the scout's circle shrinks
   * inside dust the way its sensors do. A ring that stayed at 470 while the wing
   * sitting in the belt could see 140 would be the interface promising something
   * the simulation has no intention of delivering.
   *
   * Dust cuts twice, though, and one ring could only ever show half of it: a contact
   * hides in it as well, so what the fleet can see is the scout's reach cut by where
   * the scout is standing and cut again by where the contact is. On Shoal that is 470
   * in clear volume and 150 into the belt, and fourteen of red's hulls open the mission
   * inside it. Flying it with one ring, the plot read 470 in every direction while their
   * lances went undrawn at 417, and the plan clicked at volume where the arithmetic said
   * a wing should be. The second ring is that arithmetic: whatever is hiding in dust has
   * to be inside it before the fleet has anything to shoot at.
   */
  private reach(w: World, sq: Squadron): void {
    const c = cls(sq.cls)
    if (c.field) return
    _a.set(sq.centroid.x, sq.centroid.y, sq.centroid.z)
    if (c.weapon) {
      this.circle(_a, c.weapon.range, SELECT, 0.22, 96)
      return
    }
    const here = c.sensor * sensorFactorAt(w, sq.centroid)
    this.circle(_a, here, SELECT, 0.22, 96)
    const dim = dimmest(w)
    if (dim < 1) this.circle(_a, here * dim, SELECT, 0.13, 48)
  }

  /** Four ticks around a contact, the one annotation reserved for the enemy. */
  private bracket(w: World, sq: Squadron): void {
    const r = formationRadius(sq.cls, sq.stance, aliveCount(w, sq)) * 1.3
    _a.set(sq.centroid.x, sq.centroid.y, sq.centroid.z)
    for (let i = 0; i < 4; i++) {
      const th = (i / 4) * Math.PI * 2 + Math.PI / 4
      const dx = Math.cos(th) * r
      const dz = Math.sin(th) * r
      _b.set(_a.x + dx, _a.y, _a.z + dz)
      _c.set(_a.x + dx * 0.7, _a.y, _a.z + dz * 0.7)
      this.line(_b, _c, ATTACK, 0.9, 0.9)
    }
  }

  /**
   * Remembered contacts, one mark per wing rather than one per hull. A ghost is a claim
   * about the past, so it is drawn the way the player's own annotations are drawn, a hollow
   * ring at the spread the wing was last holding with the usual line dropped to the
   * reference plane, and it thins out as the sighting ages.
   *
   * It lives here rather than in the fleet because a ghost is not in the volume. The version
   * that was, a small hollow point of light per remembered hull, failed at both ranges: from
   * across the theatre a dozen of them were a grey smudge that said nothing about how the
   * wing was arranged, and up close they were faint rings at an unreadable depth, in the one
   * mission whose briefing promises a player can tell a stale contact from a live hull.
   */
  private ghosts(w: World): void {
    for (const sq of w.squadrons) {
      if (sq.side === 'blue') continue
      let n = 0
      let oldest = w.t
      _a.set(0, 0, 0)
      for (const id of sq.ships) {
        const g = w.seen.blue.has(id) ? undefined : w.ghosts.get(id)
        if (!g) continue
        _a.x += g.pos.x
        _a.y += g.pos.y
        _a.z += g.pos.z
        oldest = Math.min(oldest, g.at)
        n++
      }
      if (n === 0) continue
      _a.divideScalar(n)
      // The oldest sighting in the wing rather than the newest, so the mark is only as
      // fresh as the least of what it is claiming.
      const age = 1 - (w.t - oldest) / GHOST_MEMORY
      if (age <= 0) continue
      // Age reaches the mark on a floor rather than on a straight ramp. Drawn straight,
      // a ghost went unreadable about ten seconds into a fourteen second memory, so the
      // interface dropped the contact while the fleet still held it. Dim until it expires
      // and then gone is the honest shape: the mark lasts exactly as long as the memory.
      const fade = 0.3 + age * 0.7

      // Spread needs a second pass, since the centre it is measured from comes out of the
      // first.
      let r = 0
      for (const id of sq.ships) {
        const g = w.seen.blue.has(id) ? undefined : w.ghosts.get(id)
        if (g) r = Math.max(r, Math.hypot(g.pos.x - _a.x, g.pos.y - _a.y, g.pos.z - _a.z))
      }
      // The tick is the mark and the ring is a reading off it, so the ring is only drawn
      // when the wing was remembered spread wider than the tick itself. Floored on screen
      // instead, it drew a hoop around a single remembered hull, which claims a spread
      // nobody ever saw, and two overlapping wings came out as one mark with a decoration.
      const sp = this.span(_a, 0.02)
      this.cross(_a, sp, GHOST, fade * 0.8)
      if (r > sp) this.circle(_a, r * 1.25, GHOST, fade * 0.55)
      _b.set(_a.x, 0, _a.z)
      this.dashed(_a, _b, GHOST, fade * 0.26, 26)
    }
  }

  /**
   * Where a squadron has been told to go, and where it is about to be told to go.
   * A pending order gets its own dimmer line, because the comm lag is a real
   * tactical cost and the player has to be able to see they have already spent it.
   */
  private orders(w: World, sq: Squadron): void {
    _a.set(sq.centroid.x, sq.centroid.y, sq.centroid.z)
    this.orderLine(w, sq, sq.order, _a, 1)
    if (sq.pending) this.orderLine(w, sq, sq.pending.order, _a, 0.4)
  }

  private orderLine(w: World, sq: Squadron, order: Squadron['order'], from: Vector3, mag: number): void {
    if (order.kind === 'attack') {
      const target = squadronById(w, order.sq)
      if (!target || aliveCount(w, target) === 0) return
      _b.set(target.centroid.x, target.centroid.y, target.centroid.z)
      this.dashed(from, _b, ATTACK, mag * 0.55, 40)
      this.cross(_b, formationRadius(target.cls, target.stance, aliveCount(w, target)) * 0.7, ATTACK, mag)
      return
    }
    const to = order.kind === 'hold' ? order.at : order.to
    _b.set(to.x, to.y, to.z)
    if (_b.distanceToSquared(from) < 16) return
    const color = order.kind === 'device' ? DEVICE : ORDER
    this.dashed(from, _b, color, mag * 0.5, 34)
    this.marker(_b, color, mag)
    if (order.kind === 'move') this.track(w, sq, to, mag)
  }

  /**
   * The run a move order will actually make, drawn only when it is not the run the
   * order describes.
   *
   * Thrust beats every well here by an order of magnitude, so across open volume the
   * forecast traces the dashed order line back over itself, and a second line under
   * the first is ink that says nothing. What is worth the ink is a lane with a world
   * in it: leaders steer wide of a surface whatever they were told, so the order goes
   * out straight and the run comes back a curve that lands late and off to one side.
   * Drawing that is the only way to see the cost before paying it, and the cost is
   * seconds spent in the open rather than hulls.
   *
   * The end of the run is left unmarked. It ends where the wing arrives, a hull's own
   * width short of the point the order was aimed at, so a mark there landed six pixels
   * off the cursor cross and drew a second cross over the first.
   */
  private track(w: World, sq: Squadron, to: { x: number; y: number; z: number }, mag: number): void {
    const t = predictTrack(w, sq, to, this.forecast)
    // A flat floor rather than the wing's own width. Scaling it by the formation put
    // the threshold above the detour on the case that costs most: a wide keel wing
    // bends 101 units around a planet and arrives nine seconds late, and a gate at
    // its own 106 unit width was silent for exactly that run. Open volume measures 4
    // at worst, so 25 clears the noise by six times and every rock case reads 100 up.
    if (t.detour < 25 || t.count < 2) return
    const p = t.path
    for (let i = 1; i < t.count; i++) {
      _t0.set(p[(i - 1) * 3], p[(i - 1) * 3 + 1], p[(i - 1) * 3 + 2])
      _t1.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
      // Brightest at the near end, where the squadron still has room to be turned.
      const f = mag * 0.6 * (1 - (i / t.count) * 0.5)
      this.line(_t0, _t1, ORDER, f, f)
    }
  }

  /**
   * The cursor, in the volume rather than on the screen. Without this a click is a
   * guess: the plane an order resolves against is invisible, so the only way to
   * make the convention learnable is to draw where the click would land.
   */
  private cursor(w: World, c: Controls): void {
    if (!c.aimValid || c.selected.size === 0 || c.mode === 'device') return
    const sq = c.primary()
    // Drawn where the order will land rather than where the pointer is: a click on
    // a world becomes a station off its skin, and the mark has to say so.
    _c.copy(c.aim)
    if (sq) liftClear(w, sq, _c)
    this.cross(_c, this.span(_c, 0.016), ORDER, c.altitude ? 1 : 0.55)
    _b.set(_c.x, 0, _c.z)
    this.dashed(_c, _b, ORDER, c.altitude ? 0.45 : 0.18, 26)
    // Forecast the run before the order is given, for the primary only. This is
    // the moment the player is choosing a lane, and it is worth more here than on
    // an order already spent; every selected squadron at once is just noise.
    if (sq) {
      _a.set(sq.centroid.x, sq.centroid.y, sq.centroid.z)
      this.dashed(_a, _c, ORDER, 0.22, 34)
      this.track(w, sq, _c, 0.85)
    }
  }

  /**
   * The device preview: the volume the first cascade node will eat, the walk it takes
   * from there, the reach of the carrier that would throw it, and a line between them.
   * This is the one weapon that can kill your own fleet, so what it is about to do is
   * shown before it fires rather than reported afterwards.
   */
  private device(c: Controls): void {
    const shot = c.shot
    const sq = c.primary()
    if (!shot || !sq) return
    _a.set(sq.centroid.x, sq.centroid.y, sq.centroid.z)
    this.circle(_a, DEVICE_RANGE, DEVICE, shot.ok ? 0.28 : 0.12, 96)
    this.dashed(_a, shot.at, shot.ok ? DEVICE : GHOST, 0.5, 30)
    _b.set(shot.at.x, 0, shot.at.z)
    this.dashed(shot.at, _b, shot.ok ? DEVICE : GHOST, 0.3, 26)
    if (!shot.ok) return
    // Three great circles read as a sphere where one ring reads as a disc, and the
    // difference is the whole point: the cascade is a volume, not a footprint.
    this.sphere(shot.at, DEVICE_RADIUS, DEVICE, 0.8)
    this.walk(shot.walk)
  }

  /**
   * The chain, hop by hop, brightest where it is surest.
   *
   * The panel had been saying the walk is 455 against a nearest hull 341 out for three
   * missions before this was drawn, and neither number meant anything in the volume: 455
   * is what the chain reaches through a crowd dense enough to carry it, and the crowd is
   * what the player is choosing. Drawing a 455 bubble would have been the easier version
   * and the wrong one, since most of that sphere is empty space the cascade cannot
   * cross. Drawing the hops instead makes the shot legible in one look: a knot of theirs
   * lights up as a thicket walking outward, and the gap between its last hop and your own
   * wings is the margin, visible rather than arithmetic.
   *
   * Each hop fades by the odds it is still going when it arrives, which is 0.86 a
   * generation compounded, so the bright core is what the burst does and the faint fringe
   * is what it might. A chain drawn at one brightness would promise the fringe.
   */
  private walk(hops: number[]): void {
    for (let i = 0; i < hops.length; i += 7) {
      const odds = hops[i + 6]
      if (odds < 0.06) continue
      _t0.set(hops[i], hops[i + 1], hops[i + 2])
      _t1.set(hops[i + 3], hops[i + 4], hops[i + 5])
      this.line(_t0, _t1, DEVICE, odds * 0.75, odds * 0.3)
    }
  }

  // -------------------------------------------------------------------------
  // Primitives

  /**
   * A radius that comes out roughly the same size on screen at any range. A mark
   * with a fixed radius in world units is a smear at knife range and invisible
   * across a theatre, and the cursor and the destination marks have to read at
   * both without the player thinking about it.
   */
  private span(at: Vector3, k: number): number {
    return (this.cam ? this.cam.position.distanceTo(at) : 600) * k
  }

  /** The one place overlay lines reach the renderer, so the gain applies to all. */
  private line(a: Vector3, b: Vector3, color: Color, head: number, tail: number): void {
    this.lines.add(a, b, color, head * GAIN, tail * GAIN)
  }

  /** Horizontal ring, aligned to the reference plane, dashed to halve the lines. */
  private circle(at: Vector3, r: number, color: Color, mag: number, n = 48): void {
    for (let i = 0; i < n; i += 2) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      _p.set(at.x + Math.cos(a0) * r, at.y, at.z + Math.sin(a0) * r)
      _q.set(at.x + Math.cos(a1) * r, at.y, at.z + Math.sin(a1) * r)
      this.line(_p, _q, color, mag, mag)
    }
  }

  private sphere(at: Vector3, r: number, color: Color, mag: number, n = 36): void {
    for (let axis = 0; axis < 3; axis++) {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2
        const a1 = ((i + 1) / n) * Math.PI * 2
        const u0 = Math.cos(a0) * r
        const v0 = Math.sin(a0) * r
        const u1 = Math.cos(a1) * r
        const v1 = Math.sin(a1) * r
        if (axis === 0) {
          _p.set(at.x + u0, at.y + v0, at.z)
          _q.set(at.x + u1, at.y + v1, at.z)
        } else if (axis === 1) {
          _p.set(at.x + u0, at.y, at.z + v0)
          _q.set(at.x + u1, at.y, at.z + v1)
        } else {
          _p.set(at.x, at.y + u0, at.z + v0)
          _q.set(at.x, at.y + u1, at.z + v1)
        }
        this.line(_p, _q, color, mag, mag)
      }
    }
  }

  /** Dashes from a to b with roughly `step` long marks, fading along their length. */
  private dashed(a: Vector3, b: Vector3, color: Color, mag: number, step: number): void {
    const total = a.distanceTo(b)
    if (total < 1e-3) return
    const marks = Math.min(64, Math.max(1, Math.round(total / step)))
    for (let i = 0; i < marks; i++) {
      const t0 = i / marks
      _p.lerpVectors(a, b, t0)
      _q.lerpVectors(a, b, t0 + 0.55 / marks)
      // The fade makes a line read as pointing away from the squadron rather than
      // as a rope tying two objects together.
      const f = mag * (1 - t0 * 0.45)
      this.line(_p, _q, color, f, f)
    }
  }

  /** A three axis tick: the smallest mark that reads as a point in a volume. */
  private cross(at: Vector3, r: number, color: Color, mag: number): void {
    for (let axis = 0; axis < 3; axis++) {
      _p.copy(at)
      _q.copy(at)
      if (axis === 0) {
        _p.x -= r
        _q.x += r
      } else if (axis === 1) {
        _p.y -= r
        _q.y += r
      } else {
        _p.z -= r
        _q.z += r
      }
      // Drawn from both ends so each arm is brightest at its tip and the centre
      // stays open, which keeps the mark from covering what it is marking.
      this.line(_p, _q, color, mag * 0.15, mag)
      this.line(_q, _p, color, mag * 0.15, mag)
    }
  }

  /** Destination marker: a small flat diamond with a vertical spine through it. */
  private marker(at: Vector3, color: Color, mag: number): void {
    const r = this.span(at, 0.011)
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2
      const a1 = ((i + 1) / 4) * Math.PI * 2
      _p.set(at.x + Math.cos(a0) * r, at.y, at.z + Math.sin(a0) * r)
      _q.set(at.x + Math.cos(a1) * r, at.y, at.z + Math.sin(a1) * r)
      this.line(_p, _q, color, mag, mag)
    }
    _p.set(at.x, at.y - r * 1.6, at.z)
    _q.set(at.x, at.y + r * 1.6, at.z)
    this.line(_p, _q, color, mag * 0.7, mag * 0.7)
  }
}
