/**
 * Minimal vector math for the simulation layer.
 *
 * The sim deliberately does not import three.js so that it can run headless in
 * Node for balance testing. Functions come in two flavours: allocating helpers
 * for clarity, and `*Into` variants for the per-ship hot loops.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })

export const set = (o: Vec3, x: number, y: number, z: number): Vec3 => {
  o.x = x
  o.y = y
  o.z = z
  return o
}
export const copy = (o: Vec3, a: Vec3): Vec3 => set(o, a.x, a.y, a.z)

export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s)

export const addInto = (o: Vec3, a: Vec3): Vec3 => set(o, o.x + a.x, o.y + a.y, o.z + a.z)
export const scaledAddInto = (o: Vec3, a: Vec3, s: number): Vec3 =>
  set(o, o.x + a.x * s, o.y + a.y * s, o.z + a.z * s)
export const scaleInto = (o: Vec3, s: number): Vec3 => set(o, o.x * s, o.y * s, o.z * s)

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const len = (a: Vec3): number => Math.sqrt(dot(a, a))
export const len2 = (a: Vec3): number => dot(a, a)

export const dist = (a: Vec3, b: Vec3): number => Math.sqrt(dist2(a, b))
export const dist2 = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)

export const normalize = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 1e-9 ? scale(a, 1 / l) : v3(0, 0, 0)
}

export const normalizeInto = (o: Vec3): Vec3 => {
  const l = len(o)
  return l > 1e-9 ? scaleInto(o, 1 / l) : o
}

export const clampLenInto = (o: Vec3, max: number): Vec3 => {
  const l2 = len2(o)
  if (l2 > max * max) scaleInto(o, max / Math.sqrt(l2))
  return o
}

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)

export const lerpInto = (o: Vec3, b: Vec3, t: number): Vec3 =>
  set(o, o.x + (b.x - o.x) * t, o.y + (b.y - o.y) * t, o.z + (b.z - o.z) * t)

/** Any unit vector perpendicular to `a`, chosen to stay stable near the poles. */
export const anyPerp = (a: Vec3): Vec3 => {
  const up = Math.abs(a.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)
  return normalize(cross(a, up))
}

/**
 * Closest approach of the segment `a`..`b` to point `p`, as a distance.
 * Used for line of fire checks against planets and for beam hit tests.
 */
export const segmentDist = (a: Vec3, b: Vec3, p: Vec3): number => {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const l2 = abx * abx + aby * aby + abz * abz
  if (l2 < 1e-9) return dist(a, p)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = a.x + abx * t - p.x
  const dy = a.y + aby * t - p.y
  const dz = a.z + abz * t - p.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
