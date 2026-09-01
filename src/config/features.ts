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
