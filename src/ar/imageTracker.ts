/**
 * Owns one anchor Group per campaign target and keeps it glued to the sticker.
 *
 * The pose is applied inside the event handler, never polled per frame — the
 * MindAR POC read the matrix in its own rAF loop and was reliably one frame
 * behind the camera feed.
 */
import * as THREE from 'three'

import type {ImageTargetDetail, PipelineModule} from './xr8'

export enum TrackingState {
  /** Engine running, target images not loaded yet. */
  Loading = 'loading',
  /** Scanning for the sticker. This is when the scan hint shows. */
  Scanning = 'scanning',
  /** Sticker in view, anchor pose is live. */
  Found = 'found',
  /** Sticker went out of view. Anchor is hidden. */
  Lost = 'lost',
}

export interface ImageTrackerOptions {
  /** Must equal `name` in the compiled target JSON. Other names are ignored. */
  targetName: string
  onStateChange?: (state: TrackingState) => void
  /** Fires on every imagefound, after the pose is applied. */
  onFound?: (detail: ImageTargetDetail) => void
}

export interface ImageTracker {
  /**
   * Add the model and the shadow catcher to this, and add it to the scene
   * yourself — the scene only exists once the engine's three.js module has
   * started, which is after this tracker has to be built.
   * The sticker surface is this group's XY plane, +Z out of the paper.
   */
  readonly anchor: THREE.Group
  readonly module: PipelineModule
  readonly state: TrackingState
  /** Sticker size in scene units, known from the first imagefound. */
  readonly scaledWidth: number | null
  readonly scaledHeight: number | null
}

export function createImageTracker(options: ImageTrackerOptions): ImageTracker {
  const anchor = new THREE.Group()
  anchor.name = `anchor:${options.targetName}`
  anchor.visible = false

  let state = TrackingState.Loading
  let scaledWidth: number | null = null
  let scaledHeight: number | null = null

  const setState = (next: TrackingState): void => {
    if (next === state) return
    state = next
    options.onStateChange?.(next)
  }

  const applyPose = (detail: ImageTargetDetail): void => {
    anchor.position.set(detail.position.x, detail.position.y, detail.position.z)
    // Event gives {w, x, y, z}; Quaternion.set() takes (x, y, z, w).
    anchor.quaternion.set(detail.rotation.x, detail.rotation.y, detail.rotation.z, detail.rotation.w)
    anchor.scale.setScalar(detail.scale)
  }

  const isOurs = (detail: ImageTargetDetail): boolean => detail.name === options.targetName

  const module: PipelineModule = {
    name: `sticker-image-tracker:${options.targetName}`,
    listeners: [
      {
        // Target images finished loading and the engine started scanning.
        // Never firing means the target JSON's imagePath 404s.
        event: 'imagescanning',
        process: () => setState(TrackingState.Scanning),
      },
      {
        event: 'reality.imagefound',
        process: ({detail}) => {
          if (!isOurs(detail)) return
          if (detail.scaledWidth !== undefined) scaledWidth = detail.scaledWidth
          if (detail.scaledHeight !== undefined) scaledHeight = detail.scaledHeight
          applyPose(detail)
          anchor.visible = true
          setState(TrackingState.Found)
          options.onFound?.(detail)
        },
      },
      {
        event: 'reality.imageupdated',
        process: ({detail}) => {
          if (!isOurs(detail)) return
          applyPose(detail)
        },
      },
      {
        event: 'reality.imagelost',
        process: ({detail}) => {
          if (!isOurs(detail)) return
          // Hide on the same frame — a visible anchor holding a stale pose is
          // the "ghost character floating off the sticker" bug.
          anchor.visible = false
          setState(TrackingState.Lost)
        },
      },
    ],
  }

  return {
    anchor,
    module,
    get state() {
      return state
    },
    get scaledWidth() {
      return scaledWidth
    },
    get scaledHeight() {
      return scaledHeight
    },
  }
}
