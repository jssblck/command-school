/**
 * Every point sprite in the game is sized in world units and converted to pixels
 * in its own vertex shader, so they all need the same number: how many pixels a
 * one unit sphere covers at one unit of depth. Sharing the uniform object means
 * the resize handler sets it once and the ships, the dust and the particles all
 * agree.
 */
export const uPointScale = { value: 600 }
