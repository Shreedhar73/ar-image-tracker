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
 *
 * ONE AT A TIME: only the most recently found sticker is on screen. Scanning a
 * second sticker hides the first even while the engine can still see it — the
 * child is looking at the new character, not running a zoo. A sticker hidden
 * that way is still `tracked`, so it comes back by itself when the shown one is
 * dropped, without needing to be re-scanned.
 *
 * HOLDING: `imagelost` does NOT hide the character. World tracking is on, so
 * the pose the engine last gave us is a WORLD pose that stays valid while the
 * phone moves — the character keeps sitting where the sticker is even though
 * the engine has stopped recognising it. Hiding on `imagelost` is what makes
 * the model blink out the moment the camera tilts, which is the whole reason
 * this exists. A held anchor is dropped only once it leaves the camera
 * frustum: by then the child has pointed the phone somewhere else and the
 * removal is invisible.
 */
import * as THREE from 'three'

import {xrScene} from './xr8'
import type {ImageTargetDetail, PipelineModule, TrackingStatusDetail} from './xr8'

export enum TrackingState {
  /** Engine running, target images not loaded yet. */
  Loading = 'loading',
  /** Scanning for stickers, none in view. This is when the scan hint shows. */
  Scanning = 'scanning',
  /** At least one sticker on screen — tracked live, or held after imagelost. */
  Found = 'found',
  /** The last shown sticker left the frustum. Its anchor is hidden. */
  Lost = 'lost',
}

/**
 * Frames a held anchor must stay outside the frustum before it is dropped.
 * Hysteresis against a pan that grazes the screen edge; ~0.5 s at 30 fps.
 */
const FRAMES_OUTSIDE_BEFORE_HIDE = 15

/**
 * Sphere radius for the frustum test, in sticker widths. The character stands
 * ABOVE the anchor origin, so a point test would hide it while its head was
 * still on screen; the sphere is centred on the origin and has to reach the
 * head. `campaign.scale` (2 for every character today) multiplies the model
 * against the sticker width and the tracker does not know it, so this is
 * deliberately generous: too large only delays hiding by a pan, which is the
 * direction this whole file is biased in, while too small is the blink-out bug
 * coming back at the screen edge.
 */
const HOLD_BOUNDS_FACTOR = 3

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
  /** On screen. At most one target is visible at a time — the last one found. */
  readonly visible: boolean
  /**
   * The engine can see this sticker right now. True whether or not it is on
   * screen: a sticker hidden behind a more recently scanned one stays tracked,
   * and that is what lets it be promoted back when the other one goes.
   */
  readonly tracked: boolean
}

export interface ImageTrackerOptions {
  /** Must equal the `name` in each compiled target JSON. Other names are ignored. */
  targetNames: string[]
  /** Aggregate state across every target: Found while ANY sticker is on screen. */
  onStateChange?: (state: TrackingState) => void
  /**
   * Fires when a sticker BECOMES visible — not on every `imagefound`. A sticker
   * that is refound while still held was never off screen, so re-running this
   * would restart the idle clip over whatever animation the child had chosen.
   */
  onFound?: (target: TrackedTarget) => void
  /**
   * Fires when a shown sticker is dropped: a frustum exit, or another sticker
   * being scanned. Not `imagelost`.
   */
  onLost?: (target: TrackedTarget) => void
  /** SLAM/world-tracking status, straight from the engine. Debug panel only. */
  onTrackingStatus?: (status: string, reason?: string) => void
}

export interface ImageTracker {
  /** Every anchor, in `targetNames` order. Add them all to the scene. */
  readonly targets: TrackedTarget[]
  readonly module: PipelineModule
  readonly state: TrackingState
  /** Stickers on screen, most recently found last. */
  readonly visible: TrackedTarget[]
  get: (name: string) => TrackedTarget | undefined
}

interface MutableTarget extends TrackedTarget {
  scaledWidth: number | null
  scaledHeight: number | null
  visible: boolean
  tracked: boolean
  framesOutside: number
}

