/**
 * Boot: resolve the session, wait for the start tap, bring up the engine,
 * then wire the tracker, the scene and the UI together.
 *
 * A session tracks a PACK of stickers, not one sticker. Everything below that
 * used to be a single value — the anchor, the shadow catcher, the model, the
 * mixer, the button bar — is per target, keyed by target name.
 *
 * There is no render loop here. XR8.Threejs.pipelineModule() renders once per
 * camera frame; our per-frame work rides along in the pipeline module below.
 */
import * as THREE from 'three'

import {loadSessionTargets, resolveSession} from './config/campaigns'
import type {CampaignEntry} from './config/campaigns'
import {createImageTracker, TrackingState} from './ar/imageTracker'
import type {TrackedTarget} from './ar/imageTracker'
import {loadXR8, startAR, worldTrackingAvailable, xrScene} from './ar/xr8'
import type {PipelineModule} from './ar/xr8'
import {createAnchorRig, fitToTarget, setupRenderer} from './three/ThreeScene'
import type {SceneRig} from './three/ThreeScene'
import {fitModelToTarget, loadModel} from './three/ModelLoader'
import type {LoadedModel} from './three/ModelLoader'
import {createAnimationController} from './three/AnimationController'
import type {AnimationController} from './three/AnimationController'
import {capturePhoto, createRecorder, isRecordingSupported, releaseCapture, shareCapture} from './capture/capture'
import type {Capture} from './capture/capture'
import {ANIMATION_BUTTONS_ENABLED, CAPTURE_ENABLED} from './config/features'
import {createAnimationButtons} from './ui/animationButtons'
import type {AnimationButtons} from './ui/animationButtons'
import {createCaptureBar} from './ui/captureBar'
import type {CaptureBar} from './ui/captureBar'
import {showCapturePreview} from './ui/capturePreview'
import {createScanHint} from './ui/scanHint'
import {createDebugPanel, isDebugEnabled} from './ui/debugPanel'
import {detectUnsupported, showErrorScreen} from './ui/errorScreen'
import {showStartScreen} from './ui/startScreen'

