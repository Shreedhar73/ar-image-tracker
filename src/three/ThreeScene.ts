/**
 * Renderer settings, lighting and the shadow catcher.
 *
 * The scene, camera and renderer are created by XR8.Threejs.pipelineModule();
 * this module only configures what it hands us. Never construct a second
 * WebGLRenderer — the engine already calls render() once per camera frame.
 */
import * as THREE from 'three'
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js'

import type {XrScene} from '../ar/xr8'

export interface SceneRig {
  /** Directional caster. Its shadow is what sells the character sitting on paper. */
  keyLight: THREE.DirectionalLight
  /** Transparent plane that receives the shadow. Sized from the target. */
  shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
  dispose: () => void
}

/**
 * Configures the engine's renderer and populates the anchor with lights and a
 * shadow catcher. Lights live on the anchor so they follow the sticker: a
 * scene-space light would swing across the character as the phone moves.
 */
export function setupScene(xr: XrScene, anchor: THREE.Group): SceneRig {
  const {renderer, scene} = xr

  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // PBR materials need an environment or metals read as black. RoomEnvironment
  // gives real variation across the surface; a flat-colour PMREM does not.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture

  // Axis convention for a FLAT image target: the printed image lies in the
  // anchor's XY plane and +Z is the surface normal (verified against
  // 8thwall/aframe-image-targets-example, where an unrotated a-frame plane
  // — an XY primitive — lands flush on the printed artwork). So "away from
  // the paper" is +Z here, not +Y.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2)
  hemi.position.set(0, 0, 1)

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(0.5, 0.6, 1.2)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  // Frustum in sticker units; resized with the catcher once scaledWidth is known.
  keyLight.shadow.camera.near = 0.01
  keyLight.shadow.camera.far = 5
  keyLight.shadow.bias = -0.0015
  keyLight.shadow.normalBias = 0.02

  const fill = new THREE.DirectionalLight(0xffffff, 0.6)
  fill.position.set(-0.8, -0.4, 0.6)

  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({opacity: 0.35}),
  )
  shadowCatcher.name = 'shadow-catcher'
  // The image target's local XY plane is the sticker surface; the plane
  // geometry already lies in XY, so no rotation is needed.
  shadowCatcher.receiveShadow = true
  shadowCatcher.renderOrder = -1

  anchor.add(hemi, keyLight, keyLight.target, fill, shadowCatcher)
  keyLight.target.position.set(0, 0, 0)

  return {
    keyLight,
    shadowCatcher,
    dispose: () => {
      envRT.dispose()
      pmrem.dispose()
      shadowCatcher.geometry.dispose()
      shadowCatcher.material.dispose()
    },
  }
}

/**
 * Sizes the shadow catcher and the shadow frustum to the physical sticker.
 * Call on the first imagefound, when scaledWidth/Height become known.
 */
export function fitToTarget(rig: SceneRig, width: number, height: number): void {
  rig.shadowCatcher.geometry.dispose()
  rig.shadowCatcher.geometry = new THREE.PlaneGeometry(width, height)

  const extent = Math.max(width, height)
  const cam = rig.keyLight.shadow.camera
  cam.left = -extent
  cam.right = extent
  cam.top = extent
  cam.bottom = -extent
  cam.near = 0.01
  cam.far = extent * 6
  cam.updateProjectionMatrix()

  // Light distance scales with the sticker so the shadow keeps its shape.
  rig.keyLight.position.set(extent * 0.5, extent * 0.6, extent * 1.2)
}
