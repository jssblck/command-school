import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  WireframeGeometry,
} from 'three'
import { makeRng } from '../sim/rng'
import type { Body, World } from '../sim/types'
import { BODY_WIRE, DEVICE, GRID_LINE, RING_DUST } from './palette'
import { uPointScale } from './shared'

const UP = new Vector3(0, 1, 0)

/**
 * Plane normals of the three boundary circles, in the order `boundary` builds them, and the
 * colour a circle is drawn in when it is fully face-on.
 *
 * Orthogonal normals mean the three circles between them always put the same ink on screen,
 * which is not the same as the wall always being legible. At the angle exactly between the axes
 * each circle sits at 58 percent, and a dimmer version of this measured 10 levels of contrast
 * out of 765 there against 26 for a face-on circle: conserved ink split three ways, and three
 * lines nobody can find. Hence the square root, which lifts the worst case to 76 percent
 * without touching the face-on case.
 *
 * The colour is past the bloom threshold, which is why it is this much brighter rather than the
 * 1.6x the contrast numbers asked for. Under the threshold the post pass ignores the line and
 * over it the pass amplifies it, so the worst case went to 79 instead of the 26 aimed at, and
 * there is no quiet setting in between.
 */
const WALL_NORMALS = [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)]
const WALL_COLOR = 0x1a3043
const _view = new Vector3()

/**
 * The furniture of the volume: worlds, moons, rings, debris, and the reference
 * grid. All of it is rebuilt when a scenario loads and only the unmaking of a
 * homeworld animates, so this is the cheap half of the renderer.
 *
 * Bodies are the one thing here that is genuinely solid. They are drawn as a
 * near black shell under a wireframe so they occlude correctly, because whether
 * a hull is behind a planet is a fact the player has to be able to read.
 */
export class Terrain {
  readonly group = new Group()
  private readonly shells = new Map<number, Mesh>()
  private readonly wires = new Map<number, LineSegments>()
  private readonly limbs = new Map<number, Mesh>()
  private readonly walls: LineSegments[]

  constructor(private readonly world: World) {
    this.group.add(referenceGrid(world))
    this.walls = boundary(world.bounds)
    for (const wall of this.walls) this.group.add(wall)
    for (const body of world.bodies) this.add(body)
  }

  private add(body: Body): void {
    if (body.kind === 'ring' || body.kind === 'field') {
      this.group.add(dust(body))
      return
    }

    const detail = body.radius > 100 ? 3 : 2
    const sphere = new IcosahedronGeometry(body.radius, detail)

    // Opaque, so it draws in the opaque pass ahead of every additive layer in the
    // scene and depth-rejects the wireframe's far hemisphere. Left transparent it
    // sorts against the wire at the same distance and the planet ends up drawn
    // inside out, twice as busy as it should be.
    const shell = new Mesh(sphere, new MeshBasicMaterial({ color: body.kind === 'planet' ? 0x04060b : 0x06070a }))
    shell.scale.setScalar(0.985)
    shell.position.set(body.pos.x, body.pos.y, body.pos.z)
    this.group.add(shell)
    this.shells.set(body.id, shell)

    const wire = new LineSegments(new WireframeGeometry(sphere), breakMaterial(body))
    wire.position.copy(shell.position)
    this.group.add(wire)
    this.wires.set(body.id, wire)

    if (body.kind === 'planet') {
      const limb = new Mesh(new IcosahedronGeometry(body.radius * 1.045, detail + 1), limbMaterial(body))
      limb.position.copy(shell.position)
      this.group.add(limb)
      this.limbs.set(body.id, limb)
    }
  }

  /**
   * The wall turns with the camera, and only the consumable homeworld ever changes. When it
   * does it has to be unmistakable: the shell dissolves, the wireframe pulls itself apart
   * along its own edges, and the limb glow goes from cold to the colour of the device.
   */
  update(camera: Camera): void {
    // A boundary circle only reads as an edge while you can see some of its face. Turned
    // edge-on it projects to a dead straight line through the middle of the volume, which
    // reads as a stray mark laid over the battle and not as the wall it is, so each circle
    // is dimmed by how far its own plane has swung into the view direction.
    camera.getWorldDirection(_view)
    for (let i = 0; i < this.walls.length; i++) {
      const mat = this.walls[i].material as LineBasicMaterial
      mat.opacity = Math.sqrt(Math.abs(WALL_NORMALS[i].dot(_view)))
    }

    for (const body of this.world.bodies) {
      if (!body.consumable) continue
      const gone = 1 - Math.max(0, body.integrity)
      if (gone <= 0) continue

      const shell = this.shells.get(body.id)
      if (shell) {
        const mat = shell.material as MeshBasicMaterial
        mat.transparent = true
        mat.opacity = Math.max(0, 1 - gone * 1.6)
        mat.depthWrite = mat.opacity > 0.35
        shell.scale.setScalar(0.985 * (1 - gone * 0.45))
      }
      const wire = this.wires.get(body.id)
      if (wire) (wire.material as ShaderMaterial).uniforms.uBreak.value = gone
      const limb = this.limbs.get(body.id)
      if (limb) {
        const mat = limb.material as ShaderMaterial
        mat.uniforms.uBreak.value = gone
        limb.scale.setScalar(1 + gone * 0.5)
      }
    }
  }
}

