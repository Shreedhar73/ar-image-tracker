/**
 * Generates a sticker artwork as an SVG. The argument is the campaign id.
 *
 *   node art/make-sticker.mjs spider-001 > art/spider-001.svg
 *   npx --yes sharp-cli@latest -i art/spider-001.svg -o art -f png flatten "#efe9dd"
 *
 * (`flatten` is a sharp-cli SUB-COMMAND taking the background colour, not a
 * `--flatten` flag; the flag form was removed and now exits non-zero. Without
 * it the PNG carries a pointless alpha channel.)
 *
 * Every entry in LAYOUTS differs from every other in its seed AND in the
 * arrangement of its large shapes AND in which creature it draws. The seed
 * alone is not enough: the tracker matches on the landmarks, the motif and the
 * creature, so two stickers that differ only in their speckle field are two
 * stickers the engine can confuse in one frame.
 *
 * Deliberate choices, all driven by how the tracker actually sees a sticker:
 *
 * - 1050x1400 (3:4 portrait). The image-target CLI's default crop is always
 *   3:4, so a 3:4 source is taken whole and the printed artwork equals the
 *   tracked region exactly. Any other aspect silently loses the edges.
 * - Tone, not hue. The engine only ever sees the 480x640 grayscale luminance
 *   image, so red-on-green with matching lightness is invisible to it. Every
 *   contrast here is a luminance contrast.
 * - Nothing thinner than ~6px. 1050 -> 480 is a 2.2x downscale; finer detail
 *   is gone by the time the tracker looks at it.
 * - No text, no fonts. librsvg font resolution inside sharp is unreliable and
 *   fails silently.
 * - Asymmetric by construction: the web is off-centre, the spider is rotated
 *   and offset, every leg bends differently, the four corner glyphs are four
 *   DIFFERENT shapes and the border dashes are randomised. Mirror or
 *   rotational symmetry gives the tracker two poses that fit equally well,
 *   which reads on a phone as a model that flips.
 * - No flat areas: a speckle field covers the whole frame, including
 *   underneath the large shapes.
 */

// Corner glyph centres. Four DIFFERENT shapes, one per corner: four copies of
// one glyph would give the tracker four equally good poses.
const CORNERS = [
  [113, 113],
  [937, 113],
  [113, 1287],
  [937, 1287],
]

/**
 * One entry per printed sticker, keyed by campaign id.
 *
 * An entry is only as good as the sticker it produced: once artwork has been
 * printed and compiled into public/targets/<id>, editing its entry silently
 * separates the printed sticker from the target the app tracks. Change the
 * artwork and you must re-run `npm run targets` for that id in the same commit.
 * A NEW sticker is a NEW entry, never an edit to an old one.
 */
const LAYOUTS = {
  'spider-001': {
    seed: 0x51D3B7,
    creature: 'spider',
    motif: 'web',
    motifAt: [250, 330],
    figure: [660, 980, 17, 1],
    ring: [835, 255],
    triangle: [112, 1195],
    chevrons: [905, 1060],
    blob: [150, 760],
    // Which glyph sits in which corner, in CORNERS order.
    corners: ['square', 'ring', 'wedge', 'plus'],
  },
  'dino-001': {
    seed: 0x2E9A41,
    // A different creature, and everything the tracker keys on is somewhere
    // else than on spider-001: the radial motif moves to the opposite corner,
    // the figure crosses the diagonal, and the corner glyphs are rotated one
    // place round.
    creature: 'dino',
    motif: 'fronds',
    motifAt: [790, 1080],
    figure: [380, 430, -6, 0.62],
    ring: [250, 1180],
    triangle: [760, 240],
    chevrons: [860, 700],
    blob: [140, 860],
    corners: ['plus', 'square', 'ring', 'wedge'],
  },
}

const id = process.argv[2]
const L = id ? LAYOUTS[id] : undefined
if (!L) {
  console.error(`usage: node art/make-sticker.mjs <${Object.keys(LAYOUTS).join('|')}> > art/<id>.svg`)
  process.exit(1)
}

// Seeded so re-running produces the identical sticker; the printed target and
// the compiled target must never drift apart.
let state = L.seed >>> 0
const rnd = () => {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  state >>>= 0
  return state / 0x100000000
}
const between = (a, b) => a + rnd() * (b - a)
const pick = (list) => list[Math.floor(rnd() * list.length)]

