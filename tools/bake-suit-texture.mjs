/**
 * Paint a costume onto a skinned character by baking a base-colour texture
 * from its own skin weights.
 *
 * The Quaternius superhero base ships a bare body with a 2048px skin texture.
 * Tinting the whole material one flat colour gives a painted mannequin, and
 * hand-painting a costume needs a UV layout nobody wrote down. But the rig
 * already says which part of the body every vertex belongs to: a vertex whose
 * dominant joint is `hand_r` is a glove, `ball_l` is a boot, `Head` is the
 * mask. So the bone names ARE the region map, and a costume can be rasterised
 * straight into UV space from them.
 *
 * Output is a PNG written with zlib's stored/deflate encoder — no image
 * library, so this cannot break when a transitive dependency moves. Compress
 * it afterwards with `@gltf-transform/cli webp` like every other texture here.
 *
 * Usage:
 *   node tools/bake-suit-texture.mjs <in.glb> <out.glb> [size]
 *
 * Regions and colours are the PALETTE table below. Edit it to reskin.
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {deflateSync} from 'node:zlib'

/**
 * A costume is a palette, a bone-name-to-region map, and optionally a web
 * overlay. Regions are matched first-wins against the vertex's heaviest joint.
 */
const COSTUMES = {
  /** Original masked climber. Two tones, no pattern, nobody's trademark. */
  hero: {
    palette: {
      suit: [0x12, 0x6e, 0x7d], // deep teal
      accent: [0xf2, 0xa1, 0x3b], // amber — gloves, boots, trunks
    },
    regions: [
      // Gloves and boots reach the elbow and the knee. Stopping at the wrist
      // and the ankle reads as bare hands and feet, not as a costume.
      [/^(hand|index|middle|pinky|ring|thumb|lowerarm)_/, 'accent'],
      [/^(foot|ball|calf)_/, 'accent'],
      [/^pelvis$/, 'accent'],
      [/./, 'suit'],
    ],
  },

  /**
   * Red-and-blue web-slinger. POC ONLY — this is somebody else's trade dress;
   * anything printed or shipped needs a licence or the `hero` costume above.
   */
  spider: {
    palette: {
      mask: [0xc4, 0x1e, 0x25],
      red: [0xc4, 0x1e, 0x25],
      blue: [0x1d, 0x35, 0x82],
      web: [0x14, 0x14, 0x18],
    },
    regions: [
      [/^(Head|neck_01)$/, 'mask'],
      [/^(spine_02|spine_03|clavicle_)/, 'red'],
      [/^(upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)_/, 'red'],
      [/^(foot|ball)_/, 'red'], // boots
      [/./, 'blue'],
    ],
    // Webbing goes on the red panels only, as on the printed character, and
    // each panel spins from its own centre: the torso web radiates from the
    // chest, the mask web from the bridge of the nose.
    web: {
      centres: {red: 'spine_03', mask: 'Head'},
      spokes: 16,
      rings: 9,
      spokeHalf: 0.022,
      ringHalf: 0.017,
      poleGap: 0.30,
      emblem: 1.25, // glyph size multiplier, 0 or false to omit
    },
  },
}

const [inPath, outPath, costumeName = 'hero', sizeArg] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('usage: bake-suit-texture.mjs <in.glb> <out.glb> [costume] [size]')
  console.error(`costumes: ${Object.keys(COSTUMES).join(', ')}`)
  process.exit(2)
}
const COSTUME = COSTUMES[costumeName]
if (!COSTUME) {
  console.error(`unknown costume "${costumeName}" — have ${Object.keys(COSTUMES).join(', ')}`)
  process.exit(2)
}
const PALETTE = COSTUME.palette
const REGIONS = COSTUME.regions
if (inPath === outPath) {
  console.error('refusing to write over the input')
  process.exit(2)
}
const SIZE = Number(sizeArg) || 1024

// --- minimal PNG writer (RGB8, no filtering) -----------------------------
function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0 // filter type 0
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

// --- bake ----------------------------------------------------------------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inPath)
const root = doc.getRoot()

const skin = root.listSkins()[0]
if (!skin) throw new Error('no skin — this bakes regions from bone names')
const jointNames = skin.listJoints().map((j) => j.getName())

// The body is the primitive with the most vertices; eyes and brows are tiny.
let prim = null
for (const mesh of root.listMeshes()) {
  for (const p of mesh.listPrimitives()) {
    if (!prim || p.getAttribute('POSITION').getCount() > prim.getAttribute('POSITION').getCount()) prim = p
  }
}
const uv = prim.getAttribute('TEXCOORD_0')
const joints = prim.getAttribute('JOINTS_0')
const weights = prim.getAttribute('WEIGHTS_0')
if (!uv || !joints || !weights) throw new Error('body primitive needs TEXCOORD_0, JOINTS_0 and WEIGHTS_0')

