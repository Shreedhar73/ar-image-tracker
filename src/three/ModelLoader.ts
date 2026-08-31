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

/** `glTF` in ASCII — the first four bytes of every binary glTF file. */
const GLB_MAGIC = 0x46546c67

export async function loadModel(url: string): Promise<LoadedModel> {
  // Fetched by hand rather than with loadAsync so a wrong model path fails
  // legibly. /ar/<id> routes are rewritten to index.html, so a typo'd asset URL
  // comes back as 200 text/html, not a 404 — GLTFLoader then tries to parse the
  // page as glTF JSON and reports "Unexpected token '<'", which points at
  // nothing. The magic-number check names the actual problem.
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`model ${url} returned ${String(response.status)}`)
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength < 4 || new DataView(buffer).getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(
      `model ${url} is not a .glb — got ${String(response.headers.get('content-type'))}. ` +
        `A served index.html here means the file does not exist at that path.`,
    )
  }

  const manifest = readManifest(buffer)

  const gltf: GLTF = await getLoader().parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1))
  const object = gltf.scene

  warnIfTexturesWereDropped(url, object, manifest)

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
 * `targetWidth` is the sticker's width in scene units (`scaledWidth` from
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

/** GLB chunk type 'JSON' as a little-endian uint32. */
const GLB_CHUNK_JSON = 0x4e4f534a

/** Extensions three.js used to support and has since removed. */
const REMOVED_EXTENSIONS = ['KHR_materials_pbrSpecularGlossiness']

interface GlbManifest {
  textureCount: number
  removedExtensions: string[]
}

/** Reads the GLB's JSON chunk directly — we already have the bytes in hand. */
function readManifest(buffer: ArrayBuffer): GlbManifest {
  const empty: GlbManifest = {textureCount: 0, removedExtensions: []}
  try {
    const view = new DataView(buffer)
    // 12-byte header, then chunks of [length u32][type u32][data].
    const length = view.getUint32(12, true)
    if (view.getUint32(16, true) !== GLB_CHUNK_JSON) return empty
    const json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 20, length)),
    ) as {textures?: unknown[]; extensionsRequired?: string[]; extensionsUsed?: string[]}
    const declared = [...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])]
    return {
      textureCount: Array.isArray(json.textures) ? json.textures.length : 0,
      removedExtensions: REMOVED_EXTENSIONS.filter((name) => declared.includes(name)),
    }
  } catch {
    // A diagnostic, never a gate — a parse failure here must not stop a model
    // that three.js is perfectly able to load.
    return empty
  }
}

const CONVERT_HINT = 'npx @gltf-transform/cli metalrough in.glb out.glb'

/**
 * A GLB whose base-colour texture three.js cannot reach renders as a plain
 * white model, reporting nothing but a buried `Unknown extension` warning —
 * the symptom points at lighting, at the material, at anything but the cause.
 *
 * The culprit is KHR_materials_pbrSpecularGlossiness, which three REMOVED: the
 * loader ignores the extension's `diffuseTexture` and falls back to a blank
 * MeshStandardMaterial.
 *
 * The test is specifically for the BASE COLOUR map. `normalTexture` and
 * `occlusionTexture` are core glTF and still get applied, so "does any map
 * slot exist" passes on a model that renders white — that version of this
 * check could not go red, and did not.
 */
function warnIfTexturesWereDropped(url: string, root: THREE.Object3D, manifest: GlbManifest): void {
  if (manifest.removedExtensions.length > 0) {
    console.error(
      `[model] ${url} requires ${manifest.removedExtensions.join(', ')}, which three.js has ` +
        `removed. Its textures will be ignored and the model will render plain white. ` +
        `Fix the asset, not the code: ${CONVERT_HINT}`,
    )
    return
  }
  if (manifest.textureCount === 0) return

  let baseColorMaps = 0
  root.traverse((node) => {
    const mesh = asMesh(node)
    if (!mesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if ((material as unknown as {map?: unknown}).map) baseColorMaps++
    }
  })

  if (baseColorMaps === 0) {
    console.error(
      `[model] ${url} declares ${String(manifest.textureCount)} texture(s) but no material got a ` +
        `base-colour map — it will render plain white. Check the glTF extensions it needs. ${CONVERT_HINT}`,
    )
  }
}
