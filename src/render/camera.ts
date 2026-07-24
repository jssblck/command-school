import { Matrix4, PerspectiveCamera, Quaternion, Ray, Vector3 } from 'three'
import type { Vec3 } from '../sim/vec3'

const WORLD_UP = new Vector3(0, 1, 0)
const PITCH_LIMIT = 1.35

/**
 * An orbit rig, with one twist that the setting demands: the axis it treats as
 * up is not fixed. `The enemy's gate is down` is a statement about orientation,
 * so it has to be something the camera can actually do, which means the rig has
 * to be able to hang the whole volume off an arbitrary axis and still orbit
 * sanely inside it.
 *
 * The rig computes where the camera wants to be; the camera itself always eases
 * toward that. Snapping the up axis therefore reads as the theatre rolling over
 * around you rather than as a cut.
 */
export class CameraRig {
  readonly target = new Vector3()
  dist = 900
  yaw = 0
  pitch = 0.55
  /** Which way is up. Reset to world up, or set to face the enemy gate. */
  readonly upAxis = new Vector3(0, 1, 0)
  /** 0 snaps, 1 never arrives; per-frame easing is scaled off this. */
  ease = 0.12

  private readonly wantPos = new Vector3()
  private readonly wantQuat = new Quaternion()
  private readonly basis = new Matrix4()
  private readonly tmp = new Vector3()
  private readonly e0 = new Vector3()
  private readonly e1 = new Vector3()
  private readonly was = new Vector3()
  private readonly now = new Vector3()
  private readonly right = new Vector3()
  private readonly up = new Vector3()
  private started = false

  /**
   * Turn to look somewhere else without moving the camera.
   *
   * An orbit rig walks the camera around a fixed centre, and at command range that
   * reads as the theatre being spun on a turntable rather than as a commander turning
   * their head: the one part of the picture that stays put is the thing under the
   * cursor, which is the thing being looked at. Holding the position and pushing the
   * centre around instead makes the drag a look. Nothing else has to change, since a
   * followed wing writes the centre every frame, so the same drag still swings around
   * whatever the camera has been told to hold.
   */
  orbit(dx: number, dy: number): void {
    this.direction(this.was)
    this.yaw -= dx
    this.pitch = clamp(this.pitch + dy, -PITCH_LIMIT, PITCH_LIMIT)
    this.direction(this.now)
    this.target.addScaledVector(this.was, this.dist).addScaledVector(this.now, -this.dist)
  }

  zoom(notches: number): void {
    this.dist = clamp(this.dist * Math.exp(notches * 0.16), 55, 4200)
  }

  /**
   * Slide the orbit centre across the screen, in world units along the camera's own
   * right and up. How many units a gesture is worth is a question about the frustum
   * and the viewport, so the caller answers it; this is only the basis.
   *
   * And the basis has to be the camera's own. The pair the rig hangs the volume off
   * does not turn with yaw, and panning against it meant a horizontal drag moved the
   * picture seven pixels while a vertical one moved it twenty four sideways, with which
   * axis did what depending on where the camera happened to be standing.
   */
  pan(right: number, up: number): void {
    const dir = this.direction(this.tmp)
    this.right.crossVectors(this.upAxis, dir).normalize()
    this.up.crossVectors(dir, this.right).normalize()
    this.target.addScaledVector(this.right, right).addScaledVector(this.up, up)
  }

  focus(at: Vec3, dist?: number): void {
    this.target.set(at.x, at.y, at.z)
    if (dist !== undefined) this.dist = clamp(dist, 55, 4200)
  }

  /**
   * Hang the volume off `axis`: whatever direction that is becomes screen down.
   * Yaw and pitch are re-derived in the new frame so the camera keeps the
   * viewpoint it had and only rolls into the new orientation.
   */
  setUpAxis(axis: Vector3): void {
    const dir = this.direction(this.tmp).clone()
    this.upAxis.copy(axis).normalize()
    this.frame()
    // Decompose the current view direction into the new basis.
    this.pitch = clamp(Math.asin(clamp(dir.dot(this.upAxis), -1, 1)), -PITCH_LIMIT, PITCH_LIMIT)
    this.yaw = Math.atan2(dir.dot(this.e1), dir.dot(this.e0))
  }

  levelUp(): void {
    this.setUpAxis(WORLD_UP)
  }

  /** Unit vector from the target toward the camera. */
  direction(out: Vector3): Vector3 {
    this.frame()
    const cp = Math.cos(this.pitch)
    return out
      .copy(this.e0)
      .multiplyScalar(cp * Math.cos(this.yaw))
      .addScaledVector(this.e1, cp * Math.sin(this.yaw))
      .addScaledVector(this.upAxis, Math.sin(this.pitch))
  }

  apply(camera: PerspectiveCamera, dt: number): void {
    this.direction(this.wantPos).multiplyScalar(this.dist).add(this.target)
    this.basis.lookAt(this.wantPos, this.target, this.upAxis)
    this.wantQuat.setFromRotationMatrix(this.basis)

    if (!this.started) {
      this.started = true
      camera.position.copy(this.wantPos)
      camera.quaternion.copy(this.wantQuat)
      return
    }
    // Frame rate independent easing, so a hitch does not overshoot the orbit.
    const k = 1 - Math.pow(this.ease, dt * 60 * 0.5)
    camera.position.lerp(this.wantPos, k)
    camera.quaternion.slerp(this.wantQuat, k)
  }

  /** Orthonormal pair spanning the plane perpendicular to the up axis. */
  private frame(): void {
    const seed = Math.abs(this.upAxis.z) < 0.9 ? AXIS_Z : AXIS_X
    this.e0.copy(seed).addScaledVector(this.upAxis, -seed.dot(this.upAxis)).normalize()
    this.e1.crossVectors(this.upAxis, this.e0).normalize()
  }
}

const AXIS_Z = new Vector3(0, 0, 1)
const AXIS_X = new Vector3(1, 0, 0)

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Where a click lands in a volume with no floor. Every order needs a plane to
 * resolve against and the interesting question is which one, so the plane is the
 * caller's decision and this is only the intersection.
 */
export function rayToPlane(ray: Ray, point: Vector3, normal: Vector3, out: Vector3): Vector3 | null {
  const denom = ray.direction.dot(normal)
  if (Math.abs(denom) < 1e-5) return null
  const t = (point.dot(normal) - ray.origin.dot(normal)) / denom
  if (t < 0) return null
  return out.copy(ray.direction).multiplyScalar(t).add(ray.origin)
}

const ndc = new Vector3()

export function screenRay(camera: PerspectiveCamera, x: number, y: number, out: Ray): Ray {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5)
  ndc.unproject(camera)
  out.origin.copy(camera.position)
  out.direction.copy(ndc).sub(camera.position).normalize()
  return out
}
