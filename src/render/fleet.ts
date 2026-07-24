import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  OctahedronGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  TetrahedronGeometry,
  Vector3,
} from 'three'
import { cls } from '../sim/classes'
import { formationRadius } from '../sim/formation'
import { shipById } from '../sim/world'
import type { ClassId, Ship, Side, World } from '../sim/types'
import { DAMAGE, SIDE_CORE, SIDE_HULL } from './palette'
import { uPointScale } from './shared'
import { Streaks } from './fx'
import { baryGeometry, Instances, shellMaterial, wireMaterial } from './wire'

/**
 * Hull lengths in world units, chosen against formation spacing rather than
 * against each other: a squadron should look dense without its hulls appearing to
 * clip, so each of these sits a little under the slot spacing for its class.
 */
const LENGTH: Record<ClassId, number> = {
  needle: 4.2,
  lance: 9,
  aegis: 6.4,
  keel: 17,
  eye: 4.8,
}

/**
 * Five silhouettes, and they have to be tellable apart at a glance from any
 * angle, because class is the single most important thing about an enemy contact.
 * A dart is a needle, a long spike is artillery, a diamond is a screen, a slab is
 * a capital, and a tiny chip of glass is an eye.
 */
function hullGeometry(id: ClassId): BufferGeometry {
  const l = LENGTH[id]
  switch (id) {
    case 'needle':
      return new ConeGeometry(l * 0.3, l, 3).rotateX(Math.PI / 2)
    case 'lance':
      return new CylinderGeometry(l * 0.045, l * 0.14, l, 4).rotateX(Math.PI / 2)
    case 'aegis':
      return new OctahedronGeometry(l * 0.44).scale(1, 1, 1.3)
    case 'keel':
      return new CylinderGeometry(l * 0.23, l * 0.3, l, 6).rotateX(Math.PI / 2)
    case 'eye':
      return new TetrahedronGeometry(l * 0.42).scale(1, 1, 1.5)
  }
}

const FORWARD = new Vector3(0, 0, 1)
const CLASS_IDS: ClassId[] = ['needle', 'lance', 'aegis', 'keel', 'eye']

/**
 * The fleet, drawn twice over. Every hull gets a wireframe silhouette and a
 * point of light at its nose, and which of the two you are actually looking at
 * depends only on how far away the camera is: pulled back to the whole theatre a
 * squadron is a constellation, and pushed in it is a formation of ships. Nothing
 * switches or pops, the geometry simply falls below a pixel and the light does not.
 */
export class Fleet {
  readonly group = new Group()
  /** Whose sensors the view is drawn from. */
  viewSide: Side = 'blue'
  fog = true

  private readonly hulls = new Map<ClassId, Instances>()
  private readonly fields: Instances
  private readonly trails = new Streaks(1400)
  private readonly cores: CoreCloud
  private readonly quat = new Quaternion()
  private readonly dir = new Vector3()
  private readonly mid = new Vector3()
  private readonly tint = new Color()

  constructor() {
    for (const id of CLASS_IDS) {
      const inst = new Instances(
        baryGeometry(hullGeometry(id)),
        id === 'keel' ? 48 : 640,
        wireMaterial(id === 'needle' ? 1.2 : 1.5),
      )
      this.hulls.set(id, inst)
      this.group.add(inst.mesh)
    }
    // Detail 4, because a field can fill half the screen and detail 3 shows its
    // facets on the silhouette, which is the one place the eye is looking.
    this.fields = new Instances(new IcosahedronGeometry(1, 4), 96, shellMaterial())
    this.cores = new CoreCloud(1200)
    this.group.add(this.fields.mesh, this.trails.lines, this.cores.points)
  }

  visible(w: World, s: Ship): boolean {
    return !this.fog || s.side === this.viewSide || w.seen[this.viewSide].has(s.id)
  }

  update(w: World): void {
    for (const inst of this.hulls.values()) inst.begin()
    this.trails.begin()
    this.cores.begin()

    for (const s of w.ships) {
      if (!s.alive || !this.visible(w, s)) continue
      const c = cls(s.cls)

      // Damage bleeds the side colour toward a hot wound colour, and a fresh hit
      // or a shot just fired flares the whole hull for a few frames.
      // Capped short of the wound colour on purpose. Blue mixed all the way into a
      // hot red passes through magenta, and a magenta hull reads as a third side
      // rather than as one of ours in trouble. Which side a light belongs to is the
      // one thing the palette is never allowed to blur.
      const wear = 1 - Math.max(0, Math.min(1, s.hp / c.hp))
      this.tint.copy(SIDE_HULL[s.side]).lerp(DAMAGE, wear * 0.5)
      const flare = Math.min(1.4, s.heat * 0.9 + s.stress * 1.6)

      this.dir.set(s.fwd.x, s.fwd.y, s.fwd.z)
      this.quat.setFromUnitVectors(FORWARD, this.dir)
      this.hulls.get(s.cls)!.add(s.pos, 1, this.quat, this.tint, flare)

      const speed = Math.sqrt(s.vel.x * s.vel.x + s.vel.y * s.vel.y + s.vel.z * s.vel.z)
      const drive = Math.min(1, speed / c.maxSpeed)
      if (drive > 0.06) {
        const l = speed * 0.085 + c.size * 0.3
        const k = l / Math.max(speed, 1e-3)
        TAIL.x = s.pos.x - s.vel.x * k
        TAIL.y = s.pos.y - s.vel.y * k
        TAIL.z = s.pos.z - s.vel.z * k
        this.trails.add(s.pos, TAIL, SIDE_CORE[s.side], drive * 1.6, 0)
      }

      // Cores sit just past white: far enough to bloom, which is what makes a two
      // pixel dot read as a ship burning rather than as a stuck pixel, and no
      // further. Pushed harder they blow out to featureless white and the bloom
      // kernel's square support becomes visible as a box against the black.
      this.tint.copy(SIDE_CORE[s.side]).lerp(DAMAGE, wear * 0.35).multiplyScalar(1.25)
      this.cores.add(s.pos, this.tint, c.size * 0.42, 0.85 + flare * 0.5)
    }

    this.drawFields(w)

    for (const inst of this.hulls.values()) inst.end()
    this.trails.end()
    this.cores.end()
  }

