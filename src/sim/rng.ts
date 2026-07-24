/**
 * Seeded RNG so a scenario replays identically. Determinism is what lets the
 * headless balance harness in tools/ compare fleet loadouts meaningfully.
 */
export interface Rng {
  (): number
  int(maxExclusive: number): number
  range(min: number, max: number): number
  /** Uniform point inside the unit sphere, for scatter and debris. */
  sphere(radius: number): { x: number; y: number; z: number }
  pick<T>(items: readonly T[]): T
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = next as Rng
  rng.int = (maxExclusive: number) => Math.floor(next() * maxExclusive)
  rng.range = (min: number, max: number) => min + next() * (max - min)
  rng.sphere = (radius: number) => {
    // Rejection sampling keeps the distribution uniform without trig.
    for (;;) {
      const x = next() * 2 - 1
      const y = next() * 2 - 1
      const z = next() * 2 - 1
      if (x * x + y * y + z * z <= 1) return { x: x * radius, y: y * radius, z: z * radius }
    }
  }
  rng.pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]
  return rng
}
