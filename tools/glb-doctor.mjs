#!/usr/bin/env node
/**
 * Checks a GLB against the version of three.js this repo actually installs,
 * and fixes what can be fixed automatically.
 *
 *   npm run glb -- <in.glb>              # report only
 *   npm run glb -- <in.glb> <out.glb>    # report, then write a fixed copy
 *
 * The supported-extension list is READ OUT OF the installed
 * three/examples/jsm/loaders/GLTFLoader.js rather than written down here, so
 * upgrading three updates this check instead of silently invalidating it.
 *
 * Never writes over its input.
 *
 * Background: a GLB needing an extension three.js has dropped still loads —
 * the loader only whispers `Unknown extension` and falls back to a blank white
 * material. The model appears, untextured, and nothing says why. That is the
 * failure this exists to make loud.
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {prune} from '@gltf-transform/functions'
import {MeshoptDecoder} from 'meshoptimizer'
import {createRequire} from 'node:module'
import {readFileSync, statSync, existsSync} from 'node:fs'
import {basename, resolve} from 'node:path'

const require = createRequire(import.meta.url)

/** CLAUDE.md's budget: over this is a black screen on a low-end phone. */
const MAX_BYTES = 2 * 1024 * 1024
const MAX_TEXTURE_EDGE = 1024
const SPEC_GLOSS = 'KHR_materials_pbrSpecularGlossiness'

function supportedExtensions() {
  const loaderPath = require.resolve('three/examples/jsm/loaders/GLTFLoader.js')
  const source = readFileSync(loaderPath, 'utf8')
  const block = /const EXTENSIONS = \{([\s\S]*?)\}/.exec(source)
  if (!block?.[1]) {
    throw new Error(`could not read the EXTENSIONS list from ${loaderPath}`)
  }
  const names = [...block[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1])
  if (names.length === 0) throw new Error('EXTENSIONS list parsed but empty')
  return new Set(names)
}

const [input, output] = process.argv.slice(2)
if (!input) {
  console.error('usage: npm run glb -- <in.glb> [out.glb]')
  process.exit(1)
}
if (!existsSync(input)) {
  console.error(`not found: ${input}`)
  process.exit(1)
}
if (output && resolve(output) === resolve(input)) {
  console.error('refusing to write over the input — give a different output path')
  process.exit(1)
}

const supported = supportedExtensions()
// three's package.json is not in its `exports` map, so read it off disk
// rather than requiring it.
const threeVersion = JSON.parse(
  readFileSync(new URL('../node_modules/three/package.json', import.meta.url), 'utf8'),
).version

// Compressed GLBs cannot even be READ without their decoder, and our own
// models are meshopt-compressed, so a doctor that cannot open them is useless.
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.decoder': MeshoptDecoder})

let doc
try {
  doc = await io.read(input)
} catch (error) {
  console.error(`\ncannot read ${basename(input)}: ${error.message}`)
  console.error(
    'If it names a missing decoder dependency, the file uses a compression this ' +
      'tool has no decoder for (Draco needs `npm i -D draco3dgltf`).\n',
  )
  process.exit(1)
}
const root = doc.getRoot()

const declared = root.listExtensionsUsed().map((e) => e.extensionName)
const required = new Set(root.listExtensionsRequired().map((e) => e.extensionName))
const unsupported = declared.filter((name) => !supported.has(name))

const problems = []
const notes = []

console.log(`\n${basename(input)}  —  checked against three ${threeVersion}\n`)

// --- extensions
if (unsupported.length === 0) {
  console.log(`  extensions       ok${declared.length ? ` (${declared.join(', ')})` : ' (none)'}`)
} else {
  for (const name of unsupported) {
    const how = required.has(name) ? 'required' : 'used'
    problems.push(`${name} (${how}) is not supported by three ${threeVersion}`)
    console.log(`  extensions       PROBLEM: ${name} (${how}) — three.js cannot read this`)
  }
}

// --- textures
const textures = root.listTextures()
const oversized = textures.filter((t) => {
  const size = t.getSize()
  return size && Math.max(size[0], size[1]) > MAX_TEXTURE_EDGE
})
console.log(
  `  textures         ${String(textures.length)}` +
    (oversized.length ? `  (${String(oversized.length)} over ${String(MAX_TEXTURE_EDGE)}px)` : ''),
)
if (oversized.length) notes.push(`${String(oversized.length)} texture(s) exceed ${String(MAX_TEXTURE_EDGE)}px`)

// --- materials actually reaching a base colour
const withBaseColour = root.listMaterials().filter((m) => m.getBaseColorTexture()).length
if (textures.length > 0 && withBaseColour === 0) {
  problems.push('no material has a base-colour texture — the model will render white')
  console.log('  base colour      PROBLEM: no material has one; model renders WHITE')
} else {
  console.log(`  base colour      ${withBaseColour ? 'ok' : 'n/a (untextured model)'}`)
}

