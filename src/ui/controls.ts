import { PerspectiveCamera, Ray, Sphere, Vector3 } from 'three'
import {
  DEVICE_RADIUS,
  DEVICE_RANGE,
  deviceTarget,
  issueOrder,
  issueStance,
  objectiveReach,
  previewCascade,
} from '../sim/step'
import { cls } from '../sim/classes'
import { aliveCount, canStillKill, fleetStrength, shipById, squadronById, squadronsOf } from '../sim/world'
import { dist } from '../sim/vec3'
import type { Side, Squadron, World } from '../sim/types'
import { CameraRig, rayToPlane, screenRay } from '../render/camera'

const UP = new Vector3(0, 1, 0)
/** Screen-space radius, in pixels, within which a click counts as on your own squadron. */
const PICK_RADIUS = 44
/**
 * The same for an enemy, and deliberately tighter. Picking the wrong friendly wing
 * selects it, which the roster shows and a second click undoes; picking an enemy
 * turns the order button from "take station here" into "charge that", which at comm
 * delay cannot be taken back. Playing Overwhelm by hand cost a surviving fleet that
 * way: a red wing drifted within forty pixels of a planet's face and the click meant
 * to restation behind the rock sent seven hulls into thirteen.
 */
const HOSTILE_RADIUS = 18
/**
 * How far the hand may slide between press and release and still have meant a click,
 * in pixels of travel.
 *
 * The same button selects and orbits, so this is the line between the two, and it was
 * five: a hand that moved six pixels while pressing got a camera nudge instead of the
 * wing it was pointing at, and got no feedback either way. Selection is the first thing
 * a player does and it was failing perhaps one press in three. Twelve is about three
 * millimetres on a desk, which is inside the slip of a firm click and well under any
 * drag meant as a drag. Nothing is spent by guessing wrong in this direction: a twelve
 * pixel orbit that is read as a click costs a selection the next click restores.
 */
const CLICK_SLOP = 12
/**
 * Pan speed for the keys, as the drag in pixels a second they stand in for. Measured
 * against the frame rather than the volume, since that is what the hand is reading: 600
 * crosses the screen in about two seconds whatever the zoom, and the missions differ in
 * scale by a factor of four.
 */
const KEY_PAN = 600
const PAN_KEYS = new Set(['w', 'a', 's', 'd'])
/**
 * How the channel names a group of wings: by name when there is one, by count when
 * there are more.
 *
 * One click can carry the whole fleet, and on the last exam that spent ten of the nine
 * lines the channel holds saying one thing five times over, which pushed the contact
 * and the losses off the bottom. Which wing is which does not belong here anyway: the
 * roster carries a line per wing and marks the one that still owes an acknowledgement.
 */
const wingsNamed = (names: string[]): string => (names.length === 1 ? names[0] : `${names.length} wings`)

export type Mode = 'normal' | 'device'

/** A device release as the interface understands it, before it is committed. */
export interface Shot {
  /** Where the first cascade node would appear, which is not the raw cursor. */
  at: Vector3
  range: number
  ok: boolean
  cascade: { red: number; blue: number; reach: number }
  /**
   * The chain the count came from, seven numbers a hop: from, to, and the odds it is
   * still walking when it arrives. The overlay draws it so the two hundred units of
   * empty space between the burst and your nearest wing can be seen to be empty.
   */
  walk: number[]
  /**
   * Distance from the burst to the nearest hull of your own that is not in the wing
   * doing the firing, which is the number the decision actually turns on.
   *
   * The wing itself is excluded because including it made the measure constant and
   * therefore useless: a legal shot is inside release range by definition, so the
   * carrier was always nearer than 130 while the chain reaches hundreds, and the panel
   * printed the same warning for every shot in the game. That the courier is spent is
   * a property of the weapon rather than of this shot, and belongs in a briefing. What
   * varies, and what the player can still change by waiting or by moving somebody, is
   * how much of the rest of the fleet is standing in the walk.
   */
  standoff: number
  /**
   * True when the charge ends on a solid skin, which is the difference between a burst
   * that happens where the panel says and one that happens wherever the fuse trips.
   *
   * A charge released into open space arms against enemy hulls, so it goes off at the
   * first one it passes: that is what makes a shot at a moving knot land on the knot.
   * A charge that meets a world stops there instead and nothing can trip it early.
   */
  surface: boolean
  /** What this burst does to the world the mission is scored on, if there is one. */
  objective: { name: string; off: number } | null
}

