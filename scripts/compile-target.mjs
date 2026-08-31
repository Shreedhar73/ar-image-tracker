#!/usr/bin/env node
/**
 * Compiles a sticker image into an 8th Wall image target.
 *
 *   npm run targets -- <image> <campaign-id>
 *
 * @8thwall/image-target-cli is INTERACTIVE — its README documents no flags and
 * no positional arguments. It does read piped stdin, so this script answers its
 * prompts non-interactively, then rewrites `imagePath` in the produced JSON to
 * a URL this app actually serves. That rewrite is the part worth automating: a
 * target whose imagePath 404s never fires `imagescanning` and looks, on a
 * phone, exactly like artwork that will not track.
 *
 * The prompt ORDER below is the contract, and it is not versioned — hence the
 * pin. If the CLI is bumped, re-read src/interactive.js and re-check the
 * sequence before changing PINNED_CLI.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {basename, join, resolve} from 'node:path'

const PINNED_CLI = '@8thwall/image-target-cli@1.0.0'

const [imageArg, campaignId] = process.argv.slice(2)

if (!imageArg || !campaignId) {
  console.error('usage: npm run targets -- <image> <campaign-id>')
  process.exit(1)
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(campaignId)) {
  console.error(`campaign id "${campaignId}" must be lowercase kebab-case — it goes in a printed URL`)
  process.exit(1)
}

const imagePath = resolve(imageArg)
if (!existsSync(imagePath)) {
  console.error(`image not found: ${imagePath}`)
  process.exit(1)
}

const outDir = resolve('public/targets', campaignId)
if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  console.error(`${outDir} is not empty — delete it first if you mean to recompile`)
  process.exit(1)
}
mkdirSync(outDir, {recursive: true})

// Prompt order for a FLAT target, read out of the CLI's src/interactive.js:
//   1. image path   2. image type   3. use default crop?
//   4. output folder   5. target name
// Answers are explicit rather than blank-for-default, so a reordered default
// cannot silently pick a different geometry.
const answers = [imagePath, 'flat', 'y', outDir, campaignId]

console.log(`compiling ${basename(imagePath)} as "${campaignId}" (flat, default 3:4 crop)`)

const result = spawnSync('npx', ['--yes', PINNED_CLI], {
  input: `${answers.join('\n')}\n`,
  encoding: 'utf8',
  env: {...process.env, OVERWRITE_FILES: 'true'},
})

const transcript = `${result.stdout ?? ''}${result.stderr ?? ''}`
const jsonPath = join(outDir, `${campaignId}.json`)

if (result.status !== 0 || !existsSync(jsonPath)) {
  console.error(transcript)
  console.error(
    `\n${PINNED_CLI} did not produce ${jsonPath}.\n` +
      `Its prompts are unversioned — if they have changed, run it by hand:\n` +
      `  npx ${PINNED_CLI}\n` +
      `answering: ${answers.join(' | ')}`,
  )
  process.exit(1)
}

const target = JSON.parse(readFileSync(jsonPath, 'utf8'))

if (target.name !== campaignId) {
  console.error(
    `target name is "${target.name}" but the campaign id is "${campaignId}".\n` +
      `detail.name is matched literally, so these must be identical.`,
  )
  process.exit(1)
}

// The CLI writes imagePath as "image-targets/<name>_luminance.<ext>". The
// engine resolves it against the served page, and pages are served at
// /ar/<id>, so it has to be root-absolute and point at where we serve it.
const luminance = basename(target.imagePath ?? '')
if (!luminance || !existsSync(join(outDir, luminance))) {
  console.error(`imagePath "${target.imagePath}" does not name a file that was written into ${outDir}`)
  process.exit(1)
}
target.imagePath = `/targets/${campaignId}/${luminance}`

// The CLI also emits full-size copies of the source and the crop. The engine
// reads ONLY `imagePath` — verified against xr-slam.js, which is where image
// targets are actually loaded and which never touches `resources` — so these
// are two multi-megabyte files that ship to every phone and are never fetched.
// The thumbnail is kept: it is small and it is the only human-readable
// at-a-glance record of what the campaign tracks.
for (const key of ['originalImage', 'croppedImage']) {
  const filename = target.resources?.[key]
  if (!filename) continue
  rmSync(join(outDir, filename), {force: true})
  delete target.resources[key]
}

writeFileSync(jsonPath, `${JSON.stringify(target, null, 2)}\n`, 'utf8')

const {width, height} = target.properties ?? {}
console.log(`
Wrote ${outDir}
  files      ${readdirSync(outDir).join(', ')}
  crop       ${String(width)} x ${String(height)}
  imagePath  ${target.imagePath}

Next:
  1. Open ${join(outDir, luminance)} and judge THAT against the artwork gate —
     it is exactly what the tracker sees.
  2. Add the entry to src/config/campaigns.ts.
`)