const regionOf = (name) => REGIONS.find(([re]) => re.test(name))[1]

const count = uv.getCount()
const pos = prim.getAttribute('POSITION')
const vertexRegion = new Array(count)
const tally = {}
for (let i = 0; i < count; i++) {
  const j = joints.getElement(i, [0, 0, 0, 0])
  const w = weights.getElement(i, [0, 0, 0, 0])
  let best = 0
  for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k
  const region = regionOf(jointNames[j[best]] ?? '')
  tally[region] = (tally[region] ?? 0) + 1
  vertexRegion[i] = region
}

// --- body frame ----------------------------------------------------------
// The rig comes out of Blender Z-up, and which way it FACES is not written
// anywhere. The toes are: the ball of the foot always sits forward of the
// ankle, so the vector between them, flattened, is the character's forward.
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const qRot = (q, v) => {
  const [x, y, z, w] = q
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]
  return [
    v[0] + w * t[0] + y * t[2] - z * t[1],
    v[1] + w * t[1] + z * t[0] - x * t[2],
    v[2] + w * t[2] + x * t[1] - y * t[0],
  ]
}
/** Rest-pose model-space position of a joint. Rotations compose too — summing
 * the translations alone puts every bone below the hips in the wrong place. */
const restOf = (name) => {
  const j = skin.listJoints().find((x) => x.getName() === name)
  if (!j) return null
  const chain = []
  for (let node = j; node; node = node.getParentNode()) chain.unshift(node)
  let p = [0, 0, 0]
  let r = [0, 0, 0, 1]
  for (const n of chain) {
    const t = qRot(r, n.getTranslation())
    p = [p[0] + t[0], p[1] + t[1], p[2] + t[2]]
    r = qMul(r, n.getRotation())
  }
  return p
}
const ankle = restOf('foot_l'), ball = restOf('ball_l')
let forward = [0, -1, 0]
if (ankle && ball) {
  const f = [ball[0] - ankle[0], ball[1] - ankle[1], 0]
  const l = Math.hypot(f[0], f[1]) || 1
  forward = [f[0] / l, f[1] / l, 0]
}
const right = [forward[1], -forward[0], 0]
const chest = restOf('spine_03') ?? [0, 0, 1.3]

// --- web pattern ---------------------------------------------------------
// Spun in 3D, not in UV: the seams between UV islands would otherwise cut the
// strands into unrelated fragments. Every pixel knows the model-space point it
// came from, so the web is one continuous sphere of spokes and rings around
// the chest, and it crosses island boundaries correctly.
const WEB = COSTUME.web

// The web's pole points FORWARD, not up: the strands converge on the chest and
// between the shoulder blades, which is where the printed character's spider
// sits. Poling it along world up instead turns the mask into vertical stripes.
const worldUp = [0, 0, 1]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l) }
const e1 = unit(cross(worldUp, forward))
const e2 = unit(cross(forward, e1))

const centres = {}
if (WEB) for (const [region, bone] of Object.entries(WEB.centres)) centres[region] = restOf(bone) ?? chest
// The mask centre wants to sit on the face, not inside the skull.
if (centres.mask) centres.mask = centres.mask.map((v, k) => v + forward[k] * 0.055 + (k === 2 ? 0.02 : 0))

function webInk(p, region) {
  const c = centres[region]
  if (!c) return 0
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
  const r = Math.hypot(...d) || 1e-6
  const u = d.map((v) => v / r)
  const polar = Math.acos(Math.max(-1, Math.min(1, dot(u, forward))))

  // Nothing is drawn at either pole: the strands would merge into a black disc,
  // and that is exactly where the emblem goes.
  if (polar < WEB.poleGap || polar > Math.PI - WEB.poleGap) {
    const step = Math.PI / WEB.rings
    return Math.abs(((polar % step) + step * 1.5) % step - step / 2) < WEB.ringHalf ? 1 : 0
  }

  const az = Math.atan2(dot(u, e2), dot(u, e1))
  const azStep = (2 * Math.PI) / WEB.spokes
  const spoke = Math.abs(((az % azStep) + azStep * 1.5) % azStep - azStep / 2)
  const ringStep = Math.PI / WEB.rings
  const ring = Math.abs(((polar % ringStep) + ringStep * 1.5) % ringStep - ringStep / 2)
  return spoke < WEB.spokeHalf || ring < WEB.ringHalf ? 1 : 0
}

