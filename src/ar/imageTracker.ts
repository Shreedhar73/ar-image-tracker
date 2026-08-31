/**
 * Owns one anchor Group per target in the session and keeps each glued to its
 * sticker.
 *
 * There is ONE pipeline module for the whole session, dispatching by
 * `detail.name`, not one module per target: pipeline module names must be
 * unique and every module is called for every event anyway, so N modules would
 * be N times the work to do the same dispatch.
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
  /** Scanning for stickers, none in view. This is when the scan hint shows. */
  Scanning = 'scanning',
  /** At least one sticker in view; its anchor pose is live. */
  Found = 'found',
  /** The last visible sticker went out of view. Its anchor is hidden. */
  Lost = 'lost',
}

/** One tracked sticker. */
export interface TrackedTarget {
  readonly name: string
  /**
   * Add the model and the shadow catcher to this; the tracker adds it to the
   * scene for you once the engine's three.js scene exists.
   * The sticker surface is this group's XY plane, +Z out of the paper.
   */
  readonly anchor: THREE.Group
  /** Sticker size in scene units, known from this target's first imagefound. */
  readonly scaledWidth: number | null
  readonly scaledHeight: number | null
  readonly visible: boolean
}

export interface ImageTrackerOptions {
  /** Must equal the `name` in each compiled target JSON. Other names are ignored. */
  targetNames: string[]
  /** Aggregate state across every target: Found while ANY sticker is in view. */
  onStateChange?: (state: TrackingState) => void
  /** Fires on every imagefound, after the pose is applied. */
  onFound?: (target: TrackedTarget) => void
  onLost?: (target: TrackedTarget) => void
}

export interface ImageTracker {
  /** Every anchor, in `targetNames` order. Add them all to the scene. */
  readonly targets: TrackedTarget[]
  readonly module: PipelineModule
  readonly state: TrackingState
  /** Stickers currently in view, most recently found last. */
  readonly visible: TrackedTarget[]
  get: (name: string) => TrackedTarget | undefined
}

interface MutableTarget extends TrackedTarget {
  scaledWidth: number | null
  scaledHeight: number | null
  visible: boolean
}

export function createImageTracker(options: ImageTrackerOptions): ImageTracker {
  const targets = new Map<string, MutableTarget>()
  for (const name of options.targetNames) {
    const anchor = new THREE.Group()
    anchor.name = `anchor:${name}`
    anchor.visible = false
    targets.set(name, {name, anchor, scaledWidth: null, scaledHeight: null, visible: false})
  }

  let state = TrackingState.Loading
  // Insertion order is find order, so the last entry is the sticker the child
  // most recently pointed at — which is the one the UI should follow.
  const visible = new Set<MutableTarget>()

  const setState = (next: TrackingState): void => {
    if (next === state) return
    state = next
    options.onStateChange?.(next)
  }

  const applyPose = (target: MutableTarget, detail: ImageTargetDetail): void => {
    const {anchor} = target
    anchor.position.set(detail.position.x, detail.position.y, detail.position.z)
    // Event gives {w, x, y, z}; Quaternion.set() takes (x, y, z, w).
    anchor.quaternion.set(detail.rotation.x, detail.rotation.y, detail.rotation.z, detail.rotation.w)
    anchor.scale.setScalar(detail.scale)
  }

  const module: PipelineModule = {
    name: 'sticker-image-tracker',
    listeners: [
      {
        // Target images finished loading and the engine started scanning.
        // Never firing means a target JSON's imagePath 404s.
        event: 'imagescanning',
        process: () => {
          if (visible.size === 0) setState(TrackingState.Scanning)
        },
      },
      {
        event: 'reality.imagefound',
        process: ({detail}) => {
          const target = targets.get(detail.name)
          if (!target) return
          if (detail.scaledWidth !== undefined) target.scaledWidth = detail.scaledWidth
          if (detail.scaledHeight !== undefined) target.scaledHeight = detail.scaledHeight
          applyPose(target, detail)
          target.anchor.visible = true
          target.visible = true
          // Re-insert so this target becomes the most recent, even if it was
          // already in the set.
          visible.delete(target)
          visible.add(target)
          setState(TrackingState.Found)
          options.onFound?.(target)
        },
      },
      {
        event: 'reality.imageupdated',
        process: ({detail}) => {
          const target = targets.get(detail.name)
          if (target) applyPose(target, detail)
        },
      },
      {
        event: 'reality.imagelost',
        process: ({detail}) => {
          const target = targets.get(detail.name)
          if (!target) return
          // Hide on the same frame — a visible anchor holding a stale pose is
          // the "ghost character floating off the sticker" bug.
          target.anchor.visible = false
          target.visible = false
          visible.delete(target)
          options.onLost?.(target)
          // Only when the LAST sticker leaves does the session stop tracking;
          // losing one of two in view must not hide the UI for the other.
          if (visible.size === 0) setState(TrackingState.Lost)
        },
      },
    ],
  }

  return {
    targets: [...targets.values()],
    module,
    get state() {
      return state
    },
    get visible() {
      return [...visible]
    },
    get: (name) => targets.get(name),
  }
}
