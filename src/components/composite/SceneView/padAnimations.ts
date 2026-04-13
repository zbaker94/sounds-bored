/** Shared animation constants for pad grid components (SceneView + PadButton). */

/** Per-pad stagger delay in milliseconds. Applied to both enter and flip animations. */
export const PAD_STAGGER_MS = 30;

/** Duration of the pad-enter CSS keyframe animation in seconds. */
const PAD_ENTER_DURATION_S = 0.15;

/** Duration of the 3D flip CSS transition in milliseconds. */
export const PAD_FLIP_DURATION_MS = 350;

/** Easing for the 3D flip CSS transition (spring-like overshoot). */
export const PAD_FLIP_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Build the CSS animation string for a pad entering the grid.
 * @param delayMs - Stagger delay in milliseconds (typically `index * PAD_STAGGER_MS`).
 */
export function padEnterAnimation(delayMs: number): string {
  return `pad-enter ${PAD_ENTER_DURATION_S}s ease-out ${delayMs / 1000}s both`;
}