/** Everything one sticker in the session owns. */
interface TargetRuntime {
  campaign: CampaignEntry
  target: TrackedTarget
  rig: SceneRig
  animation: AnimationController | null
  /** True once the model has been fitted to this sticker and parented to it. */
  placed: boolean
}

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

  const session = resolveSession(location)
  if (!session) {
    showErrorScreen(ui, 'unknown-campaign', `no campaign or pack at ${location.pathname}${location.search}`)
    return
  }
  debug?.set('session', `${session.route}:${session.id}`)
  debug?.set('tracked', session.campaigns.map((campaign) => campaign.id).join(', '))
  debug?.set('primary', session.primary?.id ?? 'none')

  await showStartScreen(ui)

  /**
   * One in-flight load per campaign, cached by id: a sticker that is found,
   * lost and found again must not download its GLB twice, and two stickers in
   * view at once must not race each other for the same model.
   */
  const models = new Map<string, Promise<LoadedModel>>()
  const modelFor = (campaign: CampaignEntry): Promise<LoadedModel> => {
    let pending = models.get(campaign.id)
    if (!pending) {
      pending = loadModel(campaign.model)
      pending.catch(() => undefined) // handled at the call site; this silences the race
      models.set(campaign.id, pending)
    }
    return pending
  }

  // The sticker whose QR was scanned is the one the child is holding, so its
  // model downloads behind the start tap, in parallel with the engine. The rest
  // of the pack loads on first sight — 20 characters is far more than a phone
  // should hold, and most of them will never be pointed at in this session.
  if (session.primary) void modelFor(session.primary)

  // The engine is loaded outside the try below on purpose: a missing or 404'd
  // /external/xr/xr.js is the exact failure ?debug=1 exists to diagnose, and
  // must never be reported as a target problem.
  await loadXR8()

  let imageTargetData: unknown[]
  try {
    imageTargetData = await loadSessionTargets(session)
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
  // Unplugged for the POC — see ANIMATION_BUTTONS_ENABLED. Null means no bar is
  // built and the character just plays its idle clip; every use below is
  // optional-chained, so flipping the flag is the only change needed.
  const buttons: AnimationButtons | null = ANIMATION_BUTTONS_ENABLED
    ? createAnimationButtons(ui, (name) => {
        active?.animation?.play(name)
        buttons?.setActive(name)
      })
    : null

  /** The sticker the UI is following: the one most recently brought into view. */
  let active: TargetRuntime | null = null
  const runtimes = new Map<string, TargetRuntime>()

  // Unplugged for the POC — see CAPTURE_ENABLED. Null here means the bar is
  // never built and the whole capture layer stays cold; every use of it below
  // is optional-chained, so flipping the flag is the only change needed.
  const captureBar = CAPTURE_ENABLED
    ? wireCapture(ui, canvas, () => active?.campaign.id ?? session.id)
    : null

  // False on a laptop: the engine will not run SLAM there, so the tracker
  // must drop a lost sticker instead of holding it. Phones are unaffected.
  const slam = worldTrackingAvailable()
  debug?.set('world', slam ? 'slam on' : 'slam off (non-mobile device)')

  const tracker = createImageTracker({
    targetNames: session.campaigns.map((campaign) => campaign.targetName),
    holdAfterLost: slam,
    onStateChange: (state) => {
      debug?.set('tracking', state)
      const found = state === TrackingState.Found
      scanHint.setVisible(!found)
      buttons?.setVisible(found)
    },
    onTrackingStatus: (status, reason) => {
      debug?.set('slam', reason ? `${status} (${reason})` : status)
    },
    onFound: (target) => {
      const runtime = runtimes.get(target.name)
      if (!runtime) return
      debug?.set('found', tracker.visible.map((each) => each.name).join(', '))
      follow(runtime)
      placeModel(runtime)
      playIdle(runtime)
    },
    onLost: (target) => {
      debug?.set('found', tracker.visible.map((each) => each.name).join(', ') || 'none')
      if (active?.target !== target) return
      // With two stickers on screen, dropping the active one leaves the buttons up
      // — they must move to the sticker still on screen, or they drive a model
      // nobody can see any more.
      const next = tracker.visible.at(-1)
      const runtime = next ? runtimes.get(next.name) : undefined
      if (runtime) follow(runtime)
    },
  })

  /** Points the UI at one sticker: its clips, and whichever of them is playing. */
  const follow = (runtime: TargetRuntime): void => {
    active = runtime
    buttons?.setNames(runtime.campaign.animations)
    buttons?.setActive(runtime.animation?.current ?? null)
  }

  const playIdle = (runtime: TargetRuntime): void => {
    if (!runtime.animation) return
    runtime.animation.play(runtime.campaign.idleAnim)
    if (active === runtime) buttons?.setActive(runtime.campaign.idleAnim)
  }

  /**
   * Fits the model to THIS sticker and parents it. Runs once per sticker, and
   * only when both halves are in hand: the size arrives with the sticker's
   * first detection, the model with its own download, in either order.
   */
  const placeModel = (runtime: TargetRuntime): void => {
    if (runtime.placed) return
    const {scaledWidth, scaledHeight} = runtime.target
    if (scaledWidth === null || scaledHeight === null) return

    modelFor(runtime.campaign).then(
      (loaded) => {
        if (runtime.placed) return
        runtime.placed = true
        debug?.set(`clips:${runtime.campaign.id}`, loaded.animations.map((clip) => clip.name).join(', ') || 'none')
        fitToTarget(runtime.rig, scaledWidth, scaledHeight)
        runtime.target.anchor.add(fitModelToTarget(loaded.object, scaledWidth, runtime.campaign.scale))
        runtime.animation = createAnimationController(loaded.object, loaded.animations)
        // The sticker may have been found again — or for the first time —
        // while this was downloading.
        if (runtime.target.visible) playIdle(runtime)
      },
      (error: unknown) => showErrorScreen(ui, 'assets-missing', String(error)),
    )
  }

  // THREE.Clock is deprecated in three 0.183; Timer is its replacement.
  const timer = new THREE.Timer()

  const sceneModule: PipelineModule = {
    name: 'sticker-scene',
    onStart: () => {
      const xr = xrScene()
      setupRenderer(xr)

      for (const campaign of session.campaigns) {
        const target = tracker.get(campaign.targetName)
        if (!target) continue
        xr.scene.add(target.anchor)
        runtimes.set(target.name, {
          campaign,
          target,
          rig: createAnchorRig(target.anchor),
          animation: null,
          placed: false,
        })
      }
    },
    onUpdate: () => {
      timer.update()
      const delta = timer.getDelta()
      // Only stickers in view: three.js does not render a hidden subtree, so
      // advancing its mixer would be work nobody can see, once per character.
      for (const target of tracker.visible) {
        runtimes.get(target.name)?.animation?.update(delta)
      }
    },
  }

  startAR({
    canvas,
    imageTargetData,
    modules: [sceneModule, tracker.module],
    onCameraStatusChange: (status) => {
      debug?.set('camera', status)
      if (status === 'failed') showErrorScreen(ui, 'camera-denied')
      captureBar?.setVisible(status === 'hasVideo')
    },
    onException: (error) => showErrorScreen(ui, 'unknown', String(error)),
  })
}

/**
 * Builds the capture bar and everything behind it: shutter, recorder, preview
 * and native share.
 *
 * Lifted out of `main` so the whole feature is one call that is either made or
 * not — the POC does not make it (`CAPTURE_ENABLED`). `campaignName` is read
 * lazily because the sticker being followed changes while the bar stays up.
 */
function wireCapture(
  ui: HTMLElement,
  canvas: HTMLCanvasElement,
  campaignName: () => string,
): CaptureBar {
  const showCapture = (result: Capture): void => {
    showCapturePreview(ui, result, {
      onShare: shareCapture,
      onClose: releaseCapture,
    })
  }
  // A failed snapshot is not a reason to tear down a working AR session, so
  // these never reach the error screen.
  const onCaptureError = (error: unknown): void => console.warn('[capture] failed', error)

  const recorder = createRecorder(canvas, campaignName, {
    onResult: showCapture,
    onStateChange: (recording) => bar.setRecording(recording),
    onError: onCaptureError,
  })

  const bar = createCaptureBar(ui, {
    recordingSupported: isRecordingSupported(),
    onPhoto: () => {
      capturePhoto(canvas, campaignName()).then(showCapture, onCaptureError)
    },
    onToggleRecord: () => (recorder.recording ? recorder.stop() : recorder.start()),
  })

  return bar
}

main().catch((error: unknown) => {
  const ui = document.getElementById('ui')
  if (ui instanceof HTMLElement) showErrorScreen(ui, 'unknown', String(error))
  else console.error(error)
})
