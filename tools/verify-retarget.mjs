/**
 * Does the retarget actually reproduce the source motion?
 *
 * Compares world-space joint positions between the source rig and the
 * retargeted one, frame by frame, after dividing both by their own hip height.
 * Two rigs of different proportions can never match in absolute units; in
 * height-normalised units a correct retarget matches closely and a broken one
 * (rest pose overwritten, wrong hip scale, quaternion order flipped) does not.
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'

const [srcPath, srcClip, tgtPath, tgtClip] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

const qMul = (a, b) => [
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2],
]
const qRot = (q, v) => {
  const [x, y, z, w] = q
  const t = [2*(y*v[2]-z*v[1]), 2*(z*v[0]-x*v[2]), 2*(x*v[1]-y*v[0])]
  return [
    v[0] + w*t[0] + y*t[2] - z*t[1],
    v[1] + w*t[1] + z*t[0] - x*t[2],
    v[2] + w*t[2] + x*t[1] - y*t[0],
  ]
}

function poseAt(doc, clipName, time) {
  const skin = doc.getRoot().listSkins()[0]
  const joints = skin.listJoints()
  const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName)
  const local = new Map()
  for (const j of joints) local.set(j, {t: j.getTranslation(), r: j.getRotation()})
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode()
    if (!local.has(node)) continue
    const s = ch.getSampler()
    const times = s.getInput().getArray()
    const vals = s.getOutput().getArray()
    let f = 0
    while (f < times.length - 1 && times[f + 1] <= time) f++
    const stride = ch.getTargetPath() === 'rotation' ? 4 : 3
    const v = Array.from(vals.slice(f * stride, f * stride + stride))
    if (ch.getTargetPath() === 'rotation') local.get(node).r = v
    if (ch.getTargetPath() === 'translation') local.get(node).t = v
  }
  const world = new Map()
  const walk = (node, pt, pr) => {
    const l = local.get(node) || {t: node.getTranslation(), r: node.getRotation()}
    const r = qMul(pr, l.r)
    const rotated = qRot(pr, l.t)
    const t = [pt[0] + rotated[0], pt[1] + rotated[1], pt[2] + rotated[2]]
    world.set(node.getName(), t)
    for (const c of node.listChildren()) walk(c, t, r)
    return world
  }
  const roots = joints.filter((j) => !joints.includes(j.getParentNode()))
  for (const r of roots) walk(r, [0, 0, 0], [0, 0, 0, 1])
  return world
}

const src = await io.read(srcPath)
const tgt = await io.read(tgtPath)

const anim = src.getRoot().listAnimations().find((a) => a.getName() === srcClip)
const times = anim.listSamplers()[0].getInput().getArray()

const probes = ['Head', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'pelvis', 'spine_03']
let worst = 0, worstAt = ''
const sHip = poseAt(src, srcClip, 0).get('Head')
const tHip = poseAt(tgt, tgtClip, 0).get('Head')
const sH = Math.hypot(...sHip), tH = Math.hypot(...tHip)

for (const time of times) {
  const a = poseAt(src, srcClip, time)
  const b = poseAt(tgt, tgtClip, time)
  for (const p of probes) {
    const u = a.get(p).map((v) => v / sH)
    const v = b.get(p).map((v) => v / tH)
    const d = Math.hypot(u[0]-v[0], u[1]-v[1], u[2]-v[2])
    if (d > worst) { worst = d; worstAt = `${p} @ ${time.toFixed(2)}s` }
  }
}
console.log(`source height ${sH.toFixed(3)}  target height ${tH.toFixed(3)}  (${(tH/sH).toFixed(3)}x)`)
console.log(`worst normalised joint offset: ${worst.toFixed(4)} head-heights  (${worstAt})`)
console.log(worst < 0.06 ? 'PASS — motion reproduced' : 'FAIL — motion does not match the source')
process.exit(worst < 0.06 ? 0 : 1)