const W = 1050
const H = 1400

// A luminance ramp, not a colour scheme. Values are spread across the range so
// neighbouring elements always differ in grey level.
const INK = '#1c1a17'
const DARK = '#37312b'
const MID = '#6f6459'
const WARM = '#b9a184'
const PALE = '#ded6c8'
const PAPER = '#efe9dd'

const out = []
const add = (s) => out.push(s)

add(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
add(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`)

// --- ground texture: high-frequency detail everywhere, so no region is flat
for (let i = 0; i < 900; i++) {
  const x = between(0, W)
  const y = between(0, H)
  const r = between(3, 11)
  const fill = pick([INK, DARK, MID, WARM, PALE])
  if (rnd() < 0.55) {
    add(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="${between(0.35, 0.9).toFixed(2)}"/>`)
  } else {
    const a = between(0, Math.PI)
    const len = between(10, 34)
    add(
      `<line x1="${(x - Math.cos(a) * len).toFixed(1)}" y1="${(y - Math.sin(a) * len).toFixed(1)}" ` +
        `x2="${(x + Math.cos(a) * len).toFixed(1)}" y2="${(y + Math.sin(a) * len).toFixed(1)}" ` +
        `stroke="${fill}" stroke-width="${between(4, 9).toFixed(1)}" stroke-linecap="round" opacity="${between(0.3, 0.8).toFixed(2)}"/>`,
    )
  }
}

// --- the radial motif: a big line field, deliberately off-centre and clipped
// by the frame. It is the largest source of trackable edges on the sticker.
const [wx, wy] = L.motifAt

