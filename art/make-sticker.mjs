/**
 * Generates the spider-001 sticker artwork as an SVG.
 *
 *   node art/make-sticker.mjs > art/spider-001.svg
 *   npx --yes sharp-cli@latest -i art/spider-001.svg -o art -f png --flatten
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

// Seeded so re-running produces the identical sticker; the printed target and
// the compiled target must never drift apart.
const SEED = 0x51D3B7
let state = SEED >>> 0
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

// --- web, upper left, deliberately off-centre and clipped by the frame
const wx = 250
const wy = 330
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

// --- landmark shapes: four distinct silhouettes at irregular positions, each
// a different shape so no two can be confused under rotation
add(`<circle cx="835" cy="255" r="96" fill="none" stroke="${INK}" stroke-width="22"/>`)
add(`<circle cx="835" cy="255" r="34" fill="${INK}"/>`)
add(`<path d="M112,1195 L232,1128 L268,1268 Z" fill="${INK}"/>`)
add(`<path d="M905,1060 l-70,44 l70,44 M955,1060 l-70,44 l70,44" fill="none" stroke="${DARK}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`)
add(`<path d="M150,760 q90,-70 180,-14 q-40,110 -150,96 q-40,-40 -30,-82 Z" fill="${WARM}" stroke="${INK}" stroke-width="10"/>`)
add(`<path d="M168,772 l138,26" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`)

// --- the spider: off-centre, rotated, every leg different
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
add(`<g transform="translate(660,980) rotate(17)">`)
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

// --- four DIFFERENT corner glyphs. Four copies of one glyph would give the
// tracker four equally good poses.
add(`<rect x="70" y="70" width="86" height="86" fill="${INK}"/>`)
add(`<circle cx="937" cy="113" r="46" fill="none" stroke="${INK}" stroke-width="20"/>`)
add(`<path d="M70,1330 L156,1330 L70,1244 Z" fill="${INK}"/>`)
add(`<path d="M894,1287 l86,0 m-43,-43 l0,86" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>`)

add(`</svg>`)
process.stdout.write(out.join('\n'))
