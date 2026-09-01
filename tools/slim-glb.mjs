#!/usr/bin/env node
/**
 * Brings ANY supplied GLB down to the 2 MB phone budget, and proves it did not
 * break the model on the way.
 *
 *   npm run slim -- <in.glb> <out.glb>
 *   npm run slim -- <in.glb> <out.glb> --keep Idle=C003_Idle_01,Jump=C003_Jump_01
 *
 * This is the generic counterpart to the one-off prep scripts beside it. It
 * knows nothing about any particular character: everything it strips is either
 * unreferenced by the file itself (dead UV sets, duplicate accessors, redundant
 * keyframes) or named on the command line (clips).
 *
 * It does NOT fix compatibility. A GLB needing an extension three.js dropped
 * renders white however small it is, so that case is refused at the door and
 * sent to `npm run glb`.
 *
 * Never writes over its input.
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dedup, meshopt, prune, resample, textureCompress, weld} from '@gltf-transform/functions'
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer'
import sharp from 'sharp'
import {createRequire} from 'node:module'
import {existsSync, readFileSync, statSync} from 'node:fs'
import {basename, resolve} from 'node:path'

const require = createRequire(import.meta.url)

/** Same budget as glb-doctor: over this is a stall on a low-end phone. */
const MAX_BYTES = 2 * 1024 * 1024
const MAX_TEXTURE_EDGE = 1024
const WEBP_QUALITY = 90

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`

/** Read out of the installed three, not written down. Same source as glb-doctor. */
function supportedExtensions() {
  const loaderPath = require.resolve('three/examples/jsm/loaders/GLTFLoader.js')
  const source = readFileSync(loaderPath, 'utf8')
  const block = /const EXTENSIONS = \{([\s\S]*?)\}/.exec(source)
  if (!block?.[1]) throw new Error(`could not read the EXTENSIONS list from ${loaderPath}`)
  const names = [...block[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1])
  if (names.length === 0) throw new Error('EXTENSIONS list parsed but empty')
  return new Set(names)
}

// --- arguments

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith('--'))
const [input, output] = positional
const keepArg = (() => {
  const i = argv.indexOf('--keep')
  return i === -1 ? null : argv[i + 1]
})()

if (!input || !output) {
  console.error('usage: npm run slim -- <in.glb> <out.glb> [--keep New=Old,New=Old]')
  process.exit(1)
}
if (!existsSync(input)) {
  console.error(`not found: ${input}`)
  process.exit(1)
}
if (resolve(output) === resolve(input)) {
  console.error('refusing to write over the input — give a different output path')
  process.exit(1)
}

/** new name -> old name. Empty map means keep every clip under its own name. */
const keep = new Map()
if (keepArg) {
  for (const pair of keepArg.split(',')) {
    const [next, previous] = pair.split('=')
    if (!next || !previous) {
      console.error(`--keep entries must be New=Old, got: ${pair}`)
      process.exit(1)
    }
    if (keep.has(next)) {
      console.error(`--keep names "${next}" twice — one clip per name`)
      process.exit(1)
    }
    keep.set(next, previous)
  }
}

// --- read

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder})

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

// --- refuse a model three.js cannot render anyway

const supported = supportedExtensions()
const unsupported = root
  .listExtensionsUsed()
  .map((e) => e.extensionName)
  .filter((name) => !supported.has(name))
if (unsupported.length) {
  console.error(`\n${basename(input)} needs ${unsupported.join(', ')}, which three.js does not read.`)
  console.error('Shrinking it would only make a smaller white model. Fix compatibility first:')
  console.error(`  npm run glb -- ${input} ${input.replace(/\.glb$/, '-fixed.glb')}\n`)
  process.exit(1)
}

// --- what we must still have at the end

const before = {
  bytes: statSync(input).size,
  skins: root.listSkins().length,
  joints: root.listSkins().reduce((n, s) => n + s.listJoints().length, 0),
  clips: root.listAnimations().map((a) => a.getName()),
  baseColour: root.listMaterials().filter((m) => m.getBaseColorTexture()).length,
  textureBytes: root.listTextures().reduce((n, t) => n + (t.getImage()?.byteLength ?? 0), 0),
}

/** Bytes of accessor data an animation owns, for the over-budget report. */
function clipBytes(anim) {
  const seen = new Set()
  let bytes = 0
  for (const sampler of anim.listSamplers()) {
    for (const accessor of [sampler.getInput(), sampler.getOutput()]) {
      if (!accessor || seen.has(accessor)) continue
      seen.add(accessor)
      bytes += accessor.getArray()?.byteLength ?? 0
    }
  }
  return bytes
}

console.log(`\n${basename(input)}  —  ${mb(before.bytes)}, ${String(before.clips.length)} clip(s), ${String(before.joints)} joint(s)\n`)

// --- 1. clips

const expectedClips = keep.size ? [...keep.keys()] : [...before.clips]

if (keep.size) {
  const byName = new Map(root.listAnimations().map((a) => [a.getName(), a]))
  const missing = [...keep.values()].filter((old) => !byName.has(old))
  if (missing.length) {
    console.error(`  --keep names clips that are not in this file: ${missing.join(', ')}`)
    console.error(`  present: ${before.clips.join(', ')}\n`)
    process.exit(1)
  }
  const wanted = new Set(keep.values())
  for (const anim of root.listAnimations()) {
    if (wanted.has(anim.getName())) continue
    // Disposing the Animation alone is not enough. Its channels and samplers
    // are only DETACHED — the docs are explicit that undisposed properties
    // stay in the document — and each orphan sampler still counts as a parent
    // of its input/output accessors, so prune() will not collect them. On a
    // 180-clip rig export that leaves ~195,000 dead accessors whose JSON is
    // 30 MB of the file. Dispose the whole subtree, leaf first.
    for (const channel of anim.listChannels()) channel.dispose()
    for (const sampler of anim.listSamplers()) sampler.dispose()
    anim.dispose()
  }
  for (const [next, previous] of keep) byName.get(previous).setName(next)
  console.log(`  clips            ${String(before.clips.length)} -> ${String(expectedClips.length)}: ${expectedClips.join(', ')}`)
} else {
  const animationBytes = root.listAnimations().reduce((n, a) => n + clipBytes(a), 0)
  console.log(`  clips            all ${String(before.clips.length)} kept (${mb(animationBytes)})`)
  // A file this size is almost always a rig export carrying a game's whole
  // clip library. Nothing generic can choose which four a child needs.
  if (animationBytes > MAX_BYTES && before.clips.length > 1) {
    const list = root
      .listAnimations()
      .map((a) => ({name: a.getName(), bytes: clipBytes(a)}))
      .sort((a, b) => b.bytes - a.bytes)
    console.error(`\n  Animation alone is ${mb(animationBytes)} across ${String(list.length)} clips — no amount of`)
    console.error('  texture work reaches the 2 MB budget. Choose the clips to keep and rerun:')
    console.error(`    npm run slim -- ${input} ${output} --keep Idle=${list[0].name},Jump=...\n`)
    console.error('  Largest clips:')
    for (const {name, bytes} of list.slice(0, 15)) {
      console.error(`    ${(bytes / 1024).toFixed(0).padStart(7)} KB  ${name}`)
    }
    if (list.length > 15) console.error(`    ... and ${String(list.length - 15)} more`)
    console.error()
    process.exit(1)
  }
}

// --- 2..7. the generic squeeze
//
// Order matters. prune runs before weld because dead TEXCOORD_1..8 make
// otherwise-identical vertices unweldable, and meshopt runs last because it
// quantises and reorders everything the earlier steps produced.

const stages = [
  ['resample', resample()],
  ['prune', prune({keepAttributes: false, keepLeaves: false})],
  ['dedup', dedup()],
  ['weld', weld()],
  [
    'textures',
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [MAX_TEXTURE_EDGE, MAX_TEXTURE_EDGE],
      quality: WEBP_QUALITY,
    }),
  ],
  ['meshopt', meshopt({encoder: MeshoptEncoder, level: 'high'})],
]

console.log()
let previousBytes = before.bytes
for (const [name, transform] of stages) {
  await doc.transform(transform)
  // Serialise rather than estimate: the only number that matters is what a
  // phone downloads, and several of these stages only pay off once written.
  const bytes = (await io.writeBinary(doc)).byteLength
  const delta = bytes - previousBytes
  const sign = delta > 0 ? '+' : '-'
  console.log(
    `  ${name.padEnd(16)} ${mb(bytes).padStart(9)}   ${sign}${mb(Math.abs(delta)).replace(' MB', '')}`,
  )
  previousBytes = bytes
}

await io.write(output, doc)

// --- verify the FILE, not the document we still hold in memory

const check = (await io.read(output)).getRoot()
const after = {
  bytes: statSync(output).size,
  skins: check.listSkins().length,
  joints: check.listSkins().reduce((n, s) => n + s.listJoints().length, 0),
  clips: check.listAnimations().map((a) => a.getName()),
  baseColour: check.listMaterials().filter((m) => m.getBaseColorTexture()).length,
  textureBytes: check.listTextures().reduce((n, t) => n + (t.getImage()?.byteLength ?? 0), 0),
}

const failures = []
if (after.skins !== before.skins) failures.push(`skins ${String(before.skins)} -> ${String(after.skins)}`)
if (after.joints !== before.joints) failures.push(`joints ${String(before.joints)} -> ${String(after.joints)}`)
// Against what --keep ASKED FOR, never against what came out of the input:
// comparing the output to itself is a check that cannot go red.
const missingClips = expectedClips.filter((name) => !after.clips.includes(name))
const extraClips = after.clips.filter((name) => !expectedClips.includes(name))
if (missingClips.length) failures.push(`clips lost: ${missingClips.join(', ')}`)
if (extraClips.length) failures.push(`unexpected clips: ${extraClips.join(', ')}`)
if (before.baseColour > 0 && after.baseColour === 0) failures.push('base-colour texture lost — model would render white')
const stillUnsupported = check
  .listExtensionsUsed()
  .map((e) => e.extensionName)
  .filter((name) => !supported.has(name))
if (stillUnsupported.length) failures.push(`output needs ${stillUnsupported.join(', ')}, which three.js does not read`)

console.log(`\n  ${basename(input)} -> ${basename(output)}`)
console.log(`    size             ${mb(before.bytes)} -> ${mb(after.bytes)}`)
console.log(`    textures         ${mb(before.textureBytes)} -> ${mb(after.textureBytes)} (${String(check.listTextures().length)} image(s))`)
console.log(`    rig              ${String(after.skins)} skin(s), ${String(after.joints)} joint(s)`)
console.log(`    clips            ${after.clips.join(', ') || 'none'}`)
console.log(`    -> campaigns.ts: animations: ${JSON.stringify(after.clips)}`)

if (failures.length) {
  console.log(`\n  VERIFICATION FAILED: ${failures.join('; ')}\n`)
  process.exit(1)
}
console.log('    verified         rig intact, clips as asked, base colour present, extensions three.js reads')

console.log('\n  Nothing here checks that the ANIMATION still looks right. For that:')
console.log(`    node tools/verify-retarget.mjs ${input} <old clip> ${output} <new clip>`)

if (after.bytes > MAX_BYTES) {
  console.log(`\n  Still ${mb(after.bytes)}, over the 2 MB budget. Next levers, in order of damage:`)
  console.log('    - keep fewer clips (--keep)')
  console.log('    - drop the texture edge below 1024 in this file')
  console.log('    - simplify() the mesh, which changes the silhouette — a person should look at that')
  console.log()
  process.exit(1)
}
console.log(`\n  Under the 2 MB budget.\n`)
