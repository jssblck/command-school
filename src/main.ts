import { Vector3 } from 'three'
import { makeCommander, think, type Commander } from './sim/ai'
import { scenarioById, SCENARIOS, type Scenario } from './sim/scenarios'
import { DT, emptyTrack, predictTrack, step } from './sim/step'
import type { Squadron, World } from './sim/types'
import { Terrain } from './render/bodies'
import { CameraRig } from './render/camera'
import { Fleet } from './render/fleet'
import { Fx } from './render/fx'
import { Overlay } from './render/overlay'
import { Stage } from './render/scene'
import { Controls } from './ui/controls'
import { briefingScreen, Hud, reportScreen } from './ui/hud'

const stage = new Stage(document.querySelector<HTMLCanvasElement>('#view')!)
const rig = new CameraRig()
const ui = document.querySelector<HTMLElement>('#ui')!

const params = new URLSearchParams(location.search)
const seed = Number(params.get('seed') ?? 2000)
/** Set by the screenshot harness: no briefing, no fog, and blue flies itself. */
const auto = params.get('auto') === '1'
/**
 * Start the battle held, which is what the interface harnesses want. They drive the clock
 * through `advance`, and the loop also steps it off real frames, so anything they do costs
 * simulated time in whatever amount their own frame rate happens to spend: the same plan was
 * a different battle every run. Holding it with the space key instead leaves a round trip in
 * which the battle has already started, and under `auto` there is no briefing to stop at.
 */
const hold = params.get('hold') === '1'

const PROGRESS = 'commandschool.unlocked'
const unlocked = (): number => Math.min(SCENARIOS.length, Number(localStorage.getItem(PROGRESS) ?? 1))

/**
 * One battle, from the briefing to the report. Everything except the canvas and
 * the camera is rebuilt per mission, because a world is a value: throwing one away
 * is cheaper and far less error prone than resetting one.
 */
interface Session {
  scenario: Scenario
  index: number
  world: World
  enemy: Commander
  /** Blue's autopilot, consulted only for the screenshot harness. */
  auto: Commander
  terrain: Terrain
  fleet: Fleet
  fx: Fx
  overlay: Overlay
  controls: Controls
  hud: Hud
  /** Seconds since the outcome was decided, so the last shots get to land. */
  settle: number
  live: boolean
}

let session: Session | null = null
let carry = 0

function enter(index: number): void {
  if (session) {
    session.controls.detach()
    const s = session
    stage.scene.remove(s.terrain.group, s.fleet.group, s.fx.group, s.overlay.group)
  }
  ui.replaceChildren()

  const scenario = SCENARIOS[index]
  const { world, enemy } = scenario.build(seed)
  const controls = new Controls(world, stage.camera, rig)
  const s: Session = {
    scenario,
    index,
    world,
    enemy,
    auto: makeCommander('blue', { aggression: 0.85, skill: 0.6 }),
    terrain: new Terrain(world),
    fleet: new Fleet(),
    fx: new Fx(),
    overlay: new Overlay(),
    controls,
    hud: new Hud(ui, world, controls, scenario),
    settle: 0,
    live: false,
  }
  s.fleet.fog = !auto
  stage.scene.add(s.terrain.group, s.fleet.group, s.fx.group, s.overlay.group)
  session = s
  carry = 0

  frameFleets(world)
  draw(s, 0, 0)

  // The volume is built and drawn behind the briefing, held at T+0. Reading the
  // orders over the actual deployment is worth more than reading them over black.
  if (auto) launch()
  else ui.append(briefingScreen(scenario, index, SCENARIOS, unlocked(), { start: launch, pick: enter }))
}

function launch(): void {
  const s = session
  if (!s) return
  ui.querySelectorAll('.screen').forEach((node) => node.remove())
  s.live = true
  s.controls.attach(stage.renderer.domElement)
  s.controls.paused = hold
  s.controls.say(s.world.objective.text.toLowerCase(), 'ack')
}

/**
 * Opening camera: behind our own fleet, looking down the axis the enemy is on. A
 * battle that opens on an arbitrary angle costs the player their first ten seconds
 * working out which lights are theirs.
 */
