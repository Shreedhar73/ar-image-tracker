/**
 * Build-time feature switches.
 *
 * A switch here is an UNPLUG, not a deletion: the feature's code stays whole
 * and compiled, only its wiring in `main.ts` is skipped. Flip the constant to
 * plug it back in — nothing else to restore.
 */

/**
 * Photo / video capture (`src/capture/capture.ts`, `ui/captureBar.ts`,
 * `ui/capturePreview.ts`).
 *
 * Off for the POC: scope call, not a defect. The code is kept for later.
 */
export const CAPTURE_ENABLED: boolean = false

/**
 * The animation button bar (`ui/animationButtons.ts`).
 *
 * Off for the POC: the character plays its idle clip and nothing else is
 * offered. Same deal as capture — the bar's code stays whole, only `main.ts`
 * stops building it, so every use of it there is optional-chained.
 */
export const ANIMATION_BUTTONS_ENABLED: boolean = false