/**
 * Displaces every vertex outward along a hash of its own position, so the two
 * ends of an edge always agree and the sphere tears into a connected web rather
 * than a cloud of unrelated line segments.
 */
function breakMaterial(body: Body): ShaderMaterial {
  const cold = BODY_WIRE.clone().multiplyScalar(body.kind === 'moon' ? 1.25 : 1)
  return new ShaderMaterial({
    uniforms: {
      uBreak: { value: 0 },
      uCold: { value: cold },
      uHot: { value: DEVICE.clone() },
      uRadius: { value: body.radius },
    },
    vertexShader: /* glsl */ `
      uniform float uBreak;
      uniform float uRadius;
      varying float vHash;
      varying float vRim;
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      void main() {
        float h = hash(floor(position * 0.35));
        vHash = h;
        vec3 n = normalize(position);
        vec3 p = position + n * uBreak * uRadius * (0.15 + h * 0.9);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // Lines facing the camera are faded and lines at the limb are not, so the
        // mesh reads as a curved surface rather than as a geodesic cage.
        vRim = 1.0 - abs(dot(normalize(mat3(modelViewMatrix) * n), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBreak;
      uniform vec3 uCold;
      uniform vec3 uHot;
      varying float vHash;
      varying float vRim;
      void main() {
        // Flares as it comes apart, then burns out unevenly, chunk by chunk.
        float flare = smoothstep(0.0, 0.3, uBreak) * (1.0 - smoothstep(0.35, 1.0, uBreak + vHash * 0.4));
        vec3 c = mix(uCold, uHot * 2.2, flare);
        float a = 1.0 - smoothstep(0.5, 1.0, uBreak + vHash * 0.3);
        gl_FragColor = vec4(c, a * mix(0.22, 1.0, vRim) * (1.0 + uBreak));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/** A fresnel rim on a shell slightly larger than the planet, and nothing else. */
function limbMaterial(body: Body): ShaderMaterial {
  const rng = makeRng(body.seed)
  const cool = new Color().setHSL(0.54 + rng() * 0.12, 0.5, 0.5)
  return new ShaderMaterial({
    uniforms: { uBreak: { value: 0 }, uCool: { value: cool }, uHot: { value: DEVICE.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBreak;
      uniform vec3 uCool;
      uniform vec3 uHot;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 4.5);
        vec3 c = mix(uCool, uHot, uBreak);
        gl_FragColor = vec4(c * (0.32 + uBreak * 2.5), rim * (0.5 + uBreak));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/**
 * Rings and debris fields are the same object with different densities. Both are
 * drawn as loose dust because that is what they do mechanically: they do not stop
 * a hull, they hide it and wear it down.
 *
 * Every dimension here comes off the body rather than out of this function, because
 * a player reads the edge of a hazard off the dust and nowhere else.
 */
function dust(body: Body): Points {
  const ring = body.kind === 'ring'
  const n = ring ? 13000 : 11000
  const rng = makeRng(body.seed ^ 0x5eed)
  const inner = body.inner
  // A couple of seeded gaps, so a ring reads as banded rather than as a smear.
  const gaps = ring
    ? [rng.range(0.25, 0.45), rng.range(0.6, 0.8)].map((f) => ({ at: inner + (body.radius - inner) * f, w: body.radius * 0.035 }))
    : []

  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const size = new Float32Array(n)
  const q = new Quaternion().setFromUnitVectors(UP, new Vector3(body.normal.x, body.normal.y, body.normal.z).normalize())
  const p = new Vector3()
  const c = new Color()

  let i = 0
  let guard = 0
  while (i < n && guard++ < n * 12) {
    // Square root keeps the disc evenly covered instead of piling up at the hub.
    const r = Math.sqrt(rng.range(inner * inner, body.radius * body.radius))
    if (gaps.some((g) => Math.abs(r - g.at) < g.w)) continue
    const a = rng() * Math.PI * 2
    p.set(Math.cos(a) * r, rng.range(-1, 1) * body.thickness * 0.5, Math.sin(a) * r).applyQuaternion(q)
    pos[i * 3] = body.pos.x + p.x
    pos[i * 3 + 1] = body.pos.y + p.y
    pos[i * 3 + 2] = body.pos.z + p.z

    const mag = 0.25 + Math.pow(rng(), 2.4) * 0.85
    c.copy(RING_DUST).offsetHSL(rng.range(-0.03, 0.03), 0, 0)
    col[i * 3] = c.r * mag
    col[i * 3 + 1] = c.g * mag
    col[i * 3 + 2] = c.b * mag
    size[i] = ring ? rng.range(1.4, 4.2) : rng.range(2.2, 7)
    i++
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('pcolor', new BufferAttribute(col, 3))
  geo.setAttribute('psize', new BufferAttribute(size, 1))
  geo.setDrawRange(0, i)
  const points = new Points(geo, dustMaterial())
  points.frustumCulled = false
  return points
}

function dustMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uScale: uPointScale },
    vertexShader: /* glsl */ `
      uniform float uScale;
      attribute float psize;
      attribute vec3 pcolor;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vColor = pcolor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(-mv.z, 1.0);
        float px = psize * uScale / d;
        // Rock is the only thing in this scene that is not a light source, and a
        // field's job is to hide hulls rather than to outshine them, so a grain is
        // held to a fixed amount of light at both ends of the range: under a pixel
        // it fades out rather than aliasing down, so a distant field thins instead
        // of flickering, and over a few pixels it dims as it spreads. Without the
        // far end, flying into a field puts seven thousand ten pixel discs on top
        // of each other and the additive sum is a white wall with our own fleet
        // somewhere inside it.
        vFade = clamp(px, 0.0, 1.0) / max(1.0, px * 0.3);
        gl_PointSize = clamp(px, 1.0, 9.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = dot(d, d);
        if (r > 0.25) discard;
        gl_FragColor = vec4(vColor, (1.0 - r * 4.0) * vFade);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/**
 * The reference grid, dimpled by gravity. There is no floor in space, but a
 * player needs one to judge depth at all, and sagging it into the wells turns a
 * pure readability crutch into the one piece of information the hulls cannot
 * show you: where the volume is pulling.
 */
function referenceGrid(w: World): LineSegments {
  const extent = Math.round(w.bounds / 100) * 100
  const step = 100
  const seg = 20
  const lines: number[] = []
  const colors: number[] = []
  const c = new Color()

  const sag = (x: number, z: number): number => {
    let y = 0
    for (const b of w.bodies) {
      if (b.mu <= 0) continue
      const dx = x - b.pos.x
      const dz = z - b.pos.z
      const d = Math.sqrt(dx * dx + dz * dz + b.pos.y * b.pos.y)
      y -= (b.mu / (d + 240)) * 0.34
    }
    return y
  }

  const push = (x: number, z: number, x2: number, z2: number) => {
    const y1 = sag(x, z)
    const y2 = sag(x2, z2)
    lines.push(x, y1, z, x2, y2, z2)
    // Brighter where the sheet is steep, so a well announces itself.
    const slope = Math.abs(y2 - y1) / (step / seg)
    for (const [px, pz, py] of [
      [x, z, y1],
      [x2, z2, y2],
    ]) {
      const edge = 1 - Math.max(Math.abs(px), Math.abs(pz)) / extent
      const mag = Math.max(0, edge) * (0.55 + Math.min(1.6, slope * 2.4)) + Math.min(0.8, -py / 400)
      c.copy(GRID_LINE).multiplyScalar(mag)
      colors.push(c.r, c.g, c.b)
    }
  }

  for (let g = -extent; g <= extent; g += step) {
    for (let i = 0; i < seg * ((extent * 2) / step); i++) {
      const a = -extent + (i * step) / seg
      const b = a + step / seg
      push(g, a, g, b)
      push(a, g, b, g)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(lines), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  const grid = new LineSegments(
    geo,
    new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }),
  )
  grid.frustumCulled = false
  return grid
}

/**
 * Three great circles at the soft wall, so the edge of the theatre is findable. The wall is a
 * sphere on the origin that pushes a hull back at one and a half times its own thrust, so it is
 * a place the fleet can be driven into and has to be drawn.
 *
 * One circle per principal plane, each its own object with its own material, because
 * `Terrain.update` fades them separately as the camera turns.
 */
function boundary(radius: number): LineSegments[] {
  const n = 128
  const out: LineSegments[] = []
  for (let axis = 0; axis < 3; axis++) {
    const pts: number[] = []
    for (let i = 0; i < n; i++) {
      for (const t of [i, i + 1]) {
        const a = (t / n) * Math.PI * 2
        const u = Math.cos(a) * radius
        const v = Math.sin(a) * radius
        if (axis === 0) pts.push(u, v, 0)
        else if (axis === 1) pts.push(u, 0, v)
        else pts.push(0, u, v)
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3))
    const line = new LineSegments(
      geo,
      new LineBasicMaterial({
        color: WALL_COLOR,
        transparent: true,
        // Set every frame by `Terrain.update`; this is only the value for the first one.
        opacity: 1,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    )
    line.frustumCulled = false
    out.push(line)
  }
  return out
}
