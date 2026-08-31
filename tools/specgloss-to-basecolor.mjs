/**
 * Minimal fix for a GLB that renders white because it needs
 * KHR_materials_pbrSpecularGlossiness, which three.js has removed.
 *
 * This does the smallest possible thing: it MOVES the existing diffuse texture
 * into the `baseColorTexture` slot the loader reads, and drops the dead
 * extension. It generates NO new image data — every surviving texture comes
 * out byte-identical to the one that went in.
 *
 * `gltf-transform metalrough` is the fuller conversion: it also bakes a new
 * metallicRoughness texture out of the specularGlossiness map, so per-pixel
 * shininess survives. That is a better-looking result but it adds an image
 * that was not in the source. Use that one when you want fidelity; use this
 * one when the source textures must be exactly the source textures.
 *
 * What is lost here: per-pixel gloss variation, replaced by one flat roughness
 * value derived from the material's own glossinessFactor. Colour, normals and
 * ambient occlusion are untouched.
 *
 *   node tools/specgloss-to-basecolor.mjs <in.glb> <out.glb>
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {prune} from '@gltf-transform/functions'

const [src, dst] = process.argv.slice(2)
if (!src || !dst) {
  console.error('usage: node tools/specgloss-to-basecolor.mjs <in.glb> <out.glb>')
  process.exit(1)
}

const EXTENSION = 'KHR_materials_pbrSpecularGlossiness'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(src)

let converted = 0
for (const material of doc.getRoot().listMaterials()) {
  const specGloss = material.getExtension(EXTENSION)
  if (!specGloss) continue

  const diffuseTexture = specGloss.getDiffuseTexture()
  if (diffuseTexture) {
    material.setBaseColorTexture(diffuseTexture)
    const from = specGloss.getDiffuseTextureInfo()
    const to = material.getBaseColorTextureInfo()
    if (from && to) {
      to.setTexCoord(from.getTexCoord())
      to.setWrapS(from.getWrapS())
      to.setWrapT(from.getWrapT())
    }
  }
  material.setBaseColorFactor(specGloss.getDiffuseFactor())

  // Nothing here is textured: one flat value each, so no image is invented.
  // Non-metal is the right default for a creature; the specular map that
  // described shininess per-pixel is dropped rather than rebaked.
  material.setMetallicFactor(0)
  material.setRoughnessFactor(1 - specGloss.getGlossinessFactor())

  material.setExtension(EXTENSION, null)
  converted++
}

if (converted === 0) {
  console.error(`no material uses ${EXTENSION} — nothing to do`)
  process.exit(1)
}

// Clearing it off every material is not enough: the extension stays
// registered on the document, so it remains in extensionsUsed/Required and
// keeps its specularGlossiness image alive. Dispose the extension itself.
for (const extension of doc.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === EXTENSION) extension.dispose()
}

// Drops the now-unreferenced specularGlossiness image.
await doc.transform(prune())

await io.write(dst, doc)
console.log(`converted ${converted} material(s); wrote ${dst}`)
