import { LONGEST_RANGE, slotSpacing } from './classes'
import type { ClassId, Stance } from './types'
import { anyPerp, cross, normalize, v3, type Vec3 } from './vec3'

const GOLDEN = 2.399963229728653

/**
 * Where hull `slot` sits relative to the squadron anchor.
 *
 * Stance is the one tactical dial the player has below the level of orders, and
 * each shape is a real trade:
 *
 *   tight  concentrates fire into a small volume, and dies to one device shot
 *   open   a wedge: good bearing on the axis of advance, moderate footprint
 *   wide   a thin wall across the axis: everything bears, nothing clusters
 *
 * The layout is a golden-angle spiral so slots stay stable as hulls die: slot 4
 * is always in the same place, which keeps formations from churning mid-fight.
 */
export function slotOffset(cls: ClassId, stance: Stance, slot: number, facing: Vec3): Vec3 {
  const spacing = slotSpacing(cls)
  const right = anyPerp(facing)
  const up = cross(facing, right)

  const spread = stance === 'tight' ? 0.66 : stance === 'open' ? 1.12 : 2.05
  const r = spacing * spread * Math.sqrt(slot + 0.45)
  const th = slot * GOLDEN
  const u = Math.cos(th) * r
  const v = Math.sin(th) * r

  let depth: number
  if (stance === 'tight') {
    // Three shallow layers, so a tight ball still has volume to shoot from.
    depth = ((slot % 3) - 1) * spacing * 0.72
  } else if (stance === 'open') {
    // Trail the flanks backwards to make the classic arrowhead.
    depth = -r * 0.5
  } else {
    // A wall wants to be flat; only enough jitter to stop hulls overlapping.
    depth = ((slot % 2) * 2 - 1) * spacing * 0.3
  }

  return v3(
    right.x * u + up.x * v + facing.x * depth,
    right.y * u + up.y * v + facing.y * depth,
    right.z * u + up.z * v + facing.z * depth,
  )
}

/** Radius of the volume a squadron of `n` hulls occupies in the given stance. */
export function formationRadius(cls: ClassId, stance: Stance, n: number): number {
  const spacing = slotSpacing(cls)
  const spread = stance === 'tight' ? 0.66 : stance === 'open' ? 1.12 : 2.05
  return spacing * spread * Math.sqrt(Math.max(1, n)) + spacing
}

/**
 * Distance between squadron centres that a squadron tries to hold on its target.
 *
 * This is measured centre to centre, not edge to edge, and that distinction is
 * the whole game: a formation has real depth, so a squadron sitting exactly at
 * its weapon range only ever gets its nose ships into the fight. Brawlers
 * therefore aim well inside their own reach and let the two volumes interleave,
 * while lances hold a line far enough back that even their trailing hulls bear.
 */
export function standoff(cls: ClassId, range: number): number {
  switch (cls) {
    case 'lance':
      return range * 0.72
    case 'needle':
      return range * 0.42
    case 'aegis':
      return range * 0.4
    case 'keel':
      return range * 0.62
    case 'eye':
      // Scouts shadow the enemy from outside anyone's weapons envelope, which means the
      // number has to clear the envelope rather than sit on its lip. It was a flat 240,
      // exactly a lance's reach, and this distance is centre to centre against a
      // formation with real depth: a scout holding 240 was inside the leading hulls of
      // whatever it was watching, so the order that means "go and keep eyes on them"
      // was spending the fleet's eyesight. A scout still sees 470, so the margin costs
      // it nothing it was bought for.
      return LONGEST_RANGE * 1.4
  }
}

export const facingToward = (from: Vec3, to: Vec3): Vec3 => {
  const d = normalize({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z })
  return d.x === 0 && d.y === 0 && d.z === 0 ? v3(0, 0, 1) : d
}
