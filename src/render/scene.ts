import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { makeRng } from '../sim/rng'
import { uPointScale } from './shared'

/**
 * Everything on screen is emissive: there are no lights in this scene and no
 * material that responds to one. Bloom is therefore not decoration, it is the
 * renderer, since it is what turns a one pixel additive dot into something that
 * reads as a ship burning at range.
 */
export class Stage {
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  /** Pixels per world unit at one unit of depth; point sizes are scaled by it. */
  pointScale = 600

  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new PerspectiveCamera(52, 1, 1, 40000)
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // The threshold sits above every dim layer on purpose. Bloom everything and
    // the grid, the dust and the hull wires all go soft, which costs the picture
    // exactly the detail it is supposed to reward looking closer for; bloom only
    // the cores and the muzzle flashes and they read as light sources instead.
    //
    // The radius is tight for the same reason. Spread wide, the pass leans on its
    // coarsest mip, and a coarse mip is a box: around anything as bright and as
    // large as a cascade node it lifts a rectangle of sky by a couple of levels,
    // which on black is a straight edge the eye finds immediately.
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.62, 0.2, 0.5)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.scene.add(starfield())
    this.resize()
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio, 1.75)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.pointScale = (h * dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360))
    uPointScale.value = this.pointScale
  }

  render(): void {
    this.composer.render()
  }
}

/**
 * A sphere of stars far enough out that orbiting the theatre gives no parallax.
 * They are dim on purpose: the point is to keep the volume from reading as a
 * flat black rectangle, not to compete with the fleet.
 */
function starfield(): Points {
  const n = 2600
  const rng = makeRng(7)
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const cold = new Color('#9fc4ff')
  const warm = new Color('#ffd9a8')
  const white = new Color('#ffffff')
  const c = new Color()

  for (let i = 0; i < n; i++) {
    // Uniform on the sphere, so no seam or pole is visible when the camera swings.
    const u = rng() * 2 - 1
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    const d = 9000 + rng() * 2000
    pos[i * 3] = Math.cos(a) * r * d
    pos[i * 3 + 1] = u * d
    pos[i * 3 + 2] = Math.sin(a) * r * d

    const t = rng()
    c.copy(t < 0.2 ? cold : t < 0.34 ? warm : white)
    // Heavily skewed brightness, and dim overall. A star and a distant hull are
    // both a couple of pixels wide, so the only thing keeping them apart is that
    // hulls are brighter, coloured, and moving. Bright stars eat that margin.
    const mag = 0.04 + Math.pow(rng(), 3.4) * 0.34
    col[i * 3] = c.r * mag
    col[i * 3 + 1] = c.g * mag
    col[i * 3 + 2] = c.b * mag
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('color', new BufferAttribute(col, 3))
  const mat = new PointsMaterial({
    size: 1.7,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const stars = new Points(geo, mat)
  stars.frustumCulled = false
  return stars
}