export function createImageTracker(options: ImageTrackerOptions): ImageTracker {
  const targets = new Map<string, MutableTarget>()
  for (const name of options.targetNames) {
    const anchor = new THREE.Group()
    anchor.name = `anchor:${name}`
    anchor.visible = false
    targets.set(name, {
      name,
      anchor,
      scaledWidth: null,
      scaledHeight: null,
      visible: false,
      tracked: false,
      framesOutside: 0,
    })
  }

  let state = TrackingState.Loading
  // Holds at most one target — the sticker the child most recently pointed at.
  // A Set rather than a single field because `ImageTracker.visible` is a list
  // and callers iterate it.
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

  /**
   * Puts one sticker on screen and takes every other one off it. Shared by
   * `imagefound` and by the promotion in `hide()` below, so a sticker that
   * arrives either way gets the same treatment.
   */
  const show = (target: MutableTarget): void => {
    target.anchor.visible = true
    target.visible = true
    target.framesOutside = 0
    visible.add(target)
    // The newcomer is added BEFORE the others are dropped, so the set is never
    // empty in between: the UI would otherwise flick through Lost on every
    // change of sticker.
    for (const other of [...visible]) {
      if (other !== target) hide(other)
    }
    setState(TrackingState.Found)
    options.onFound?.(target)
  }

  const hide = (target: MutableTarget): void => {
    target.anchor.visible = false
    target.visible = false
    target.framesOutside = 0
    visible.delete(target)
    options.onLost?.(target)
    if (visible.size > 0) return
    // Nothing on screen. If the engine can still see another sticker — one that
    // was hidden because this one was scanned later — put it back up rather
    // than making the child re-scan a sticker they are already pointing at.
    const next = [...targets.values()].find((each) => each !== target && each.tracked)
    if (next) show(next)
    else setState(TrackingState.Lost)
  }

  // Reused every frame: allocating a Matrix4 and a Frustum per frame is garbage
  // the phone has to collect during rendering.
  const frustum = new THREE.Frustum()
  const viewProjection = new THREE.Matrix4()
  const bounds = new THREE.Sphere()

  const dropHeldTargetsOutOfView = (): void => {
    // Held = on screen, but the engine has stopped recognising the sticker.
    let anyHeld = false
    for (const target of targets.values()) {
      if (target.visible && !target.tracked) {
        anyHeld = true
        break
      }
    }
    if (!anyHeld) return

    const {camera} = xrScene()
    // XrController moves the camera every frame; in onUpdate its matrixWorld
    // (and so matrixWorldInverse) is otherwise one frame stale.
    camera.updateMatrixWorld()
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(viewProjection)

    for (const target of targets.values()) {
      if (!target.visible || target.tracked) continue
      const extent = Math.max(target.scaledWidth ?? 0, target.scaledHeight ?? 0)
      target.anchor.getWorldPosition(bounds.center)
      bounds.radius = extent * target.anchor.scale.x * HOLD_BOUNDS_FACTOR
      if (frustum.intersectsSphere(bounds)) {
        target.framesOutside = 0
        continue
      }
      target.framesOutside += 1
      if (target.framesOutside >= FRAMES_OUTSIDE_BEFORE_HIDE) hide(target)
    }
  }

  const module: PipelineModule = {
    name: 'sticker-image-tracker',
    onUpdate: dropHeldTargetsOutOfView,
    listeners: [
      {
        // SLAM state. Nothing here reads it — it exists so a phone can say
        // whether world tracking had converged when a sticker was held.
        event: 'trackingStatus',
        process: ({detail}: {detail: TrackingStatusDetail}) =>
          options.onTrackingStatus?.(detail.status, detail.reason),
      },
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
        process: ({detail}: {detail: ImageTargetDetail}) => {
          const target = targets.get(detail.name)
          if (!target) return
          target.tracked = true
          if (detail.scaledWidth !== undefined) target.scaledWidth = detail.scaledWidth
          if (detail.scaledHeight !== undefined) target.scaledHeight = detail.scaledHeight
          applyPose(target, detail)
          // A sticker that is already on screen was only ever held: correcting
          // its pose is the whole event. Re-running the find would restart the
          // idle clip over whatever the child had chosen.
          if (target.visible) {
            target.framesOutside = 0
            return
          }
          show(target)
        },
      },
      {
        event: 'reality.imageupdated',
        process: ({detail}: {detail: ImageTargetDetail}) => {
          const target = targets.get(detail.name)
          if (target) applyPose(target, detail)
        },
      },
      {
        event: 'reality.imagelost',
        process: ({detail}: {detail: ImageTargetDetail}) => {
          const target = targets.get(detail.name)
          if (!target) return
          // The engine has stopped recognising this sticker. If it is on screen
          // it is now HELD on its last world pose — dropHeldTargetsOutOfView
          // takes it off once the camera is pointed away. If it was hidden
          // behind a later scan, it simply stops being a promotion candidate.
          target.tracked = false
          target.framesOutside = 0
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
