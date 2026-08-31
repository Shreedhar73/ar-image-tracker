/**
 * One-off asset prep for hero-001, the Quaternius CC0 web-hero.
 *
 * Source is the Universal Base Characters kit's `Superhero_Male_FullBody`,
 * which ships as a bare body plus eyebrows, eyeballs and two 2048px hair maps
 * for a hairstyle this character does not wear. A masked hero needs none of
 * it: the eyebrows sit under the mask, and the hair textures are 5.9 MB of the
 * file for a mesh that was never included.
 *
 * This drops the eyebrows, turns the eyeballs into flat white lenses, and
 * lets `prune` take the now-unreferenced hair material and its textures with
 * it. Run it AFTER retarget-anim.mjs and BEFORE bake-suit-texture.mjs.
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {prune, dedup, weld} from '@gltf-transform/functions'

const [src, dst] = process.argv.slice(2)
if (!src || !dst) {
  console.error('usage: prep-hero.mjs <in.glb> <out.glb> [lensScale]')
  process.exit(2)
}
if (src === dst) {
  console.error('refusing to write over the input')
  process.exit(2)
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(src)
const root = doc.getRoot()

// Eyebrows: named for the node, not the mesh — the mesh is called "Face".
for (const node of root.listNodes()) {
  if (node.getName() === 'Eyebrows') {
    node.getMesh()?.dispose()
    node.dispose()
    console.log('dropped Eyebrows')
  }
}

// Eyeballs become mask lenses: flat white, no iris, and blown up around each
// eye's own centre so they read as goggles from two metres away rather than as
// a bald man's eyeballs. Left and right are split on the mesh's mid-X so the
// pair grows in place instead of drifting apart.
const LENS_SCALE = Number(process.argv[4]) || 1.7
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial()?.getName() !== 'MI_Eyes') continue
    const pos = prim.getAttribute('POSITION')
    const n = pos.getCount()
    let midX = 0
    for (let i = 0; i < n; i++) midX += pos.getElement(i, [0, 0, 0])[0]
    midX /= n
    for (const side of [-1, 1]) {
      const idx = []
      let c = [0, 0, 0]
      for (let i = 0; i < n; i++) {
        const p = pos.getElement(i, [0, 0, 0])
        if (Math.sign(p[0] - midX) !== side) continue
        idx.push(i)
        c = [c[0] + p[0], c[1] + p[1], c[2] + p[2]]
      }
      if (!idx.length) continue
      c = c.map((v) => v / idx.length)
      for (const i of idx) {
        const p = pos.getElement(i, [0, 0, 0])
        pos.setElement(i, p.map((v, k) => c[k] + (v - c[k]) * LENS_SCALE))
      }
    }
    console.log(`eyes -> ${LENS_SCALE}x lenses (${n} verts)`)
  }
}
for (const material of root.listMaterials()) {
  if (material.getName() !== 'MI_Eyes') continue
  material.setBaseColorTexture(null)
  material.setBaseColorFactor([0.93, 0.95, 0.96, 1])
  material.setNormalTexture(null)
  material.setRoughnessFactor(0.25)
  material.setName('M_Hero_Lens')
}

// The body's roughness map is 3.1 MB of detail nobody sees on an 8 cm sticker;
// one factor reads the same and the texture prunes away with it.
for (const material of root.listMaterials()) {
  if (material.getName() !== 'MI_Superhero_Male') continue
  material.setMetallicRoughnessTexture(null)
  material.setRoughnessFactor(0.65)
  material.setMetallicFactor(0)
  material.setName('M_Hero_Suit')
}

await doc.transform(weld(), dedup(), prune())

console.log('materials:', root.listMaterials().map((m) => m.getName()).join(', '))
console.log('textures:', root.listTextures().map((t) => t.getName()).join(', ') || 'none')
await io.write(dst, doc)
console.log(`wrote ${dst}`)