export interface LogLine {
  text: string
  at: number
  /**
   * The tone is a colour, and `device` is named for what every line of it is about:
   * armed, out of reach, the charge already away, a courier lost with one aboard, a
   * world unmade. It used to be called `alert` and share the orange of a loss, which
   * is the one line in the channel that arrives in bursts. A courier dying with the
   * mission's only charge is then a line the same colour as the two hulls lost either
   * side of it, and it is the line that decides the mission.
   */
  tone: 'order' | 'ack' | 'loss' | 'device'
  /**
   * Monotonic, so a reader can tell what it has already drawn without counting.
   *
   * The log is a ring, and the HUD used to track its position by array index: append
   * everything past `logged`, then set `logged` to the length. Once the ring is full a
   * push and a shift cancel out, the length stops changing, and the comparison is true
   * of nothing forever. The channel went dead sixteen seconds into every battle, which
   * is the whole of the game's narration, and no balance sweep can see it because the
   * simulation was fine and only the reading of it had stopped.
   */
  seq: number
}

/**
 * Everything the player is currently doing, which is a surprisingly small amount
 * of state: who is selected, what is under the cursor, where the cursor lands in
 * the volume, and whether a device is armed.
 *
 * The interface deliberately never touches a hull. Ender never flies a ship; he
 * talks to squadron leaders, and they fly. So an order is addressed to a
 * squadron, it goes out over a channel that takes time, and what happens to the
 * individual hulls afterwards is the simulation's business rather than the
 * player's.
 */
export class Controls {
  readonly selected = new Set<number>()
  hover: number | null = null
  mode: Mode = 'normal'
  /** Where the cursor is in the volume, on the plane orders resolve against. */
  readonly aim = new Vector3()
  aimValid = false
  /** True while the cursor is being read as an altitude rather than a position. */
  altitude = false
  /** The wing the camera is holding centred, or null when the camera stands still. */
  following: number | null = null
  /** The armed shot, or null when no device is armed. Refreshed once a frame. */
  shot: Shot | null = null
  paused = false
  speed = 1
  readonly log: LogLine[] = []
  /** How many lines have ever been spoken, which is the next line's sequence number. */
  private said = 0

  private readonly ray = new Ray()
  private readonly plane = new Vector3()
  private readonly normal = new Vector3()
  private readonly proj = new Vector3()
  private readonly resolved = new Vector3()
  /** Refilled every frame the cursor is armed, since a fresh array a frame is garbage. */
  private readonly walk: number[] = []
  private readonly ball = new Sphere()
  /** Scratch for the surface hit. Separate from `resolved`, which escapes in `shot`. */
  private readonly surface = new Vector3()
  /** The nearest surface hit kept while deciding whether it beats a wing. */
  private readonly skin = new Vector3()
  private pointer = { x: 0, y: 0 }
  private bound: AbortController | null = null
  private down: { x: number; y: number; button: number } | null = null
  private dragged = false
  /** Keys being held, which is only ever the four the camera pans on. */
  private readonly held = new Set<string>()
  private losses = 0
  private lossFlush = 0
  private saidDisarmed = false

  constructor(
    private readonly world: World,
    private readonly camera: PerspectiveCamera,
    private readonly rig: CameraRig,
    private readonly side: Side = 'blue',
  ) {}