function drawWeb() {
const spokes = 9
const angles = []
for (let i = 0; i < spokes; i++) {
  // Irregular spacing: evenly spaced spokes would be rotationally symmetric.
  angles.push((i / spokes) * Math.PI * 2 + between(-0.16, 0.16))
}
for (const a of angles) {
  add(
    `<line x1="${wx}" y1="${wy}" x2="${(wx + Math.cos(a) * 700).toFixed(1)}" y2="${(wy + Math.sin(a) * 700).toFixed(1)}" stroke="${DARK}" stroke-width="7" stroke-linecap="round"/>`,
  )
}
for (let ring = 1; ring <= 6; ring++) {
  const rad = ring * between(78, 96)
  let d = ''
  angles.forEach((a, i) => {
    // Sag each strand differently so no two rings are concentric circles.
    const rr = rad * between(0.9, 1.08)
    const px = wx + Math.cos(a) * rr
    const py = wy + Math.sin(a) * rr
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`
  })
  add(`<path d="${d}Z" fill="none" stroke="${DARK}" stroke-width="${(7 - ring * 0.5).toFixed(1)}" stroke-linejoin="round"/>`)
}
}

/** Fern fronds for the dinosaur: the same job as the web, nothing web-like. */
function drawFronds() {
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * 1.15 + (i / 11) * Math.PI * 1.5 + between(-0.06, 0.06)
    const len = between(430, 720)
    const bend = between(-0.42, 0.42)
    const tipX = wx + Math.cos(a) * len
    const tipY = wy + Math.sin(a) * len
    const midX = wx + Math.cos(a + bend) * len * 0.55
    const midY = wy + Math.sin(a + bend) * len * 0.55
    add(
      `<path d="M${wx},${wy} Q${midX.toFixed(1)},${midY.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)}" ` +
        `fill="none" stroke="${DARK}" stroke-width="${between(6, 10).toFixed(1)}" stroke-linecap="round"/>`,
    )
    // Leaflets down each stem, shortening towards the tip.
    const leaves = Math.round(between(6, 10))
    for (let k = 1; k <= leaves; k++) {
      const t = k / (leaves + 1)
      const bx = wx + (midX - wx) * 2 * t * (1 - t) + (tipX - wx) * t * t
      const by = wy + (midY - wy) * 2 * t * (1 - t) + (tipY - wy) * t * t
      const spanA = a + Math.PI / 2
      const half = (1 - t) * between(22, 44)
      add(
        `<line x1="${(bx - Math.cos(spanA) * half).toFixed(1)}" y1="${(by - Math.sin(spanA) * half).toFixed(1)}" ` +
          `x2="${(bx + Math.cos(spanA) * half).toFixed(1)}" y2="${(by + Math.sin(spanA) * half).toFixed(1)}" ` +
          `stroke="${MID}" stroke-width="7" stroke-linecap="round"/>`,
      )
    }
  }
}

const MOTIFS = {web: drawWeb, fronds: drawFronds}
MOTIFS[L.motif]()

// --- landmark shapes: four distinct silhouettes at irregular positions, each
// a different shape so no two can be confused under rotation
const [rx, ry] = L.ring
add(`<circle cx="${rx}" cy="${ry}" r="96" fill="none" stroke="${INK}" stroke-width="22"/>`)
add(`<circle cx="${rx}" cy="${ry}" r="34" fill="${INK}"/>`)
const [tx, ty] = L.triangle
add(`<path d="M${tx},${ty} L${tx + 120},${ty - 67} L${tx + 156},${ty + 73} Z" fill="${INK}"/>`)
const [cx, cy] = L.chevrons
add(`<path d="M${cx},${cy} l-70,44 l70,44 M${cx + 50},${cy} l-70,44 l70,44" fill="none" stroke="${DARK}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`)
const [bx, by] = L.blob
add(`<path d="M${bx},${by} q90,-70 180,-14 q-40,110 -150,96 q-40,-40 -30,-82 Z" fill="${WARM}" stroke="${INK}" stroke-width="10"/>`)
add(`<path d="M${bx + 18},${by + 12} l138,26" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`)

// --- the creature: off-centre, rotated, and asymmetric by construction.
// scale() is omitted at 1 so a layout that does not scale emits the exact
// transform it always did.
const [fx, fy, frot, fscale] = L.figure
const figureTransform =
  `translate(${fx},${fy}) rotate(${frot})` + (fscale === 1 ? '' : ` scale(${fscale})`)

function drawSpider() {
const legs = []
for (let i = 0; i < 8; i++) {
  const side = i < 4 ? -1 : 1
  const k = i % 4
  const rootY = -60 + k * 42
  const spread = between(150, 235)
  const drop = between(-90, 120)
  const knee = between(0.35, 0.62)
  legs.push(
    `<path d="M0,${rootY.toFixed(0)} Q${(side * spread * knee).toFixed(0)},${(rootY - between(60, 130)).toFixed(0)} ` +
      `${(side * spread).toFixed(0)},${(rootY + drop).toFixed(0)}" fill="none" stroke="${INK}" ` +
      `stroke-width="${between(15, 22).toFixed(0)}" stroke-linecap="round"/>`,
  )
}
add(`<g transform="${figureTransform}">`)
add(legs.join(''))
add(`<ellipse cx="0" cy="70" rx="132" ry="150" fill="${INK}"/>`)
add(`<ellipse cx="-34" cy="34" rx="52" ry="44" fill="${PALE}" opacity="0.85"/>`)
add(`<ellipse cx="26" cy="118" rx="34" ry="60" fill="${WARM}" opacity="0.9"/>`)
add(`<ellipse cx="0" cy="-86" rx="86" ry="72" fill="${DARK}"/>`)
add(`<circle cx="-32" cy="-104" r="22" fill="${PAPER}"/>`)
add(`<circle cx="26" cy="-112" r="15" fill="${PAPER}"/>`)
add(`<circle cx="-30" cy="-100" r="10" fill="${INK}"/>`)
add(`<circle cx="27" cy="-109" r="7" fill="${INK}"/>`)
add(`</g>`)
}

/**
 * A side-on tyrannosaur, facing left. Drawn from filled silhouettes rather than
 * strokes: at 480x640 luminance a solid body survives the downscale where an
 * outline drawing turns to grey mush. Every mass differs in grey level from the
 * one it touches.
 */
function drawDino() {
  add(`<g transform="${figureTransform}">`)
  // tail, sweeping up and back
  add(`<path d="M40,-10 Q210,-25 345,-140 Q325,-60 245,-5 Q160,55 60,58 Z" fill="${INK}"/>`)
  // far hind leg, one step behind the near one
  add(`<path d="M25,45 Q70,120 40,195 L120,200 Q140,110 105,40 Z" fill="${DARK}"/>`)
  // body
  add(`<ellipse cx="0" cy="0" rx="152" ry="102" fill="${INK}"/>`)
  // belly, a lighter mass inside the dark one
  add(`<ellipse cx="-14" cy="46" rx="104" ry="44" fill="${WARM}" opacity="0.92"/>`)
  add(`<ellipse cx="52" cy="-30" rx="46" ry="34" fill="${PALE}" opacity="0.75"/>`)
  // back plates: five different triangles, none a copy of another
  for (let i = 0; i < 5; i++) {
    const bx = -90 + i * 52
    const h = between(30, 58)
    const lean = between(-16, 22)
    add(`<path d="M${bx},-92 L${(bx + 34).toFixed(0)},-88 L${(bx + 17 + lean).toFixed(0)},${(-92 - h).toFixed(0)} Z" fill="${DARK}"/>`)
  }
  // neck
  add(`<path d="M-78,-66 Q-142,-152 -214,-178 L-256,-104 Q-150,-58 -96,-16 Z" fill="${INK}"/>`)
  // head and jaw
  add(`<path d="M-352,-146 Q-306,-202 -232,-192 Q-192,-182 -198,-140 L-212,-100 Q-292,-92 -352,-114 Z" fill="${INK}"/>`)
  add(`<path d="M-346,-118 l32,20 l26,-20 l26,20 l26,-20 l26,20" fill="none" stroke="${PAPER}" stroke-width="9" stroke-linejoin="round"/>`)
  add(`<circle cx="-258" cy="-162" r="21" fill="${PAPER}"/>`)
  add(`<circle cx="-254" cy="-158" r="10" fill="${INK}"/>`)
  // the famously small arm
  add(`<path d="M-74,-14 q-46,26 -28,72 l40,-10 q-16,-32 12,-50 Z" fill="${DARK}"/>`)
  // near hind leg and foot
  add(`<path d="M-36,50 Q-70,128 -38,196 L44,198 Q66,112 44,42 Z" fill="${INK}"/>`)
  add(`<path d="M-58,188 l108,0 l20,30 l-146,0 Z" fill="${INK}"/>`)
  add(`</g>`)
}

const CREATURES = {spider: drawSpider, dino: drawDino}
CREATURES[L.creature]()

// --- border: randomised dash lengths, so the edge carries no repeating period
const inset = 34
const edge = (from, to, horizontal) => {
  let p = from
  while (p < to) {
    const len = between(26, 90)
    const gap = between(16, 44)
    const end = Math.min(p + len, to)
    add(
      horizontal
        ? `<line x1="${p.toFixed(0)}" y1="${inset}" x2="${end.toFixed(0)}" y2="${inset}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>` +
            `<line x1="${p.toFixed(0)}" y1="${H - inset}" x2="${end.toFixed(0)}" y2="${H - inset}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>`
        : `<line x1="${inset}" y1="${p.toFixed(0)}" x2="${inset}" y2="${end.toFixed(0)}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>` +
            `<line x1="${W - inset}" y1="${p.toFixed(0)}" x2="${W - inset}" y2="${end.toFixed(0)}" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>`,
    )
    p = end + gap
  }
}
edge(inset, W - inset, true)
edge(inset, H - inset, false)

// --- the corner glyphs, one shape per corner, permuted per layout.
const GLYPHS = {
  square: (x, y) => `<rect x="${x - 43}" y="${y - 43}" width="86" height="86" fill="${INK}"/>`,
  ring: (x, y) => `<circle cx="${x}" cy="${y}" r="46" fill="none" stroke="${INK}" stroke-width="20"/>`,
  wedge: (x, y) => `<path d="M${x - 43},${y + 43} L${x + 43},${y + 43} L${x - 43},${y - 43} Z" fill="${INK}"/>`,
  plus: (x, y) => `<path d="M${x - 43},${y} l86,0 m-43,-43 l0,86" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>`,
}
CORNERS.forEach(([x, y], i) => add(GLYPHS[L.corners[i]](x, y)))

add(`</svg>`)
process.stdout.write(out.join('\n'))
