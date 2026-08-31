#!/usr/bin/env node
/**
 * Compiles a sticker image into an 8th Wall image target.
 *
 * Deviation from CLAUDE.md, verified against the CLI's own README
 * (https://github.com/8thwall/8thwall/blob/main/apps/image-target-cli):
 * @8thwall/image-target-cli is INTERACTIVE ONLY — it documents no flags and no
 * positional arguments. So this script cannot be a silent wrapper. It prints
 * the exact answers to type, hands you the CLI, then takes over afterwards to
 * move the output into public/targets/<id>/ and rewrite `imagePath` to a URL
 * this app actually serves. That last step is the part worth automating: a
 * target whose imagePath 404s never fires `imagescanning` and looks, on a
 * phone, exactly like artwork that will not track.
 *
 *   npm run targets -- <image> <campaign-id>
 */
import {spawnSync} from 'node:child_process'
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename, join, resolve} from 'node:path'

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
if (existsSync(outDir)) {
  console.error(`${outDir} already exists — delete it first if you mean to recompile`)
  process.exit(1)
}

console.log(`
The 8th Wall image-target CLI is interactive. Answer its prompts with:

  image path   ${imagePath}
  target name  ${campaignId}       <- must match exactly; it becomes detail.name
  geometry     flat
  crop         default (centred), unless the artwork needs trimming

`)

const workDir = mkdtempSync(join(tmpdir(), 'image-target-'))
const result = spawnSync('npx', ['@8thwall/image-target-cli@latest'], {
  cwd: workDir,
  stdio: 'inherit',
  shell: false,
})

if (result.status !== 0) {
  rmSync(workDir, {recursive: true, force: true})
  console.error(`image-target-cli exited with ${result.status}`)
  process.exit(1)
}

// The CLI writes a folder named after the target. Find whatever it produced
// rather than assuming, so a mistyped name is caught here and not on a phone.
const produced = readdirSync(workDir, {withFileTypes: true})
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(workDir, entry.name))

const sourceDir = produced.length === 1 ? produced[0] : produced.find((dir) => basename(dir) === campaignId)
if (!sourceDir) {
  console.error(`could not find the CLI output in ${workDir} — leaving it in place for inspection`)
  process.exit(1)
}

const jsonName = readdirSync(sourceDir).find((file) => file.endsWith('.json'))
if (!jsonName) {
  console.error(`no .json in ${sourceDir} — leaving it in place for inspection`)
  process.exit(1)
}

mkdirSync(outDir, {recursive: true})
cpSync(sourceDir, outDir, {recursive: true})
rmSync(workDir, {recursive: true, force: true})

const jsonPath = join(outDir, jsonName)
const target = JSON.parse(readFileSync(jsonPath, 'utf8'))

if (target.name !== campaignId) {
  console.error(
    `target name is "${target.name}" but the campaign id is "${campaignId}".\n` +
      `detail.name is matched literally, so these must be identical. Delete ${outDir} and recompile.`,
  )
  process.exit(1)
}

// imagePath is resolved by the engine against the served page. Point it at the
// static asset URL, not at whatever local path the CLI recorded.
const servedImage = `/targets/${campaignId}/${basename(target.imagePath ?? '')}`
if (!existsSync(join(outDir, basename(servedImage)))) {
  console.error(`imagePath "${target.imagePath}" does not name a file that was copied into ${outDir}`)
  process.exit(1)
}
target.imagePath = servedImage
writeFileSync(jsonPath, `${JSON.stringify(target, null, 2)}\n`, 'utf8')

console.log(`
Wrote ${outDir}
  imagePath -> ${servedImage}

Next:
  1. Commit public/targets/${campaignId}/
  2. Add the entry to src/config/campaigns.ts:

  '${campaignId}': {
    targetName: '${campaignId}',
    targetJson: '/targets/${campaignId}/${jsonName}',
    model: '/models/${campaignId}.glb',
    scale: 1,
    idleAnim: 'Idle',
    animations: ['Idle'],
  },
`)
