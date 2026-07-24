import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Points,
  ShaderMaterial,
} from 'three'
import { cls } from '../sim/classes'
import type { SimEvent, World } from '../sim/types'
import { len, normalize, type Vec3 } from '../sim/vec3'
import { DEVICE, DEVICE_HOT, SIDE_CORE } from './palette'
import { uPointScale } from './shared'
import { baryGeometry, Instances, wireMaterial } from './wire'

/**
 * A refillable pool of additive line segments with a bright head and a dark
 * tail. Engine wash and weapon tracers are the same object at different lengths,
 * which is deliberate: in a volume this abstract, a moving thing and a shot are
 * both just a smear of light, and the difference has to come from colour.
 */
export class Streaks {
  readonly lines: LineSegments
  private readonly pos: BufferAttribute
  private readonly col: BufferAttribute
  private n = 0

  constructor(readonly capacity: number) {
    const geo = new BufferGeometry()
    this.pos = new BufferAttribute(new Float32Array(capacity * 6), 3)
    this.col = new BufferAttribute(new Float32Array(capacity * 6), 3)
    geo.setAttribute('position', this.pos)
    geo.setAttribute('color', this.col)
    this.lines = new LineSegments(
      geo,
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    )
    this.lines.frustumCulled = false
  }

  begin(): void {
    this.n = 0
  }

  /** `head` is drawn at `a` and fades to `tail` strength at `b`. */
  add(a: Vec3, b: Vec3, head: Color, mag = 1, tailMag = 0): void {
    if (this.n >= this.capacity) return
    const i = this.n * 2
    this.pos.setXYZ(i, a.x, a.y, a.z)
    this.pos.setXYZ(i + 1, b.x, b.y, b.z)
    this.col.setXYZ(i, head.r * mag, head.g * mag, head.b * mag)
    this.col.setXYZ(i + 1, head.r * tailMag, head.g * tailMag, head.b * tailMag)
    this.n++
  }

  end(): void {
    this.lines.geometry.setDrawRange(0, this.n * 2)
    this.pos.needsUpdate = true
    this.col.needsUpdate = true
  }
}

/**
 * One ring buffer for every spark in the game. Particles are the entire
 * vocabulary for violence here: a hit, a kill, a launch and a cascade differ
 * only in how many, how fast, and what colour.
 */
export class Particles {
  readonly points: Points
  private readonly pos: BufferAttribute
  private readonly col: BufferAttribute
  private readonly siz: BufferAttribute
  private readonly alpha: BufferAttribute
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly span: Float32Array
  private readonly drag: Float32Array
  private head = 0

  constructor(readonly capacity = 16000) {
    this.vel = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.span = new Float32Array(capacity)
    this.drag = new Float32Array(capacity)
    this.pos = new BufferAttribute(new Float32Array(capacity * 3), 3)
    this.col = new BufferAttribute(new Float32Array(capacity * 3), 3)
    this.siz = new BufferAttribute(new Float32Array(capacity), 1)
    this.alpha = new BufferAttribute(new Float32Array(capacity), 1)

    const geo = new BufferGeometry()
    geo.setAttribute('position', this.pos)
    geo.setAttribute('pcolor', this.col)
    geo.setAttribute('psize', this.siz)
    geo.setAttribute('palpha', this.alpha)
    this.points = new Points(geo, particleMaterial())
    this.points.frustumCulled = false
  }

  spawn(
    p: Vec3,
    vx: number,
    vy: number,
    vz: number,
    color: Color,
    size: number,
    life: number,
    drag = 1.1,
  ): void {
    const i = this.head
    this.head = (this.head + 1) % this.capacity
    this.pos.setXYZ(i, p.x, p.y, p.z)
    this.col.setXYZ(i, color.r, color.g, color.b)
    this.siz.setX(i, size)
    this.vel[i * 3] = vx
    this.vel[i * 3 + 1] = vy
    this.vel[i * 3 + 2] = vz
    this.life[i] = life
    this.span[i] = life
    this.drag[i] = drag
  }

