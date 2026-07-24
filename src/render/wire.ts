import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { Vec3 } from '../sim/vec3'

/**
 * Asteroids, updated. Every solid thing the fleet owns is drawn as a glowing
 * wireframe, and all of them are drawn through this: one instanced draw call per
 * shape, with the edge width computed in the fragment shader so a hull holds a
 * crisp one pixel outline whether it is filling the screen or three units wide.
 *
 * The trick is barycentric coordinates. Each triangle gets corner weights, the
 * fragment sits at the minimum of them, and that minimum is a screen space
 * distance to the nearest edge once you take its derivative.
 */
export function baryGeometry(src: BufferGeometry): BufferGeometry {
  const geo = src.index ? src.toNonIndexed() : src.clone()
  const n = geo.getAttribute('position').count
  const bary = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) bary[i * 3 + (i % 3)] = 1
  geo.setAttribute('bary', new BufferAttribute(bary, 3))
  geo.deleteAttribute('normal')
  geo.deleteAttribute('uv')
  return geo
}

export function wireMaterial(width: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uWidth: { value: width } },
    vertexShader: /* glsl */ `
      attribute vec3 bary;
      attribute vec3 tint;
      attribute float glow;
      varying vec3 vBary;
      varying vec3 vTint;
      varying float vGlow;
      void main() {
        vBary = bary;
        vTint = tint;
        vGlow = glow;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uWidth;
      varying vec3 vBary;
      varying vec3 vTint;
      varying float vGlow;
      void main() {
        float m = min(min(vBary.x, vBary.y), vBary.z);
        // fwidth turns the barycentric minimum into a distance in pixels, which is
        // what keeps the line one pixel wide at every scale.
        float w = fwidth(m) * uWidth;
        float edge = 1.0 - smoothstep(0.0, w, m);
        if (edge < 0.015) discard;
        gl_FragColor = vec4(vTint * (1.85 + vGlow * 3.0), edge);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

const _m = new Matrix4()
const _p = new Vector3()
const _s = new Vector3()
const _q = new Quaternion()

/**
 * A soft bubble: bright where the sphere turns away from the camera and invisible
 * everywhere else. Absorption fields are drawn with this rather than as wireframe,
 * because a field is a boundary and nothing else. Interior structure would make it
 * read as an object, and it would clutter the volume the player is trying to see
 * their own hulls inside.
 */
export function shellMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    // A high power keeps the glow to the silhouette. Anything softer fills the
    // whole disc and the bubble starts reading as a translucent solid; and since a
    // planet's limb is the same rim glow at power 4.5, a wide one on a field the
    // size of half the screen reads as a world sitting in front of the fleet.
    uniforms: { uPower: { value: 11 } },
    vertexShader: /* glsl */ `
      attribute vec3 tint;
      attribute float glow;
      varying vec3 vTint;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vTint = tint * (1.0 + glow);
        mat4 mv = modelViewMatrix * instanceMatrix;
        vec4 p = mv * vec4(position, 1.0);
        // The geometry is a unit sphere at the origin, so its position doubles as
        // its normal and no normal matrix is needed.
        vN = normalize(mat3(mv) * position);
        vV = normalize(-p.xyz);
        gl_Position = projectionMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPower;
      varying vec3 vTint;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        if (rim < 0.004) discard;
        gl_FragColor = vec4(vTint, rim);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/** A pool of one shape, refilled from scratch every frame. */
export class Instances {
  readonly mesh: InstancedMesh
  private readonly tint: InstancedBufferAttribute
  private readonly glow: InstancedBufferAttribute
  private n = 0

  constructor(geo: BufferGeometry, readonly capacity: number, material: ShaderMaterial) {
    this.tint = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.glow = new InstancedBufferAttribute(new Float32Array(capacity), 1)
    geo.setAttribute('tint', this.tint)
    geo.setAttribute('glow', this.glow)
    this.mesh = new InstancedMesh(geo, material, capacity)
    // Instance matrices carry absolute world positions, so the mesh's own bounds
    // mean nothing and culling against them would delete the whole fleet.
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }

  begin(): void {
    this.n = 0
  }

  add(pos: Vec3, scale: number | Vector3, rot: Quaternion | null, color: Color, glow = 0): void {
    if (this.n >= this.capacity) return
    _p.set(pos.x, pos.y, pos.z)
    if (typeof scale === 'number') _s.setScalar(scale)
    else _s.copy(scale)
    _m.compose(_p, rot ?? _q.identity(), _s)
    this.mesh.setMatrixAt(this.n, _m)
    this.tint.setXYZ(this.n, color.r, color.g, color.b)
    this.glow.setX(this.n, glow)
    this.n++
  }

  end(): void {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.tint.needsUpdate = true
    this.glow.needsUpdate = true
  }
}
