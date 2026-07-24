import { Color } from 'three'
import type { Side } from '../sim/types'

/**
 * The whole look rests on colour temperature doing the work that models and
 * textures normally do. Ships are points of light, so a hull is only ever a
 * tint and a brightness: cold for us, warm for them, and nothing in between.
 */
export const SIDE_CORE: Record<Side, Color> = {
  blue: new Color('#b6e8ff'),
  red: new Color('#ffc887'),
}

export const SIDE_HULL: Record<Side, Color> = {
  blue: new Color('#4c9ed4'),
  red: new Color('#d9773a'),
}

/** Hulls lerp toward this as they lose structure, so a worn wing looks worn. */
export const DAMAGE = new Color('#ff4a2a')

/** Remembered contacts: cold, dim, and deliberately colourless. */
export const GHOST = new Color('#63788c')

export const DEVICE = new Color('#dda6ff')
export const DEVICE_HOT = new Color('#ffe9ff')

/**
 * Interface colours. They are the only things on screen that are not part of the
 * volume, so they are held apart from it: a flatter, more saturated cyan than
 * anything a hull is allowed to be, and a warm amber reserved for aggression.
 */
export const SELECT = new Color('#7ff0e0')
export const ORDER = new Color('#57c9ff')
export const ATTACK = new Color('#ff8f5a')

export const BODY_WIRE = new Color('#33465a')
export const RING_DUST = new Color('#4a5a6b')
export const GRID_LINE = new Color('#152532')