  /**
   * One bubble per aegis squadron rather than one per hull. What the player needs
   * to know is where protected space is, and four shells stacked on four hulls in
   * the same formation says that worse than one shell around the formation does:
   * it is brighter, busier, and describes the same volume.
   *
   * Centred on the hulls this viewer can see rather than on sq.centroid, which the
   * sim averages over every live hull whether it has been detected or not. With
   * two of a screen's three hulls still dark, the sim's centroid drags the shell
   * off toward hulls the player has no contact on, which both draws a hoop around
   * empty space and quietly reports where the undetected two are.
   */
  private drawFields(w: World): void {
    this.fields.begin()
    for (const sq of w.squadrons) {
      const c = cls(sq.cls)
      if (!c.field) continue
      let pool = 0
      let n = 0
      this.mid.set(0, 0, 0)
      for (const id of sq.ships) {
        const s = shipById(w, id)
        if (!s?.alive || !this.visible(w, s)) continue
        pool += s.shield / Math.max(1, s.cover?.pool ?? 0)
        this.mid.x += s.pos.x
        this.mid.y += s.pos.y
        this.mid.z += s.pos.z
        n++
      }
      if (n === 0 || pool <= 0.05) continue
      this.mid.divideScalar(n)
      const strength = pool / n
      // The hull colour rather than the core colour, because the core colours sit
      // near white and a near white hoop this size reads as the same pale grey the
      // grid and the dust are drawn in. Whose field it is has to survive being dim.
      // Level carries shield strength: a field about to fail is a thin trace, a
      // full one is a clean bright hoop.
      this.tint.copy(SIDE_HULL[sq.side]).multiplyScalar(0.12 + strength * 0.26)
      this.fields.add(
        this.mid,
        c.field.radius + formationRadius(sq.cls, sq.stance, n) * 0.6,
        null,
        this.tint,
        0,
      )
    }
    this.fields.end()
  }

}

/**
 * The points of light. Sizes are in world units so a capital's core is genuinely
 * bigger than a needle's, but the pixel size is floored, which is what lets a
 * fleet stay legible as a pattern of dots from across the theatre.
 */
class CoreCloud {
  readonly points: Points
  private readonly pos: BufferAttribute
  private readonly col: BufferAttribute
  private readonly siz: BufferAttribute
  private readonly alpha: BufferAttribute
  private n = 0

  constructor(readonly capacity: number) {
    this.pos = new BufferAttribute(new Float32Array(capacity * 3), 3)
    this.col = new BufferAttribute(new Float32Array(capacity * 3), 3)
    this.siz = new BufferAttribute(new Float32Array(capacity), 1)
    this.alpha = new BufferAttribute(new Float32Array(capacity), 1)
    const geo = new BufferGeometry()
    geo.setAttribute('position', this.pos)
    geo.setAttribute('pcolor', this.col)
    geo.setAttribute('psize', this.siz)
    geo.setAttribute('palpha', this.alpha)
    this.points = new Points(geo, coreMaterial())
    this.points.frustumCulled = false
  }

  begin(): void {
    this.n = 0
  }

  add(p: { x: number; y: number; z: number }, color: Color, size: number, alpha: number): void {
    if (this.n >= this.capacity) return
    this.pos.setXYZ(this.n, p.x, p.y, p.z)
    this.col.setXYZ(this.n, color.r, color.g, color.b)
    this.siz.setX(this.n, size)
    this.alpha.setX(this.n, alpha)
    this.n++
  }

  end(): void {
    this.points.geometry.setDrawRange(0, this.n)
    this.pos.needsUpdate = true
    this.col.needsUpdate = true
    this.siz.needsUpdate = true
    this.alpha.needsUpdate = true
  }
}

function coreMaterial(): ShaderMaterial {
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
        // Both ends matter. The floor means a hull never shrinks below a visible
        // dot however far the camera pulls back, and the ceiling means the light
        // stays a light: without it the core grows into a ball that swallows the
        // wireframe it is supposed to be mounted on.
        gl_PointSize = clamp(psize * uScale / d, 4.0, 17.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float f = pow(1.0 - r, 2.2) + pow(1.0 - r, 10.0) * 0.8;
        gl_FragColor = vec4(vColor, f * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

const TAIL = { x: 0, y: 0, z: 0 }