// --- rig and clips, the two things a fix must not break
const skins = root.listSkins()
const clips = root.listAnimations().map((a) => a.getName())
console.log(`  rig              ${String(skins.length)} skin(s), ${String(skins.reduce((n, s) => n + s.listJoints().length, 0))} joint(s)`)
console.log(`  animations       ${clips.length ? clips.join(', ') : 'none'}`)
if (clips.length) console.log(`                   -> campaigns.ts: animations: ${JSON.stringify(clips)}`)

// --- size
const bytes = statSync(input).size
const overBudget = bytes > MAX_BYTES
console.log(`  size             ${(bytes / 1048576).toFixed(2)} MB${overBudget ? '  (over the 2 MB budget)' : ''}`)
if (overBudget) notes.push('over the 2 MB budget for a phone on mobile data')

// --- fix
const fixable = unsupported.includes(SPEC_GLOSS)

if (problems.length === 0) {
  console.log('\n  No compatibility problems.')
} else if (!fixable) {
  console.log('\n  Problems found, and none of them are ones this tool can fix automatically.')
} else if (!output) {
  console.log(`\n  Fixable. Re-run with an output path to write the fixed copy:`)
  console.log(`    npm run glb -- ${input} ${input.replace(/\.glb$/, '-fixed.glb')}`)
}

if (fixable && output) {
  const beforeImages = root.listTextures().map((t) => t.getImage()?.byteLength ?? 0)
  const beforeJoints = skins.reduce((n, s) => n + s.listJoints().length, 0)

  let converted = 0
  for (const material of root.listMaterials()) {
    const specGloss = material.getExtension(SPEC_GLOSS)
    if (!specGloss) continue
    const diffuse = specGloss.getDiffuseTexture()
    if (diffuse) {
      material.setBaseColorTexture(diffuse)
      const from = specGloss.getDiffuseTextureInfo()
      const to = material.getBaseColorTextureInfo()
      if (from && to) {
        to.setTexCoord(from.getTexCoord())
        to.setWrapS(from.getWrapS())
        to.setWrapT(from.getWrapT())
      }
    }
    material.setBaseColorFactor(specGloss.getDiffuseFactor())
    // Flat values, so no image is invented. The specular map that described
    // shininess per-pixel is dropped rather than rebaked into a new texture.
    material.setMetallicFactor(0)
    material.setRoughnessFactor(1 - specGloss.getGlossinessFactor())
    material.setExtension(SPEC_GLOSS, null)
    converted++
  }

  // Clearing it off each material is not enough — the extension stays
  // registered on the document, keeps appearing in extensionsRequired, and
  // keeps its texture alive.
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName === SPEC_GLOSS) extension.dispose()
  }
  await doc.transform(prune())
  await io.write(output, doc)

  // Verify the OUTPUT rather than trusting the transform.
  const check = (await io.read(output)).getRoot()
  const stillUnsupported = check
    .listExtensionsUsed()
    .map((e) => e.extensionName)
    .filter((name) => !supported.has(name))
  const afterJoints = check.listSkins().reduce((n, s) => n + s.listJoints().length, 0)
  const afterClips = check.listAnimations().map((a) => a.getName())
  const afterImages = check.listTextures().map((t) => t.getImage()?.byteLength ?? 0)
  const reencoded = afterImages.filter((size) => !beforeImages.includes(size)).length

  const failures = []
  if (stillUnsupported.length) failures.push(`still unsupported: ${stillUnsupported.join(', ')}`)
  if (check.listMaterials().filter((m) => m.getBaseColorTexture()).length === 0) {
    failures.push('output still has no base-colour texture')
  }
  if (afterJoints !== beforeJoints) failures.push(`joints ${String(beforeJoints)} -> ${String(afterJoints)}`)
  if (afterClips.length !== clips.length) failures.push(`clips ${String(clips.length)} -> ${String(afterClips.length)}`)

  console.log(`\n  Fixed ${String(converted)} material(s) -> ${output}`)
  console.log(`    textures         ${String(afterImages.length)} kept, ${String(reencoded)} re-encoded, ${String(beforeImages.length - afterImages.length)} dropped (the unreadable specular map)`)
  console.log(`    rig / clips      ${String(afterJoints)} joints, ${afterClips.join(', ') || 'none'}`)
  console.log(`    size             ${(statSync(output).size / 1048576).toFixed(2)} MB`)

  if (failures.length) {
    console.log(`\n  VERIFICATION FAILED: ${failures.join('; ')}`)
    process.exit(1)
  }
  console.log('    verified         extensions clear, base colour present, rig and clips intact')

  if (statSync(output).size > MAX_BYTES) {
    console.log(`\n  Still over the 2 MB budget. To shrink the SAME images (adds no new maps):`)
    console.log(`    npx @gltf-transform/cli webp    ${output} tmp.glb --quality 95`)
    console.log(`    npx @gltf-transform/cli meshopt tmp.glb ${output.replace(/\.glb$/, '-small.glb')}`)
  }
}

if (notes.length) console.log(`\n  Notes: ${notes.join('; ')}`)
console.log()
process.exit(problems.length && !(fixable && output) ? 1 : 0)
