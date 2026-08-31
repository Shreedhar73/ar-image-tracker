/**
 * The single 8th Wall boundary. Every `any` in this project lives in this
 * file; everything downstream sees the typed surface declared here.
 *
 * API verified 2026-08-31 against https://8thwall.org/docs/api/engine.
 * The hosted platform retired 2026-02-28 — there is no app key and no
 * console-uploaded target. Tracking comes from the engine binary served
 * from our own origin at /external/xr/xr.js.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

import * as THREE from 'three'
import {XR8Promise} from '@8thwall/engine-binary'

/** Payload of `reality.imagefound` / `imageupdated` / `imagelost`. */
export interface ImageTargetDetail {
  name: string
  type: 'FLAT' | 'CYLINDRICAL' | 'CONICAL'
  position: {x: number; y: number; z: number}
  /** Quaternion, w first. `THREE.Quaternion.set()` takes (x, y, z, w). */
  rotation: {w: number; x: number; y: number; z: number}
  scale: number
  /** FLAT targets only — metres. This is what model + shadow size derive from. */
  scaledWidth?: number
  scaledHeight?: number
}

export interface XrScene {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
}

export interface PipelineModule {
  /** Unique across the pipeline; the engine rejects duplicates. */
  name: string
  onStart?: (args: {canvas: HTMLCanvasElement}) => void
  onAttach?: () => void
  onUpdate?: () => void
  onDetach?: () => void
  onException?: (error: unknown) => void
  onCameraStatusChange?: (args: {status: string}) => void
  listeners?: {event: string; process: (event: {detail: ImageTargetDetail}) => void}[]
}

/**
 * Camera permission outcome. The engine reports 'requesting', 'hasStream',
 * 'hasVideo' and 'failed'; kept as a plain string because the list is the
 * engine's to change and an unknown value must not become a type error.
 */
export type CameraStatus = string

let xr8: any = null

/**
 * Resolves once /external/xr/xr.js has loaded and published window.XR8.
 * A hang here means the script tag is missing from the served HTML or the
 * static-copy step did not put the engine in dist/external/xr/.
 */
export async function loadXR8(): Promise<void> {
  xr8 = await XR8Promise
}

function requireXR8(): any {
  if (!xr8) throw new Error('loadXR8() must resolve before the AR pipeline is built')
  return xr8
}

export interface StartArOptions {
  canvas: HTMLCanvasElement
  /** Parsed target JSON produced by @8thwall/image-target-cli. Empty = no image tracking. */
  imageTargetData: unknown[]
  /** Our modules, appended after the engine's own. */
  modules: PipelineModule[]
  onCameraStatusChange?: (status: CameraStatus) => void
  onException?: (error: unknown) => void
}

/**
 * Boot order is the whole point of this function — keep it readable in one
 * pass and do not split it up:
 *
 *   1. window.THREE, because XR8.Threejs.pipelineModule() reads the global.
 *   2. XrController.configure(), because `disableWorldTracking` and
 *      `imageTargetData` are only honoured if set before both
 *      XrController.pipelineModule() and XR8.run().
 *   3. addCameraPipelineModules(), engine modules first, ours last.
 *   4. XR8.run().
 */
export function startAR(options: StartArOptions): void {
  const XR8 = requireXR8()

  ;(window as any).THREE = THREE

  XR8.XrController.configure({
    disableWorldTracking: true, // stickers are image targets only; no SLAM
    imageTargetData: options.imageTargetData,
  })

  const statusModule: PipelineModule = {
    name: 'sticker-status',
    onCameraStatusChange: ({status}) => options.onCameraStatusChange?.(status),
    onException: (error) => options.onException?.(error),
  }

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(), // draws the camera feed
    XR8.Threejs.pipelineModule(), // owns scene/camera/renderer + render()
    XR8.XrController.pipelineModule(), // 6DoF pose + image-target events
    statusModule,
    ...options.modules,
  ])

  XR8.run({canvas: options.canvas, allowedDevices: XR8.XrConfig.device().ANY})
}

/** The three.js objects the engine created. Plain three.js — treat them as ours. */
export function xrScene(): XrScene {
  return requireXR8().Threejs.xrScene() as XrScene
}

/** True once the engine has published itself. Used by the unsupported-browser check. */
export function isEngineLoaded(): boolean {
  return xr8 !== null
}