/** A spider glyph: fat abdomen, small head, four legs a side. */
function emblemInk(p, region) {
  if (!WEB?.emblem || region !== 'red') return 0
  const d = [p[0] - chest[0], p[1] - chest[1], p[2] - chest[2]]
  const front = d[0] * forward[0] + d[1] * forward[1]
  const side = d[0] * right[0] + d[1] * right[1]
  const up = d[2]
  const facing = Math.abs(front) > 0.02 ? Math.sign(front) : 0
  if (!facing) return 0
  const depth = Math.abs(front)
  if (depth < 0.02) return 0
  const k = WEB.emblem
  const x = Math.abs(side) / k, y = up / k
  if (x > 0.115 || Math.abs(y) > 0.115) return 0
  const ell = (cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1
  if (ell(0, -0.030, 0.026, 0.048)) return 1 // abdomen
  if (ell(0, 0.028, 0.018, 0.022)) return 1 // head
  for (let i = 0; i < 4; i++) {
    const knee = [0.030 + i * 0.004, 0.048 - i * 0.030]
    const tip = [0.082 - i * 0.006, 0.070 - i * 0.055]
    const near = (ax, ay, bx, by) => {
      const vx = bx - ax, vy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)))
      return Math.hypot(x - (ax + vx * t), y - (ay + vy * t)) < 0.006
    }
    if (near(0.012, 0.010, knee[0], knee[1]) || near(knee[0], knee[1], tip[0], tip[1])) return 1
  }
  return 0
}

const img = Buffer.alloc(SIZE * SIZE * 3)
const seen = new Uint8Array(SIZE * SIZE)
const indices = prim.getIndices()
const triCount = indices ? indices.getCount() / 3 : count / 3
const at = (t) => (indices ? indices.getScalar(t) : t)

for (let t = 0; t < triCount; t++) {
  const vi = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)]
  const p = vi.map((i) => {
    const e = uv.getElement(i, [0, 0])
    return [e[0] * SIZE, e[1] * SIZE]
  })
  const P = vi.map((i) => pos.getElement(i, [0, 0, 0]))
  const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])) - 1)
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])) + 1)
  const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])) - 1)
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])) + 1)
  const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1])
  if (Math.abs(d) < 1e-12) continue
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5
      let a = ((p[1][1] - p[2][1]) * (px - p[2][0]) + (p[2][0] - p[1][0]) * (py - p[2][1])) / d
      let b = ((p[2][1] - p[0][1]) * (px - p[2][0]) + (p[0][0] - p[2][0]) * (py - p[2][1])) / d
      let g = 1 - a - b
      // A one-pixel tolerance keeps hairline gaps from opening along shared edges.
      if (a < -0.02 || b < -0.02 || g < -0.02) continue
      a = Math.max(0, a); b = Math.max(0, b); g = Math.max(0, g)

      // Region is the nearest vertex's, not a blend: a costume has hard edges.
      const w = [a, b, g]
      let dom = 0
      for (let k = 1; k < 3; k++) if (w[k] > w[dom]) dom = k
      const region = vertexRegion[vi[dom]]
      let colour = PALETTE[region]

      if (WEB) {
        const worldP = [0, 1, 2].map((k) => a * P[0][k] + b * P[1][k] + g * P[2][k])
        if (emblemInk(worldP, region)) colour = PALETTE.web
        else if (webInk(worldP, region)) colour = PALETTE.web
      }

      const o = (y * SIZE + x) * 3
      img[o] = colour[0]; img[o + 1] = colour[1]; img[o + 2] = colour[2]
      seen[y * SIZE + x] = 1
    }
  }
}

// Bleed the islands outward so mip-mapping does not sample background into the
// silhouette edges.
for (let pass = 0; pass < 6; pass++) {
  const grown = seen.slice()
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (seen[y * SIZE + x]) continue
      let r = 0, g = 0, b = 0, n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || !seen[ny * SIZE + nx]) continue
        const o = (ny * SIZE + nx) * 3
        r += img[o]; g += img[o + 1]; b += img[o + 2]; n++
      }
      if (!n) continue
      const o = (y * SIZE + x) * 3
      img[o] = r / n; img[o + 1] = g / n; img[o + 2] = b / n
      grown[y * SIZE + x] = 1
    }
  }
  seen.set(grown)
}

const png = encodePNG(img, SIZE, SIZE)
const material = prim.getMaterial()
const texture = doc
  .createTexture('T_Suit_BaseColor')
  .setImage(png)
  .setMimeType('image/png')
material.setBaseColorTexture(texture)
material.setBaseColorFactor([1, 1, 1, 1])

await io.write(outPath, doc)
const parts = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')
console.log(`baked ${SIZE}px ${costumeName} suit from ${count} weighted vertices (${parts})`)
console.log(`wrote ${outPath}`)