function frameFleets(w: World): void {
  const mine = new Vector3()
  const theirs = new Vector3()
  let m = 0
  let t = 0
  for (const ship of w.ships) {
    const into = ship.side === 'blue' ? mine : theirs
    into.x += ship.pos.x
    into.y += ship.pos.y
    into.z += ship.pos.z
    if (ship.side === 'blue') m++
    else t++
  }
  if (m > 0) mine.multiplyScalar(1 / m)
  if (t > 0) theirs.multiplyScalar(1 / t)

  // Framed on our own fleet rather than on the midpoint between the fleets. The
  // midpoint is empty space at T+0: it puts both fleets at the edges of the frame
  // and makes the first thing the player sees a pair of specks.
  const axis = theirs.clone().sub(mine)
  const span = Math.max(200, axis.length())
  rig.levelUp()
  // A short lead down the axis rather than the midpoint: it puts our fleet in the
  // lower third with the volume it has to cross opening out ahead of it, and it
  // keeps the hulls large enough to count, which is the first thing a commander
  // wants to do. The enemy is usually beyond sensors at T+0 anyway, so framing to
  // include them buys a smaller picture of nothing.
  rig.target.copy(mine).addScaledVector(axis, 0.14)
  rig.dist = span * 0.58
  rig.pitch = 0.3
  // Yaw until the camera sits behind us. The rig's horizontal basis is (z, x) when
  // up is world up, hence the argument order.
  const back = axis.negate().setY(0)
  rig.yaw = back.lengthSq() > 1 ? Math.atan2(back.x, back.z) : Math.PI
}

function centroid(ships: { pos: { x: number; y: number; z: number } }[]): Vector3 {
  const at = new Vector3()
  for (const s of ships) {
    at.x += s.pos.x
    at.y += s.pos.y
    at.z += s.pos.z
  }
  return ships.length > 0 ? at.divideScalar(ships.length) : at
}

/**
 * The renderer and console, which read simulation state and never change it. Two
 * clocks: the interface runs on real seconds, since the camera keeps moving while
 * the battle is held, and everything the simulation owns runs on its own.
 */
function draw(s: Session, real: number, sim: number): void {
  s.terrain.update(stage.camera)
  s.fleet.update(s.world)
  s.controls.update(real)
  s.fx.update(s.world, sim)
  s.world.events.length = 0
  s.overlay.update(s.world, s.controls, stage.camera)
  s.hud.update()
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  const s = session

  // Before anything reads the camera. The rig eases, so a cursor resolved against the
  // camera as it was and then drawn after it moved sat thirteen pixels behind the pointer
  // for as long as the hand kept orbiting, which is a reticle that does not track.
  rig.apply(stage.camera, dt)

  if (s) {
    const running = s.world.outcome === 'running' && s.live && !s.controls.paused
    if (running) {
      carry += dt * s.controls.speed
      // The step cap keeps a stalled tab from being rewarded with a burst of
      // simulation nobody watched.
      let steps = 0
      while (carry >= DT && steps++ < 10) {
        carry -= DT
        think(s.world, s.enemy, DT)
        if (auto) think(s.world, s.auto, DT)
        step(s.world)
      }
    } else {
      carry = 0
    }
    draw(s, dt, running ? dt : 0)

    if (s.world.outcome !== 'running' && s.live) {
      s.settle += dt
      if (s.settle > 2.2) finish(s)
    }
  }

  stage.render()
  requestAnimationFrame(frame)
}

function finish(s: Session): void {
  s.live = false
  s.controls.detach()
  if (s.world.outcome === 'won') {
    localStorage.setItem(PROGRESS, String(Math.max(unlocked(), Math.min(SCENARIOS.length, s.index + 2))))
  }
  const next = SCENARIOS[s.index + 1] ?? null
  ui.append(
    reportScreen(s.world, s.scenario, s.world.outcome === 'won' ? next : null, {
      again: () => enter(s.index),
      next: () => enter(s.index + 1),
    }),
  )
}

window.addEventListener('resize', () => stage.resize())

/**
 * A handle for tools/shoot.ts, which drives the real game loop from outside the
 * browser so that a screenshot is of a specific second of a specific seed rather
 * than of whenever the harness happened to look. Playtesting a real time game by
 * hand does not scale; playtesting it by fixture does.
 */