  /** A spherical puff, which is most of what this system is ever asked for. */
  burst(
    p: Vec3,
    n: number,
    speed: number,
    color: Color,
    size: number,
    life: number,
    inherit?: Vec3,
    drag = 1.1,
  ): void {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      // Speed spread skewed low, so a burst has a dense core and a few fliers.
      const s = speed * (0.25 + Math.pow(Math.random(), 2) * 1.5)
      this.spawn(
        p,
        Math.cos(a) * r * s + (inherit?.x ?? 0),
        u * s + (inherit?.y ?? 0),
        Math.sin(a) * r * s + (inherit?.z ?? 0),
        color,
        size * (0.6 + Math.random() * 0.9),
        life * (0.55 + Math.random() * 0.9),
        drag,
      )
    }
  }

  update(dt: number): void {
    const pos = this.pos.array as Float32Array
    const alpha = this.alpha.array as Float32Array
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (alpha[i] !== 0) alpha[i] = 0
        continue
      }
      this.life[i] -= dt
      const f = Math.max(0, this.life[i]) / this.span[i]
      const k = Math.exp(-this.drag[i] * dt)
      const j = i * 3
      this.vel[j] *= k
      this.vel[j + 1] *= k
      this.vel[j + 2] *= k
      pos[j] += this.vel[j] * dt
      pos[j + 1] += this.vel[j + 1] * dt
      pos[j + 2] += this.vel[j + 2] * dt
      // Hold brightness, then fall off fast: sparks read as sparks, not as fog.
      alpha[i] = f * f * (0.4 + f * 0.6)
    }
    this.pos.needsUpdate = true
    this.col.needsUpdate = true
    this.siz.needsUpdate = true
    this.alpha.needsUpdate = true
  }
}

function particleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uScale: uPointScale },
    vertexShader: /* glsl */ `
      uniform float uScale;
      attribute float psize;
      attribute float palpha;
      attribute vec3 pcolor;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = pcolor;
        vAlpha = palpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(-mv.z, 1.0);
        float px = psize * uScale / d;
        // Sub pixel sparks dim instead of vanishing, which keeps a distant
        // explosion reading as a flash rather than as a stutter.
        vAlpha *= clamp(px, 0.15, 1.0);
        gl_PointSize = max(px, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        if (vAlpha < 0.004) discard;
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float f = 1.0 - r2 * 4.0;
        gl_FragColor = vec4(vColor, f * f * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/**
 * Everything transient: shots in flight, sparks, and the cascade. Driven by the
 * event list the simulation publishes each tick, so the renderer never has to
 * ask the sim a question.
 */
export class Fx {
  readonly group = new Group()
  readonly particles = new Particles()
  private readonly bolts = new Streaks(4000)
  private readonly nodes: Instances

  constructor() {
    this.nodes = new Instances(baryGeometry(new IcosahedronGeometry(1, 1)), 320, wireMaterial(1.1))
    this.group.add(this.particles.points, this.bolts.lines, this.nodes.mesh)
  }

  update(w: World, dt: number): void {
    for (const e of w.events) this.emit(e)
    this.drawBolts(w)
    this.drawNodes(w)
    this.particles.update(dt)
  }

  private emit(e: SimEvent): void {
    const core = SIDE_CORE[e.side]
    const size = e.cls ? cls(e.cls).size : 3

    switch (e.kind) {
      case 'shot':
        this.particles.burst(e.pos, 2, 14, core, size * 0.3, 0.12, undefined, 4)
        break
      case 'hit':
        // Hits are the most common event by far, so they stay small and hot: a
        // white flash reads as a hit even when forty of them happen at once.
        this.particles.burst(e.pos, 5, 34, WHITE, 1.1, 0.22, undefined, 3)
        this.particles.burst(e.pos, 3, 18, core, 1.6, 0.4, undefined, 2)
        break
      case 'kill': {
        const n = Math.round(14 + size * 3.5)
        this.particles.burst(e.pos, n, 24 + size * 2.2, core, size * 0.5, 0.9 + size * 0.05, undefined, 0.7)
        this.particles.burst(e.pos, Math.round(n * 0.4), 46 + size * 4, WHITE, size * 0.34, 0.32, undefined, 1.6)
        this.particles.burst(e.pos, 6, 8, EMBER, size * 0.7, 2.4 + size * 0.1, undefined, 0.35)
        break
      }
      case 'launch':
        this.particles.burst(e.pos, 10, 26, core, 1.4, 0.5, undefined, 2)
        break
      case 'device':
        this.particles.burst(e.pos, 40, 40, DEVICE, 2.4, 0.7, undefined, 1.4)
        break
      case 'cascade':
        // A node is a hole in matter opening, so the flash is violet and the
        // debris it throws is the colour of whatever it just took apart.
        this.particles.burst(e.pos, 34, 60, DEVICE_HOT, 2.2, 0.5, undefined, 1.2)
        this.particles.burst(e.pos, 22, 26, DEVICE, 3.4, 1.4, undefined, 0.6)
        break
      case 'unmade':
        for (let i = 0; i < 12; i++) {
          this.particles.burst(e.pos, 90, 150 + i * 30, i % 2 ? DEVICE_HOT : DEVICE, 7, 4 + i * 0.4, undefined, 0.16)
        }
        break
      case 'order':
        // Orders landing are an interface event, not a physical one; the overlay
        // draws them where the player is actually looking.
        break
    }
  }

  private drawBolts(w: World): void {
    this.bolts.begin()
    for (const b of w.bolts) {
      const c = cls(b.cls)
      const speed = c.weapon?.boltSpeed ?? 300
      const d = normalize(b.vel)
      // Tracer length scales with muzzle velocity, so a lance round visibly
      // outruns a needle's and heavy fire reads as heavier.
      const l = speed * 0.055 + c.size
      TAIL.x = b.pos.x - d.x * l
      TAIL.y = b.pos.y - d.y * l
      TAIL.z = b.pos.z - d.z * l
      const mag = c.id === 'lance' ? 3.4 : c.id === 'keel' ? 2.2 : 1.5
      this.bolts.add(b.pos, TAIL, SIDE_CORE[b.side], mag, 0)
    }
    for (const d of w.deviceBolts) {
      const dir = normalize(d.vel)
      const l = len(d.vel) * 0.09
      TAIL.x = d.pos.x - dir.x * l
      TAIL.y = d.pos.y - dir.y * l
      TAIL.z = d.pos.z - dir.z * l
      this.bolts.add(d.pos, TAIL, DEVICE_HOT, 4, 0.2)
      this.particles.spawn(d.pos, 0, 0, 0, DEVICE, 3.2, 0.45, 0.5)
    }
    this.bolts.end()
  }

  /**
   * Each cascade generation is a sphere of exactly the radius that will consume
   * matter, drawn expanding from nothing as its fuse burns. That is not decoration
   * either: it is the only way to see how far the chain is about to reach.
   */
  private drawNodes(w: World): void {
    this.nodes.begin()
    for (const n of w.nodes) {
      const t = n.fired ? Math.min(1, n.age * 3.2) : 1 - Math.min(1, n.fuse * 5)
      // Cooling as it inflates, which is both what an expanding shell should do and
      // what keeps this off the bloom pass's limits. A node fills a couple of
      // hundred pixels; held at the brightness of a muzzle flash it puts enough
      // energy into the coarsest bloom mip to lift a visible square of the sky
      // around itself, and the eye finds a straight edge on black instantly.
      const glow = (n.fired ? Math.max(0, 1.4 - n.age * 2.2) : 0.6) * (1 - t * 0.6)
      this.nodes.add(n.pos, n.radius * (0.2 + t * 0.8), null, n.fired ? DEVICE_HOT : DEVICE, glow)
    }
    this.nodes.end()
  }
}

const WHITE = new Color('#ffffff')
const EMBER = new Color('#ff7a3a')
const TAIL = { x: 0, y: 0, z: 0 }