  /**
   * Bindings live for as long as the battle does. A briefing or an after action
   * report detaches them, which is what keeps a stray keypress on a report screen
   * from reaching a fleet that is no longer flying.
   */
  attach(canvas: HTMLCanvasElement): void {
    this.detach()
    this.bound = new AbortController()
    const signal = this.bound.signal
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal })
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), { signal })
    window.addEventListener('pointermove', (e) => this.onMove(e), { signal })
    window.addEventListener('pointerup', (e) => this.onUp(e), { signal })
    window.addEventListener('wheel', (e) => this.rig.zoom(Math.sign(e.deltaY)), { passive: true, signal })
    window.addEventListener('keydown', (e) => this.onKey(e), { signal })
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.altitude = false
      this.held.delete(e.key.toLowerCase())
    }, { signal })
    // A key held across a window switch never gets its keyup, and a camera that pans
    // forever after an alt-tab is a game that has to be reloaded to be played.
    window.addEventListener('blur', () => {
      this.down = null
      this.held.clear()
    }, { signal })
  }

  detach(): void {
    this.bound?.abort()
    this.bound = null
    this.down = null
    this.altitude = false
    this.held.clear()
  }

  /**
   * Every wing the player was given, in a fixed order, including ones that have been
   * wiped out.
   *
   * Dropping the dead from this list renumbered it under the player's fingers. Flying
   * the Last Exam by hand, HOPPER's sixteen needles were gone by eighteen seconds, so
   * the 2 that had meant the courier now meant the lance wing: the order that was to
   * send the charge in sent the artillery instead, and the charge sat at the start line
   * for the rest of the battle. In a game where an order takes a second and a quarter to
   * arrive, a key that quietly changes meaning is worse than a key that does nothing.
   *
   * A wiped wing stays listed and struck through, which is the better display anyway.
   * What you have lost is information.
   */
  roster(): Squadron[] {
    return this.world.squadrons.filter((sq) => sq.side === this.side)
  }

  /** The wings that still have hulls, for the gestures that mean "all of them". */
  live(): Squadron[] {
    return squadronsOf(this.world, this.side)
  }

  primary(): Squadron | null {
    for (const id of this.selected) {
      const sq = squadronById(this.world, id)
      if (sq && aliveCount(this.world, sq) > 0) return sq
    }
    return null
  }

  /**
   * Stop following, and say so when there was something to stop. The camera going quiet on
   * its own is exactly the case that needs a word: a followed wing that has just been wiped
   * leaves the view parked on the spot it died, which is the least useful place in the
   * volume to be looking and does not otherwise announce itself.
   */
  private letGo(): void {
    if (this.following === null) return
    this.following = null
    this.say('camera free', 'ack')
  }

  /**
   * Carry the camera across the volume while wasd is held.
   *
   * A key is the gesture this wants to be rather than a button drag: panning is what
   * you do continuously while reading a board, and a drag occupies the hand that also
   * selects and orders. Middle drag still pans, since it is the faster way to cross a
   * long distance once, but nothing needs it.
   */
  private slide(dt: number): void {
    let x = 0
    let y = 0
    if (this.held.has('d')) x += 1
    if (this.held.has('a')) x -= 1
    if (this.held.has('s')) y += 1
    if (this.held.has('w')) y -= 1
    if (x === 0 && y === 0) return
    this.letGo()
    // Normalised on the diagonal, so holding two keys is not half again as fast as one.
    const k = (x !== 0 && y !== 0 ? Math.SQRT1_2 : 1) * KEY_PAN * dt
    // A drag moves the picture and a key moves the camera, which are opposite things,
    // so the keys pass the drag that would have taken the camera the same way.
    this.drag(-x * k, -y * k)
  }

  /**
   * A gesture in pixels, applied to the camera as the world offset that carries the
   * picture exactly that far, so whatever was under the cursor stays under it. Pixels
   * are worth more world the further out the camera stands, and the conversion belongs
   * to the frustum rather than to taste: a hand tuned constant was 18 percent fast, and
   * a grab that slips is worse than one that is simply the wrong speed, since the error
   * accumulates for as long as the drag lasts.
   */
  private drag(dx: number, dy: number): void {
    const perPixel = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / window.innerHeight
    const scale = this.rig.dist * perPixel
    this.rig.pan(-dx * scale, dy * scale)
  }

  /**
   * Called once per frame, after the simulation. Drops dead squadrons out of the
   * selection, refreshes the aim point, and turns simulation events the player
   * would have been told about over the comm channel into log lines.
   *
   * The seconds are real ones rather than simulated ones, because the camera keeps
   * moving while the battle is held: looking around a paused board is most of what
   * the pause is for.
   */
  update(dt: number): void {
    this.slide(dt)
    for (const id of [...this.selected]) {
      const sq = squadronById(this.world, id)
      if (!sq || aliveCount(this.world, sq) === 0) this.selected.delete(id)
    }
    if (this.following !== null) {
      const sq = squadronById(this.world, this.following)
      // Every frame, not once when the key is pressed. A wing crosses the volume at up to
      // 58 a second, so a single recentring has it back out at the edge of the frame in
      // four, and the legend has always called this key follow. The camera eases toward
      // the centroid rather than snapping to it, which at that speed is half a unit of
      // lag and reads as a camera being carried along rather than welded on.
      if (sq && aliveCount(this.world, sq) > 0) this.rig.focus(sq.centroid)
      else this.letGo()
    }
    // Hover first: what the cursor is over decides where the cursor resolves to.
    this.hover = this.pick(this.pointer.x, this.pointer.y)?.id ?? null
    this.trace()
    this.shot = this.aimShot()
    this.drainEvents()
  }

  /**
   * The shot currently being lined up, resolved once a frame so the panel, the
   * overlay and the order that eventually goes out all describe the same one.
   */
  private aimShot(): Shot | null {
    const sq = this.primary()
    if (this.mode !== 'device' || !sq || !this.aimValid) return null
    // Not the raw cursor: a click lands on the plane through the carrier, which
    // for anything close to a planet is a point inside it. What matters is where
    // the cascade would start, which is the skin the bolt meets on the way.
    const { at, body } = deviceTarget(this.world, sq.centroid, this.aim)
    this.resolved.set(at.x, at.y, at.z)
    const range = dist(sq.centroid, at)
    let standoff = Infinity
    for (const s of this.world.ships) {
      if (!s.alive || s.side !== this.side || s.sq === sq.id) continue
      standoff = Math.min(standoff, dist(s.pos, at))
    }
    return {
      at: this.resolved,
      range,
      ok: range <= DEVICE_RANGE,
      cascade: previewCascade(this.world, at, this.walk),
      walk: this.walk,
      standoff,
      surface: body !== null,
      objective: objectiveReach(this.world, at),
    }
  }

  say(text: string, tone: LogLine['tone']): void {
    this.log.push({ text, at: this.world.t, tone, seq: this.said++ })
    if (this.log.length > 40) this.log.shift()
  }

  // -------------------------------------------------------------------------
  // Pointer

  private onDown(e: PointerEvent): void {
    this.down = { x: e.clientX, y: e.clientY, button: e.button }
    this.dragged = false
  }

  private onMove(e: PointerEvent): void {
    this.pointer.x = e.clientX
    this.pointer.y = e.clientY
    if (!this.down) return
    const far = Math.abs(e.clientX - this.down.x) + Math.abs(e.clientY - this.down.y) > CLICK_SLOP
    if (!far) return
    this.dragged = true
    // Left drags orbit and middle drags pan. A right drag does nothing on
    // purpose: the right button is the order button, and an order that fires on
    // release after the camera moved is an order nobody meant to give.
    if (this.down.button === 0) this.rig.orbit(e.movementX * 0.005, e.movementY * 0.005)
    else if (this.down.button === 1) {
      // A pan takes the camera somewhere, so it ends any follow. Both write the orbit
      // centre, and left together the follow would drag the view back the next frame and
      // the pan would read as broken. Orbit and zoom are safe: they leave the centre alone.
      this.letGo()
      this.drag(e.movementX, e.movementY)
    }
  }

  private onUp(e: PointerEvent): void {
    const down = this.down
    this.down = null
    if (!down || this.dragged) return
    if (down.button === 0) this.onClick(e.clientX, e.clientY, e.shiftKey)
    else if (down.button === 2) this.onOrder(e.clientX, e.clientY)
  }

  private onClick(x: number, y: number, add: boolean): void {
    if (this.mode === 'device') {
      this.releaseDevice()
      return
    }
    const hit = this.pick(x, y)
    if (!hit || hit.side !== this.side) {
      if (!add) this.selected.clear()
      return
    }
    if (!add) this.selected.clear()
    if (add && this.selected.has(hit.id)) this.selected.delete(hit.id)
    else this.selected.add(hit.id)
  }

  /** The order button: attack what is under the cursor, or move to where it is. */
  private onOrder(x: number, y: number): void {
    if (this.mode === 'device') {
      this.disarm()
      return
    }
    if (this.selected.size === 0) return
    const hit = this.pick(x, y)
    if (hit && hit.side !== this.side) {
      // Same order either way: close on that wing and hold station off it. But a scout
      // carries no gun, so "engage" would be the comm line promising a fight the wing has
      // no way to start. A mixed selection gets a line for each verb rather than one line
      // that is half wrong.
      const fight: string[] = []
      const watch: string[] = []
      for (const sq of this.selection()) {
        issueOrder(this.world, sq, { kind: 'attack', sq: hit.id })
        ;(cls(sq.cls).weapon ? fight : watch).push(sq.name)
      }
      if (fight.length > 0) this.say(`${wingsNamed(fight)} engage ${hit.name}`, 'order')
      if (watch.length > 0) this.say(`${wingsNamed(watch)} shadow ${hit.name}`, 'order')
      return
    }
    // The pointer may have moved a pixel since the last frame, so the order traces
    // against this click's pick rather than against the one the overlay drew.
    this.hover = hit?.id ?? null
    this.trace()
    if (!this.aimValid) return
    const moved: string[] = []
    for (const sq of this.selection()) {
      issueOrder(this.world, sq, { kind: 'move', to: { x: this.aim.x, y: this.aim.y, z: this.aim.z } })
      moved.push(sq.name)
    }
    if (moved.length > 0) this.say(`${wingsNamed(moved)} move`, 'order')
  }

  // -------------------------------------------------------------------------
  // Keys

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return
    // Lower cased, because shift is a modifier here and not a different key: it means
    // altitude, so every letter binding has to survive being pressed while it is down.
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

    if (PAN_KEYS.has(key)) {
      this.held.add(key)
      return
    }

    if (key >= '1' && key <= '9') {
      // Against the full roster, so the number over a wing never changes. Pressing the
      // number of a wing that has been wiped out selects nothing: `primary` skips it and
      // `update` drops it next frame, which is the right answer to asking for the dead.
      const sq = this.roster()[Number(key) - 1]
      if (!sq) return
      if (!e.shiftKey) this.selected.clear()
      this.selected.add(sq.id)
      return
    }

    switch (key) {
      case 'Shift':
        this.altitude = true
        return
      case 'Escape':
        if (this.mode === 'device') this.disarm()
        else this.selected.clear()
        return
      case 'Tab': {
        e.preventDefault()
        // Cycling steps over the dead. A tab that stops on a wiped wing would need to be
        // pressed twice to get anywhere, which is the one thing cycling is for.
        const live = this.live()
        const cur = this.primary()
        const i = cur ? live.findIndex((s) => s.id === cur.id) : -1
        const next = live[(i + 1) % Math.max(1, live.length)]
        this.selected.clear()
        if (next) this.selected.add(next.id)
        return
      }
      // Every wing at once, and the device, both moved off a and d when those became
      // half of the pan. They are the two bindings a player uses without looking, so
      // they sit either side of the pan block rather than somewhere mnemonic.
      case 'q':
        for (const sq of this.live()) this.selected.add(sq.id)
        return
      case 'z':
      case 'x':
      case 'c': {
        const stance = key === 'z' ? 'tight' : key === 'x' ? 'open' : 'wide'
        for (const sq of this.selection()) {
          if (issueStance(this.world, sq, stance)) this.say(`${sq.name} ${stance}`, 'order')
        }
        return
      }
      case 'h':
        for (const sq of this.selection()) {
          issueOrder(this.world, sq, { kind: 'hold', at: { ...sq.centroid } })
          this.say(`${sq.name} hold`, 'order')
        }
        return
      case 'e':
        this.arm()
        return
      case 'f': {
        const sq = this.primary()
        // On the wing already being followed the key lets go; on any other wing it hands
        // the camera over rather than letting go, because a player who selects somebody
        // else and presses follow means follow them.
        if (!sq || this.following === sq.id) {
          this.letGo()
          return
        }
        this.following = sq.id
        this.rig.focus(sq.centroid)
        this.say(`following ${sq.name}`, 'ack')
        return
      }
      case 'g':
        this.gateDown()
        return
      case 'l':
        this.rig.levelUp()
        this.say('level', 'ack')
        return
      case ' ':
        e.preventDefault()
        this.paused = !this.paused
        return
      case '[':
        this.speed = this.speed <= 0.5 ? 0.5 : this.speed / 2
        return
      case ']':
        this.speed = this.speed >= 4 ? 4 : this.speed * 2
        return
    }
  }

  /**
   * The enemy's gate is down. Hangs the whole theatre off the axis to the enemy
   * so that attacking is falling, which is the one piece of tactical advice the
   * novel actually gives and is worth being a real camera operation.
   */
  private gateDown(): void {
    const mine = this.fleetCentre(this.side)
    const theirs = this.fleetCentre(this.side === 'blue' ? 'red' : 'blue', true)
    if (!mine || !theirs) return
    const down = theirs.sub(mine)
    if (down.lengthSq() < 1) return
    this.rig.setUpAxis(down.multiplyScalar(-1))
    this.say("the enemy's gate is down", 'ack')
  }

  private fleetCentre(side: Side, seenOnly = false): Vector3 | null {
    const out = new Vector3()
    let n = 0
    for (const s of this.world.ships) {
      if (!s.alive || s.side !== side) continue
      if (seenOnly && !this.world.seen[this.side].has(s.id)) continue
      out.x += s.pos.x
      out.y += s.pos.y
      out.z += s.pos.z
      n++
    }
    return n > 0 ? out.multiplyScalar(1 / n) : null
  }

  // -------------------------------------------------------------------------
  // Device

  private arm(): void {
    const sq = this.primary()
    if (!sq) return
    // Already armed: the panel is up and saying so again fills the channel with the
    // same line while the player holds the key deciding whether to take the shot.
    if (this.mode === 'device') return
    if (sq.device <= 0) {
      this.say(`${sq.name} carries no charge`, 'device')
      return
    }
    if (sq.deviceLock > 0) {
      this.say(`${sq.name} charge already away`, 'device')
      return
    }
    this.mode = 'device'
    this.say(`${sq.name} armed`, 'device')
  }

  private disarm(): void {
    this.mode = 'normal'
  }

  private releaseDevice(): void {
    const sq = this.primary()
    const shot = this.shot
    if (!sq || !shot) return
    if (!shot.ok) {
      this.say(`out of reach by ${Math.round(shot.range - DEVICE_RANGE)}`, 'device')
      return
    }
    // The order carries what the cursor was on, not the burst point the panel drew from
    // it. `fireDevice` resolves the burst once, from the same function on the same aim,
    // so the two agree by construction. Sending the resolved point instead made the
    // release a coin flip: a point sitting exactly on a planet's skin is the one input
    // `deviceTarget` cannot answer reliably, and half the time the second pass could no
    // longer see the planet under it. The charge then lost its surface exemption and
    // burst on the first garrison hull it passed, seventy units short of the rock the
    // panel had promised. Two resolutions of the same shot is one too many.
    issueOrder(this.world, sq, { kind: 'device', to: { x: this.aim.x, y: this.aim.y, z: this.aim.z } })
    this.say(`${sq.name} release`, 'order')
    this.mode = 'normal'
  }

  // -------------------------------------------------------------------------
  // Geometry

  private selection(): Squadron[] {
    const out: Squadron[] = []
    for (const id of this.selected) {
      const sq = squadronById(this.world, id)
      if (sq && aliveCount(this.world, sq) > 0) out.push(sq)
    }
    return out
  }

  /**
   * Resolves the cursor into a point in the volume.
   *
   * Anything under the cursor is a place: a squadron first, then a world. Failing
   * both, a click means a point at the height of whatever is selected, because in a
   * volume with no floor that is the only reading that is ever unambiguous. Holding
   * shift instead reads the cursor against a plane facing the camera, which turns
   * vertical mouse movement into altitude: the same two gestures every 3D fleet game
   * has converged on, for the same reason.
   *
   * The plane reading alone cannot express "go and stand with them", because it
   * answers at the height of the wing being ordered: pointing at a screen forty
   * units lower landed the order forty units above it, so the field the player was
   * aiming into covered nothing. The same forty units is most of a device radius.
   *
   * Worlds are in the rule for the same reason and at a larger scale. Overwhelm is
   * held by keeping a planet between the fleet and a mass three times its size, and
   * on a plane read the click for that landed eight hundred units out, five hundred
   * of it vertical, because the cover is far below the fleet. Pointing at the face of
   * the rock you want to hide behind says it in one gesture, and it says it in the
   * frame the player is already looking at: the visible face is the covered one.
   */
  private trace(): void {
    this.traceAim()
    /*
     * A move order stops at the wall, because past it the order means something the player
     * has no way to know they said. A destination outside the theatre is how the simulation
     * hears "withdraw", and it is how a commander with nothing left that shoots gets its
     * survivors out: hulls that cross the boundary under that order are gone, with no wreck
     * and no line on the tally. It is the AI's decision and it costs a player only hulls,
     * so a click past the edge is read as a click at the edge instead of a wing walked off
     * the board. Overwhelm is where this bites, since the fleet that wins it is pressed
     * against the wall from T+20 and every order it gives after that points outward.
     *
     * Clamped here rather than at the order, so the drawn cross and the forecast run land
     * where the wing will actually go.
     */
    if (this.mode === 'device' || !this.aimValid) return
    // Two units inside the wall rather than exactly on it. The test for a withdrawal is a
    // strict comparison against the boundary, and a point scaled to land exactly on it lands a
    // hair outside about half the time: clamped to the boundary itself, the fleet giving ground
    // on Overwhelm flew to the wall and went straight through the door, fourteen hulls gone
    // between T+13 and T+19 with no wreck, no tally line and nothing of red's touched.
    const keep = this.world.bounds - 2
    const r = Math.hypot(this.aim.x, this.aim.y, this.aim.z)
    if (r > keep) this.aim.multiplyScalar(keep / r)
  }

  /** The cursor read against the plane, then snapped to a hull or a skin under it. */
  private traceAim(): void {
    const anchor = this.primary()?.centroid ?? { x: 0, y: 0, z: 0 }
    this.plane.set(anchor.x, anchor.y, anchor.z)
    if (this.altitude) {
      this.camera.getWorldDirection(this.normal)
      // Flatten the camera's look direction so the plane stays vertical; a tilted
      // plane would slide the point sideways as you change altitude.
      this.normal.y = 0
      if (this.normal.lengthSq() < 1e-4) this.normal.set(0, 0, 1)
      this.normal.normalize()
    } else {
      this.normal.copy(UP)
    }
    screenRay(this.camera, this.pointer.x, this.pointer.y, this.ray)
    this.aimValid = rayToPlane(this.ray, this.plane, this.normal, this.aim) !== null

    // Shift is left out of this: holding it means the height is the whole point of
    // the gesture, and snapping to a hull would throw away the only control the
    // player has over depth. `pick` never returns a contact nobody has seen, so
    // this hands over no position the volume was not already showing.
    if (this.altitude) return
    const on = this.hover !== null ? squadronById(this.world, this.hover) : null
    // A charge never snaps to your own wings. Flying the Last Exam by hand, the courier
    // was pointed at a homeworld twelve hundred units away and its own formation drifted
    // across the cursor, so the aim jumped back onto itself: the panel read range 0, in
    // reach, and the click put a cascade in the middle of the wing holding it. Aiming at
    // an enemy knot is the whole point of snapping and stays. Aiming at your own is never
    // a thing anybody means, and pointing at the empty space beside them still says it.
    const ownWing = this.mode === 'device' && on?.side === this.side
    /*
     * A wing never snaps the cursor onto itself either, which is the same fault at
     * closer range: the gesture for nudging a wing is to point just off it, so its own
     * hulls are inside the pick radius, and the aim jumped to the centroid it is already
     * standing on. The cross then sat up to fifty pixels from the pointer and the order
     * it described was to stay put, which reads as a cursor that does not track and an
     * order button that does nothing.
     *
     * Pointing at another of your own wings still means go and stand with them, and that
     * is worth the snap: it is one gesture for a thing that is otherwise two clicks and
     * a guess at where they will be.
     */
    const self = !!on && this.selected.has(on.id)
    const wing = on && !ownWing && !self && aliveCount(this.world, on) > 0 ? on : null

    // Nearest solid surface along the ray. The point sits on the skin, and the same
    // lift the simulation applies to any destination inside a body carries it out to
    // a standoff; the overlay draws the lifted point, so the two agree.
    let near = Infinity
    let onSkin = false
    for (const b of this.world.bodies) {
      if (b.integrity <= 0) continue
      if (b.kind !== 'planet' && b.kind !== 'moon') continue
      this.ball.center.set(b.pos.x, b.pos.y, b.pos.z)
      this.ball.radius = b.radius
      if (!this.ray.intersectSphere(this.ball, this.surface)) continue
      const d = this.ray.origin.distanceToSquared(this.surface)
      if (d < near) {
        near = d
        this.skin.copy(this.surface)
        onSkin = true
      }
    }

    // A wing under the cursor is normally the thing meant, and a hull is two pixels
    // wide, so picking has to be generous in screen space. A charge aimed past a wing at
    // the rock behind it is the exception, and the weapon decides it rather than the
    // mission: a charge that stops on a skin still eats everything within a device radius
    // of the burst, so when the wing is that close the surface aim is the wing shot plus
    // the planet and the wing aim buys nothing.
    //
    // Which matters because the aim is live and the release is one click. A garrison
    // hangs a few tens of units off its homeworld, and flying the exam by hand, three
    // runs in six read "catches Hive" and then put the burst forty seven out: between
    // reading the panel and clicking, a defending wing had drifted across a cursor that
    // never moved. There is no second charge and no way to see it coming.
    //
    // A knot silhouetted against a moon from further out than the field is wide is a
    // different shot, and it stays the wing's: preferring the rock there would throw the
    // crowd away and burst the charge on a surface hundreds of units behind them.
    const swallowed =
      this.mode === 'device' &&
      wing !== null &&
      this.skin.distanceTo(this.surface.set(wing.centroid.x, wing.centroid.y, wing.centroid.z)) <= DEVICE_RADIUS
    if (onSkin && (swallowed || !wing)) {
      this.aim.copy(this.skin)
      this.aimValid = true
      return
    }
    if (wing) {
      this.aim.set(wing.centroid.x, wing.centroid.y, wing.centroid.z)
      this.aimValid = true
    }
  }

  /**
   * Screen-space picking against hulls and squadron centroids rather than a
   * raycast against geometry. A needle is two pixels wide at command range, so
   * hit testing the shapes would make selection a game of its own.
   */
  private pick(x: number, y: number): Squadron | null {
    let best: Squadron | null = null
    // Compared as a fraction of each side's own radius, so a friendly wing forty
    // pixels out still loses to an enemy ten pixels out, and neither reach grows
    // by being measured against the other.
    let bestD = 1
    for (const sq of this.world.squadrons) {
      if (aliveCount(this.world, sq) === 0) continue
      const mine = sq.side === this.side
      const reach = mine ? PICK_RADIUS : HOSTILE_RADIUS
      for (const id of sq.ships) {
        const s = shipById(this.world, id)
        if (!s?.alive) continue
        if (!mine && !this.world.seen[this.side].has(s.id)) continue
        this.proj.set(s.pos.x, s.pos.y, s.pos.z).project(this.camera)
        if (this.proj.z > 1) continue
        const sx = ((this.proj.x + 1) / 2) * window.innerWidth
        const sy = ((1 - this.proj.y) / 2) * window.innerHeight
        const d = ((sx - x) * (sx - x) + (sy - y) * (sy - y)) / (reach * reach)
        if (d < bestD) {
          bestD = d
          best = sq
        }
      }
    }
    return best
  }

  // -------------------------------------------------------------------------
  // Comm log

  /**
   * Losses are counted and flushed on a timer instead of being logged one by
   * one. A squadron under fire generates a kill event every few frames, and a log
   * that scrolls faster than it can be read is the same as no log at all.
   */
  private drainEvents(): void {
    const acks: string[] = []
    for (const e of this.world.events) {
      if (e.kind === 'kill' && e.side === this.side) this.losses++
      // The simulation names the world; the phrasing belongs here. Passing the name
      // through bare put the single most important line of the campaign into the channel
      // as the word "Hive" on its own.
      else if (e.kind === 'unmade') this.say(`${e.text ?? 'the target'} is unmade`, 'device')
      else if (e.kind === 'order' && e.side === this.side) {
        const sq = e.sq !== undefined ? squadronById(this.world, e.sq) : undefined
        // A bare order event is an acknowledgement. The only thing the simulation
        // attaches text to is an order it did not carry out, and a refusal that scrolls
        // past in the same grey as an ack is the same as no answer at all.
        if (sq && e.text) this.say(`${sq.name}: ${e.text}`, 'device')
        else if (sq) acks.push(sq.name)
      }
    }
    // Collapsed the way losses are, since a fleet order comes back as one answer per wing
    // in the same tick and they all say the same thing.
    if (acks.length > 0) {
      this.say(`${wingsNamed(acks)} acknowledge${acks.length > 1 ? '' : 's'}`, 'ack')
    }
    if (this.losses > 0 && this.world.t - this.lossFlush > 1.5) {
      this.say(`${this.losses} hull${this.losses > 1 ? 's' : ''} lost`, 'loss')
      this.losses = 0
      this.lossFlush = this.world.t
    }
    // Losing the last gun while scouts are still flying does not end the mission, and it is
    // not something the roster shows: every wing still reads as present and under orders.
    // Without this line the commander goes on giving attack orders that can no longer take a
    // hull off the board. The battle is still open, since debris kills and a scout can lead
    // something into it, so this reports the position rather than calling the mission.
    if (!this.saidDisarmed && fleetStrength(this.world, this.side) > 0 && !canStillKill(this.world, this.side)) {
      this.saidDisarmed = true
      this.say('nothing left that shoots', 'loss')
    }
  }
}
