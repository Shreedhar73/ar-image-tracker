/**
 * One-off asset prep for the Quaternius CC0 spider.
 *
 * Source carries eight clips: five Spider_* driving SpiderArmature, and three
 * Wasp_* driving a WaspArmature that is not in this file at all (leftover from
 * the pack export). Those three animate nothing and would make three.js
 * AnimationMixer warn on every load.
 *
 * Also renames the surviving clips: the source names them
 * "SpiderArmature|SpiderArmature|Spider_Idle", which would have to be repeated
 * verbatim in campaigns.ts and shown on a button to a child.
 */
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {prune, dedup, weld, resample} from '@gltf-transform/functions'

const [src, dst] = process.argv.slice(2)

const RENAME = {
  Spider_Idle: 'Idle',
  Spider_Walk: 'Walk',
  Spider_Jump: 'Jump',
  Spider_Attack: 'Attack',
}
// Dropped deliberately: Spider_Death (children's product) and the three Wasp_*
// clips (no WaspArmature in this file).

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(src)
const root = doc.getRoot()

for (const anim of root.listAnimations()) {
  const short = anim.getName().split('|').pop()
  const renamed = RENAME[short]
  if (renamed) {
    anim.setName(renamed)
  } else {
    console.log(`  dropping clip: ${anim.getName()}`)
    anim.dispose()
  }
}

const kept = root.listAnimations().map((a) => a.getName())
const missing = Object.values(RENAME).filter((n) => !kept.includes(n))
if (missing.length) throw new Error(`expected clips not found: ${missing.join(', ')}`)

await doc.transform(resample(), weld(), dedup(), prune())

await io.write(dst, doc)
console.log(`  clips: ${kept.join(', ')}`)

/*
 * Run (dependencies are NOT in this repo's package.json on purpose — asset prep
 * is a one-off, and CLAUDE.md keeps model authoring out of this repo):
 *
 *   mkdir -p /tmp/glbprep && cd /tmp/glbprep
 *   npm init -y && npm i @gltf-transform/core @gltf-transform/extensions \
 *     @gltf-transform/functions meshoptimizer
 *   node <repo>/tools/prep-glb.mjs <source.glb> ./spider-001.glb
 *   npx --yes @gltf-transform/cli@latest meshopt ./spider-001.glb ./out.glb
 *   cp ./out.glb <repo>/public/models/spider-001.glb
 *
 * Result for quaternius_cc0-spider-1368.glb: 721 KB -> 200 KB, clips
 * Idle/Walk/Jump/Attack, 1 skin / 59 joints verified still bound after meshopt.
 */
