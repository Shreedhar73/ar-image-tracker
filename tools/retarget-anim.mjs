/**
 * Copy animation clips from one rigged glTF onto another that shares the same
 * bone NAMES but not the same proportions.
 *
 * Written for the Quaternius CC0 pair: the Universal Animation Library ships
 * its clips on a mannequin, and the Universal Base Characters kit ships the
 * superhero body with no clips at all. Same 65 bones, same hierarchy, same
 * names — but different bone lengths (0.72x to 1.24x) and rest orientations
 * that differ by up to 17 degrees. Every UAL channel is fully baked (T, R and
 * S on all 65 bones, every frame), so copying the channels across verbatim
 * would overwrite the target's rest pose with the mannequin's and skin the
 * body through the wrong bind pose.
 *
 * What this does instead, per bone, is a local-delta retarget:
 *
 *   D(t)       = inv(R_src_rest) * R_src(t)      how far the source bone bent
 *   R_tgt(t)   = R_tgt_rest * D(t)               same bend, from the target's rest
 *
 * so the target keeps its own rest pose and its own bone lengths, and only the
 * motion is borrowed. Translation is dropped for every bone except the hips,
 * where the source's offset from its own rest is scaled by the ratio of the
 * two hip heights — otherwise a crouch made for a shorter rig sinks the taller
 * one through the floor. Scale channels are dropped (the source's are all 1).
 *
 * Usage:
 *   node tools/retarget-anim.mjs <target.gltf> <source.glb> <out.glb> \
 *     Idle_Loop=Idle Jump_Start=Jump
 *
 * Each trailing argument is `sourceClip=newName`. Only the clips named are
 * copied — a 43-clip library is far past the model budget.
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'

const HIPS = 'pelvis'

const [targetPath, sourcePath, outPath, ...clipArgs] = process.argv.slice(2)
if (!targetPath || !sourcePath || !outPath || clipArgs.length === 0) {
  console.error('usage: retarget-anim.mjs <target> <source> <out> src=Name [src=Name ...]')
  process.exit(2)
}
if (outPath === targetPath || outPath === sourcePath) {
  console.error('refusing to write over an input')
  process.exit(2)
}

const clips = clipArgs.map((a) => {
  const [src, name] = a.split('=')
  if (!src || !name) throw new Error(`bad clip argument: ${a} (want source=NewName)`)
  return {src, name}
})

// --- quaternion helpers, glTF component order [x, y, z, w] ---------------
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]]
const qNorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const target = await io.read(targetPath)
const source = await io.read(sourcePath)

const tSkin = target.getRoot().listSkins()[0]
const sSkin = source.getRoot().listSkins()[0]
if (!tSkin || !sSkin) throw new Error('both files need a skin')

const tJoints = new Map(tSkin.listJoints().map((j) => [j.getName(), j]))
const sJoints = sSkin.listJoints()

const missing = sJoints.map((j) => j.getName()).filter((n) => !tJoints.has(n))
if (missing.length) throw new Error(`target is missing bones: ${missing.join(', ')}`)

// Hip height ratio: crouches and jumps made for the shorter rig have to travel
// proportionally further on the taller one.
const tHips = tJoints.get(HIPS)
const sHips = sJoints.find((j) => j.getName() === HIPS)
if (!tHips || !sHips) throw new Error(`no "${HIPS}" bone to scale hip motion by`)
// Measured as the LENGTH of the hips' rest offset, not its Y component: this
// rig comes out of Blender with the bone chain running up local +Z, so reading
// one axis would have compared the two rigs' sideways drift (0.86x) instead of
// their heights (1.03x).
const hipScale = Math.hypot(...tHips.getTranslation()) / Math.hypot(...sHips.getTranslation())

const rest = new Map()
for (const j of sJoints) {
  const t = tJoints.get(j.getName())
  rest.set(j.getName(), {
    srcRot: qNorm(j.getRotation()),
    tgtRot: qNorm(t.getRotation()),
    srcPos: j.getTranslation(),
    tgtPos: t.getTranslation(),
    node: t,
  })
}

const buffer = target.getRoot().listBuffers()[0]
let copied = 0

for (const {src, name} of clips) {
  const anim = source.getRoot().listAnimations().find((a) => a.getName() === src)
  if (!anim) throw new Error(`source has no clip "${src}"`)

  const out = target.createAnimation(name)

  for (const channel of anim.listChannels()) {
    const path = channel.getTargetPath()
    const boneName = channel.getTargetNode().getName()
    const r = rest.get(boneName)
    if (!r) continue
    if (path === 'scale') continue
    if (path === 'translation' && boneName !== HIPS) continue

    const sampler = channel.getSampler()
    const times = sampler.getInput().getArray()
    const values = sampler.getOutput().getArray()
    const stride = path === 'rotation' ? 4 : 3
    const outValues = new Float32Array(values.length)

    for (let f = 0; f * stride < values.length; f++) {
      const i = f * stride
      if (path === 'rotation') {
        const q = qNorm([values[i], values[i + 1], values[i + 2], values[i + 3]])
        const delta = qMul(qConj(r.srcRot), q)
        const outQ = qNorm(qMul(r.tgtRot, delta))
        outValues.set(outQ, i)
      } else {
        for (let k = 0; k < 3; k++) {
          outValues[i + k] = r.tgtPos[k] + (values[i + k] - r.srcPos[k]) * hipScale
        }
      }
    }

    const input = target
      .createAccessor(`${name}_${boneName}_${path}_t`)
      .setArray(Float32Array.from(times))
      .setType('SCALAR')
      .setBuffer(buffer)
    const output = target
      .createAccessor(`${name}_${boneName}_${path}`)
      .setArray(outValues)
      .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
      .setBuffer(buffer)

    const newSampler = target
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation(sampler.getInterpolation())
    out.addSampler(newSampler)
    out.addChannel(
      target.createAnimationChannel().setTargetNode(r.node).setTargetPath(path).setSampler(newSampler),
    )
  }

  copied++
  console.log(`  ${src} -> ${name}  (${out.listChannels().length} channels)`)
}

await io.write(outPath, target)
console.log(`\n${copied} clip(s) retargeted, hip motion scaled by ${hipScale.toFixed(4)}`)
console.log(`wrote ${outPath}`)