Object.assign(window, {
  cs: {
    get world() {
      return session!.world
    },
    get scenario() {
      return session!.scenario
    },
    /**
     * Exposed so the interface harness can read what a pointer position actually
     * resolved to. A screen point is only meaningful against the plane orders are
     * traced on, and a harness that cannot check that lands its clicks somewhere
     * along the ray and photographs the wrong thing.
     */
    get controls() {
      return session!.controls
    },
    /**
     * Blue's autopilot, so a harness under `auto` can reserve the one wing it wants to
     * fly by hand. Testing whether a release can be made through the real panel means
     * flying the courier with real clicks while somebody competent fights the rest of
     * the battle, and without this the autopilot and the harness take turns overwriting
     * each other's orders to the same wing.
     */
    get pilot() {
      return session!.auto
    },
    rig,
    /**
     * Fast forward through the real loop. Blue's autopilot only runs under `auto`,
     * so the interface harness can advance a battle without having the orders it
     * just issued overwritten by a commander it did not ask for.
     *
     * The rig is applied per step like the loop does it, so a camera that is following a
     * wing arrives where a player would have seen it. Without this a fast forward stepped
     * the simulation with the camera frozen, and a shot taken after one showed the volume
     * from wherever the camera had been left rather than from where the battle went.
     */
    advance(seconds: number) {
      const s = session!
      // Ceiling rather than nearest, because answering a request for time with no time at all
      // is a stall. The clock accumulates float error, so a harness that has run to 2.0 is
      // really at 1.9999999999999978 and asks for the remaining sliver; rounded to nearest that
      // is no steps, the clock never reaches the mark, and the run hangs there until something
      // else moves it. Overshooting by one step costs nothing.
      for (let i = 0; i < Math.ceil(seconds / DT); i++) {
        // Camera first, then the step, then the drawing, which is the order the real loop
        // runs in: a harness that resolved its clicks against a camera one step out of date
        // would be measuring an interface the player never uses.
        rig.apply(stage.camera, DT)
        if (s.world.outcome === 'running') {
          think(s.world, s.enemy, DT)
          if (auto) think(s.world, s.auto, DT)
          step(s.world)
        }
        draw(s, DT, DT)
      }
    },
    /**
     * The run a move order would make, which the overlay draws as a second line when it
     * departs from the order. Exposed because the departure is the only thing warning a
     * player that a world is in the lane, and a shot cannot tell a bend that is really
     * there from one the camera has foreshortened away.
     */
    forecast(sq: Squadron, to: { x: number; y: number; z: number }) {
      return predictTrack(session!.world, sq, { x: to.x, y: to.y, z: to.z }, emptyTrack())
    },
    /** World point to screen pixels, so the interface harness can click on things. */
    project(p: { x: number; y: number; z: number }) {
      // The inverse world matrix is only refreshed by a render, so projecting right
      // after a `look` would answer for the camera as it was the previous frame and
      // hand back a pixel that unprojects to somewhere else entirely.
      stage.camera.updateMatrixWorld()
      const v = new Vector3(p.x, p.y, p.z).project(stage.camera)
      if (v.z > 1) return null
      return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight }
    },
    look(opts: { yaw?: number; pitch?: number; dist?: number; at?: Vector3 }) {
      if (opts.yaw !== undefined) rig.yaw = opts.yaw
      if (opts.pitch !== undefined) rig.pitch = opts.pitch
      if (opts.dist !== undefined) rig.dist = opts.dist
      if (opts.at) rig.target.copy(opts.at)
      rig.apply(stage.camera, 10)
    },
    /**
     * Frame every live hull, keeping the current yaw and pitch. A deployment shot
     * cannot be composed as a fraction of `bounds`, because the missions do not
     * share a scale: the same fraction that holds a skirmish in view sits two
     * thousand units off the last exam and renders the fleet as three dots.
     */
    frame(margin = 1.15) {
      const live = session!.world.ships.filter((s) => s.alive)
      if (live.length === 0) return
      const at = centroid(live)
      const p = new Vector3()
      let r = 0
      for (const s of live) r = Math.max(r, at.distanceTo(p.set(s.pos.x, s.pos.y, s.pos.z)))
      rig.target.copy(at)
      // Vertical field of view, which is the tighter of the two at any sane aspect.
      rig.dist = (r * margin) / Math.tan((stage.camera.fov * Math.PI) / 360)
      rig.apply(stage.camera, 10)
    },
    /**
     * The midpoint of the closest pair of enemies, which is where the fight is.
     * A fleet's centroid is the wrong thing to aim a close shot at: a split fleet
     * averages out to empty space between its halves.
     */
    contact() {
      const w = session!.world
      const blues = w.ships.filter((s) => s.alive && s.side === 'blue')
      const reds = w.ships.filter((s) => s.alive && s.side === 'red')
      let best = Infinity
      const at = new Vector3()
      for (const b of blues) {
        for (const r of reds) {
          const d = (b.pos.x - r.pos.x) ** 2 + (b.pos.y - r.pos.y) ** 2 + (b.pos.z - r.pos.z) ** 2
          if (d >= best) continue
          best = d
          at.set((b.pos.x + r.pos.x) / 2, (b.pos.y + r.pos.y) / 2, (b.pos.z + r.pos.z) / 2)
        }
      }
      // A battle that ended early has no contact left to frame, and the origin is
      // the wrong fallback: on most missions it is inside a planet, so the shot
      // comes back as a screen of wireframe with the fleet nowhere in it.
      return best === Infinity ? centroid([...blues, ...reds]) : at
    },
  },
})

let last = performance.now()
const requested = scenarioById(params.get('m') ?? '')
enter(requested ? SCENARIOS.indexOf(requested) : unlocked() - 1)
requestAnimationFrame(frame)
