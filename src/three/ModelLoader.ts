/**
 * GLB loading. Supports both Draco and meshopt compression, because the art
 * pipeline may hand us either and a loader that only knows one fails silently
 * late, at parse time, on a phone.
 */
import * as THREE from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'

import type {GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface LoadedModel {
  /** The GLB root. Not yet scaled or parented. */
  object: THREE.Object3D
  animations: THREE.AnimationClip[]
  dispose: () => void
}

let loader: GLTFLoader | null = null

function getLoader(): GLTFLoader {
  if (loader) return loader
  const draco = new DRACOLoader()
  // Copied out of three/examples/jsm/libs/draco/gltf by vite.config.ts. The
  // decoder is fetched at runtime, so this must be a served path, not an import.
  draco.setDecoderPath('/external/draco/')
  loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader
}

export async function loadModel(url: string): Promise<LoadedModel> {
  const gltf: GLTF = await getLoader().loadAsync(url)
  const object = gltf.scene

  object.traverse((node) => {
    const child = asMesh(node)
    if (!child) return
    child.castShadow = true
    // A character standing on paper should not shadow itself into mud; the
    // shadow catcher is the only receiver.
    child.receiveShadow = false
    child.frustumCulled = false
  })

  return {
    object,
    animations: gltf.animations,
    dispose: () => disposeObject(object),
  }
}

/**
 * Normalises a Y-up authored GLB onto the sticker and scales it to the target.
 *
 * `targetWidth` is the sticker's physical width in metres (`scaledWidth` from
 * the image-target event), so an 8 cm sticker gives the same on-screen
 * character on every device. `scale` from the campaign is a multiplier on that,
 * never an absolute size.
 */
export function fitModelToTarget(
  object: THREE.Object3D,
  targetWidth: number,
  scale: number,
): THREE.Group {
  // Measure and place the model in its OWN Y-up frame first. Box3.setFromObject
  // reads world matrices, so parenting it to the rotated group before measuring
  // would swap the axes underneath these numbers.
  const size = new THREE.Vector3()
  new THREE.Box3().setFromObject(object).getSize(size)
  const footprint = Math.max(size.x, size.z) || 1

  // Fill the sticker's width by default; campaign.scale tunes from there.
  object.scale.setScalar((targetWidth / footprint) * scale)

  // Re-measure after scaling and sit the model's feet on the sticker surface.
  const scaled = new THREE.Box3().setFromObject(object)
  object.position.y -= scaled.min.y

  // The sticker is the anchor's XY plane with +Z out of the paper, but GLBs are
  // authored Y-up. +90 deg about X maps the model's +Y onto the anchor's +Z,
  // which is the one rotation that stands the character on the sticker.
  const standUp = new THREE.Group()
  standUp.name = 'model-standup'
  standUp.rotation.x = Math.PI / 2
  standUp.add(object)

  return standUp
}

/**
 * `instanceof THREE.Mesh` narrows to `Mesh<any, any, any>` because Mesh is
 * generic, which silently turns `.geometry` and `.material` into `any`. The
 * isMesh flag narrows to the defaulted, fully typed Mesh instead.
 */
function asMesh(node: THREE.Object3D): THREE.Mesh | null {
  return (node as Partial<THREE.Mesh>).isMesh === true ? (node as THREE.Mesh) : null
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const child = asMesh(node)
    if (!child) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) material.dispose()
  })
}
