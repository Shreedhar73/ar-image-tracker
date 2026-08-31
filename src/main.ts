/**
 * Boot: resolve the campaign, wait for the start tap, bring up the engine,
 * then wire the tracker, the scene and the UI together.
 *
 * There is no render loop here. XR8.Threejs.pipelineModule() renders once per
 * camera frame; our per-frame work rides along in the pipeline module below.
 */
import * as THREE from 'three'

import {getCampaign, loadTargetData, resolveCampaignId} from './config/campaigns'
import {createImageTracker, TrackingState} from './ar/imageTracker'
import {loadXR8, startAR, xrScene} from './ar/xr8'
import type {PipelineModule} from './ar/xr8'
import {fitToTarget, setupScene} from './three/ThreeScene'
import {fitModelToTarget, loadModel} from './three/ModelLoader'
import {createAnimationController} from './three/AnimationController'
import type {AnimationController} from './three/AnimationController'
import {createAnimationButtons} from './ui/animationButtons'
import {createScanHint} from './ui/scanHint'
import {createDebugPanel, isDebugEnabled} from './ui/debugPanel'
import {detectUnsupported, showErrorScreen} from './ui/errorScreen'
import {showStartScreen} from './ui/startScreen'

async function main(): Promise<void> {
  const ui = document.getElementById('ui')
  const canvas = document.getElementById('camerafeed')
  if (!(ui instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('index.html is missing #ui or #camerafeed')
  }

  const debug = isDebugEnabled(location.search) ? createDebugPanel(ui) : null

  const unsupported = detectUnsupported()
  if (unsupported) {
    showErrorScreen(ui, unsupported)
    return
  }

  const campaignId = resolveCampaignId(location)
  const campaign = getCampaign(campaignId)
  if (!campaign) {
    showErrorScreen(ui, 'unknown-campaign', `id=${String(campaignId)}`)
    return
  }
  debug?.set('campaign', campaign.targetName)

  await showStartScreen(ui)

  // Engine, target and model are independent fetches; overlap them behind the
  // start tap so the camera comes up while the GLB is still downloading.
  const modelPromise = loadModel(campaign.model)
  modelPromise.catch(() => undefined) // handled below; this only silences the race
  // The engine is loaded outside the try below on purpose: a missing or 404'd
  // /external/xr/xr.js is the exact failure ?debug=1 exists to diagnose, and
  // must never be reported as a target problem.
  await loadXR8()

  let imageTargetData: unknown[]
  try {
    imageTargetData = [await loadTargetData(campaign)]
  } catch (error) {
    if (!debug) {
      showErrorScreen(ui, 'assets-missing', String(error))
      return
    }
    // ?debug=1 boots the camera with no targets, so the engine and camera can
    // be verified on a phone before any artwork has been compiled.
    console.warn('[debug] continuing with no image targets:', error)
    debug.set('targets', 'none (debug)')
    imageTargetData = []
  }

  const scanHint = createScanHint(ui)
  const buttons = createAnimationButtons(ui, campaign.animations, (name) => {
    animation?.play(name)
    buttons.setActive(name)
  })

  let animation: AnimationController | null = null

  const tracker = createImageTracker({
    targetName: campaign.targetName,
    onStateChange: (state) => {
      debug?.set('tracking', state)
      const found = state === TrackingState.Found
      scanHint.setVisible(!found)
      buttons.setVisible(found)
      if (found) {
        animation?.play(campaign.idleAnim)
        buttons.setActive(campaign.idleAnim)
      }
    },
    onFound: (detail) => {
      if (detail.scaledWidth !== undefined && detail.scaledHeight !== undefined) {
        onStickerSize(detail.scaledWidth, detail.scaledHeight)
      }
    },
  })

  const clock = new THREE.Clock()
  let rig: ReturnType<typeof setupScene> | null = null
  let model: THREE.Object3D | null = null
  let sized = false

  /** Sticker dimensions arrive with the first detection, not before. */
  const onStickerSize = (width: number, height: number): void => {
    debug?.set('sticker', `${width.toFixed(3)} x ${height.toFixed(3)} m`)
    if (sized || !rig || !model) return
    sized = true
    fitToTarget(rig, width, height)
    tracker.anchor.add(fitModelToTarget(model, width, campaign.scale))
  }

  const sceneModule: PipelineModule = {
    name: 'sticker-scene',
    onStart: () => {
      const xr = xrScene()
      xr.scene.add(tracker.anchor)
      rig = setupScene(xr, tracker.anchor)
      clock.start()

      modelPromise.then(
        (loaded) => {
          model = loaded.object
          animation = createAnimationController(loaded.object, loaded.animations)
          debug?.set('clips', animation.available.join(', ') || 'none')
          const {scaledWidth, scaledHeight} = tracker
          // The sticker may already have been detected while the GLB loaded.
          if (scaledWidth !== null && scaledHeight !== null) {
            onStickerSize(scaledWidth, scaledHeight)
          }
        },
        (error: unknown) => showErrorScreen(ui, 'assets-missing', String(error)),
      )
    },
    onUpdate: () => animation?.update(clock.getDelta()),
  }

  startAR({
    canvas,
    imageTargetData,
    modules: [sceneModule, tracker.module],
    onCameraStatusChange: (status) => {
      debug?.set('camera', status)
      if (status === 'failed') showErrorScreen(ui, 'camera-denied')
    },
    onException: (error) => showErrorScreen(ui, 'unknown', String(error)),
  })
}

main().catch((error: unknown) => {
  const ui = document.getElementById('ui')
  if (ui instanceof HTMLElement) showErrorScreen(ui, 'unknown', String(error))
  else console.error(error)
})
