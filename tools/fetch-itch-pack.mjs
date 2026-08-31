/**
 * Download a free itch.io asset pack.
 *
 * The Quaternius CC0 packs webhero-001 is built from live on itch.io
 * (quaternius.com did not resolve from this machine). Two things about that
 * flow are not obvious and both look like a broken script rather than a
 * protocol quirk:
 *
 *  - the signed URL `POST /<slug>/download_url` returns EXPIRES IN ~45 s, so
 *    the whole chain must run in one process — do not split it into steps;
 *  - the file endpoint is `POST /<slug>/file/<upload_id>?source=game_download`,
 *    NOT under the `/download/<key>/` path the download page's own URL implies.
 *    That one returns 404.
 *
 * Usage:
 *   node tools/fetch-itch-pack.mjs universal-base-characters ubc.zip
 *   node tools/fetch-itch-pack.mjs universal-animation-library ual.zip [user]
 *
 * `user` defaults to quaternius.
 */
import {writeFile} from 'node:fs/promises'

const [slug, out, user = 'quaternius'] = process.argv.slice(2)
if (!slug || !out) {
  console.error('usage: fetch-itch-pack.mjs <slug> <out.zip> [itch-user]')
  process.exit(2)
}

const base = `https://${user}.itch.io/${slug}`
const jar = new Map()
const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
const remember = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const i = pair.indexOf('=')
    jar.set(pair.slice(0, i), pair.slice(i + 1))
  }
}
const fetchWith = async (url, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: {'User-Agent': 'Mozilla/5.0', Referer: base, Cookie: cookies(), ...(init.headers ?? {})},
  })
  remember(res)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res
}
const csrfOf = (html) => {
  const m = html.match(/name="csrf_token" value="([^"]+)"/)
  if (!m) throw new Error('no csrf_token on the page — itch changed its markup')
  return m[1]
}

const page = await (await fetchWith(base)).text()
const {url: downloadPage} = await (
  await fetchWith(`${base}/download_url`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({csrf_token: csrfOf(page)}),
  })
).json()

const dp = await (await fetchWith(downloadPage)).text()
const uploadId = dp.match(/data-upload_id="(\d+)"/)?.[1]
const fileName = dp.match(/title="([^"]+)" class="name"/)?.[1]
if (!uploadId) throw new Error('no upload on the download page')
console.log(`upload ${uploadId}: ${fileName ?? '?'}`)

const {url: fileUrl} = await (
  await fetchWith(`${base}/file/${uploadId}?source=game_download`, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded', Referer: downloadPage},
    body: new URLSearchParams({csrf_token: csrfOf(dp)}),
  })
).json()

const bytes = Buffer.from(await (await fetchWith(fileUrl)).arrayBuffer())
await writeFile(out, bytes)
console.log(`wrote ${out} (${(bytes.length / 1e6).toFixed(1)} MB)`)
