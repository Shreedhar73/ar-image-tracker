# AR Sticker — WebAR for printed stickers

Point a phone at a printed sticker and an animated 3D character stands up on it.
No app install, no login, no account. A QR code on the sticker opens
`https://<host>/ar/<campaign-id>` in the phone's browser and the experience runs
there.

Built for children's 8×8 cm stickers: one sticker = one campaign = one QR code.

**Tracking** is [8th Wall Engine](https://8thwall.org) (image targets, no SLAM).
**Rendering** is [three.js](https://threejs.org). **Hosting** is static — there
is no backend.

---

## Status

| Phase | What it means | State |
| --- | --- | --- |
| 1 — Boot | Engine loads, camera feed visible | Working on device |
| 2 — Track | Sticker detected, pose applied | Working on device |
| 3 — Character | GLB, animation, lighting, shadow | Working on device |
| 4 — Product UI | Start, scan hint, buttons, errors, capture | Working on device |
| 5 — Ship | Vercel deploy, QR codes, full device matrix | Not started |

Phases 1–4 have been run on a physical phone: camera feed, image tracking,
the animated character, and both photo and video capture with native share all
work. Video plays back with content, which is the check that matters —
`canvas.captureStream` on a WebGL canvas is exactly where black-frame problems
would appear.

Not yet done: a Vercel deploy, printed QR codes, and a full device matrix
(iOS Safari + Android Chrome + one low-end Android, cold-load timing on mobile
data). Phase-5 gates are in
[`.claude/skills/ar-phone-test`](.claude/skills/ar-phone-test).

---

## Quick start

```sh
npm install
npm run dev          # http://localhost:3002
```

The camera needs HTTPS or `localhost`. To test on a real phone:

```sh
npm run dev
ngrok http 3002      # open the https:// URL on the phone
```

Then visit `/ar/spider-001` or `/ar/dino-001` — either one brings up the whole
`creatures` pack, so both stickers track in the same session. Add `?debug=1` for
the diagnostic panel (session, camera status, tracking state, which stickers are
in view, loaded clips).

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:3002` |
| `npm run build` | `tsc --noEmit && vite build` → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run check` | `tsc --noEmit && eslint .` |
| `npm run targets -- <image> <id>` | Compile a sticker image into an image target |
| `npm run glb -- <in.glb> [out.glb]` | Check/fix a model against the installed three.js |

---

## Architecture

One file, one job. The division below is non-negotiable — mixing the two sides is
how the previous MindAR proof-of-concept became unmaintainable.

| 8th Wall (`XR8`) owns | three.js owns |
| --- | --- |
| Camera access and drawing the camera feed | Scene graph, lights, environment, shadows |
| Image-target detection and 6DoF pose | GLB loading, materials, `AnimationMixer` |
| Camera intrinsics / projection matrix | The anchor `Group` per target, model placement |
| Device and browser compatibility | Everything the user sees except the video feed |

```
src/
  main.ts                        boot: resolve campaign → start AR → wire UI
  config/campaigns.ts            registry: id → target, model, scale, animations
  ar/xr8.ts                      the ONLY 8th Wall boundary; every `any` lives here
  ar/imageTracker.ts             reality.image* events → one anchor Group per target
  three/ThreeScene.ts            renderer settings, lights, shadow catcher
  three/ModelLoader.ts           GLTFLoader + Draco/meshopt, with a texture guard
  three/AnimationController.ts   mixer + crossfade
  capture/capture.ts             photo, video, native share
  ui/                            start screen, scan hint, buttons, errors, capture bar
tools/                           asset pipeline: glb-doctor, model prep
scripts/compile-target.mjs       image-target compiler
art/                             sticker source artwork (printed and compiled)
```

### Boot order — the part that bites

Kept in one function in `src/ar/xr8.ts` so the order is visible in a single read:

```ts
;(window as any).THREE = THREE          // 1. XR8.Threejs.pipelineModule() reads the global

XR8.XrController.configure({            // 2. MUST precede pipelineModule() AND run(),
  disableWorldTracking: true,           //    or these are silently ignored
  imageTargetData: [target],
})

sizeCanvasToViewport(canvas)            // 3. see "full-screen canvas" below

XR8.addCameraPipelineModules([          // 4. engine modules first, ours last
  XR8.GlTextureRenderer.pipelineModule(),
  XR8.Threejs.pipelineModule(),
  XR8.XrController.pipelineModule(),
  ourModule,
])

XR8.run({canvas, allowedDevices: XR8.XrConfig.device().ANY})
```

There is **no `requestAnimationFrame` loop and no second `WebGLRenderer`**. The
engine calls `renderer.render()` once per camera frame; per-frame work (mixer,
timer) goes in our pipeline module's `onUpdate`.

Pose is applied **inside the event handler**, never polled:

```ts
group.position.set(d.position.x, d.position.y, d.position.z)
group.quaternion.set(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w)
group.scale.setScalar(d.scale)
```

Note the field order — the event gives `{w, x, y, z}` and `Quaternion.set()`
takes `(x, y, z, w)`. Getting it wrong yields a model that tracks position but
tumbles in rotation. Polling instead of handling the event yields a model
reliably one frame behind the camera feed, which was the old POC's bug.

---

## 8th Wall in 2026 — read before touching `src/ar/`

The hosted 8th Wall platform (console, app keys, cloud editor, target upload)
**was retired on 28 February 2026**. There is no app key. Any snippet you find
online referencing `apps.8thwall.com`, `appKey`, or console-uploaded targets
predates the retirement and is dead.

Tracking now comes from the distributed engine binary:

```sh
npm install @8thwall/engine-binary
```

`vite-plugin-static-copy` copies it into the build as `external/xr/`, and
`index.html` loads it with a **root-absolute** path:

```html
<script src="/external/xr/xr.js" async data-preload-chunks="slam"></script>
```

Root-absolute matters: `/ar/<id>` routes are rewritten to `index.html`, so a
relative `./external/xr/xr.js` would resolve to `/ar/external/xr/xr.js` and 404.
The engine is never loaded from a CDN in production; it ships with the app.

### The engine is trimmed from 36 MB to ~9.6 MB

Every engine resource sits behind a lazy URL builder (`hI = A => () => wI() + A`),
so each file is fetched only at its one call site. Those call sites were read out
of the minified chunks. For an image-target-only app, four are unreachable:

| Excluded | Size | Only reachable from |
| --- | --- | --- |
| `*.tflite` (4 files) | 16.6 MB | face tracking, sky segmentation |
| `xr-face.js` | 7.3 MB | face tracking |
| `semantics-worker.js` | 5.0 MB | sky segmentation |
| `media-worker.js` | 5.0 MB | `XR8.MediaRecorder` |

**`xr-slam.js` is kept** even though `disableWorldTracking: true` — image-target
loading lives in that chunk, not in `xr.js`. `powered-by.svg` is kept because the
engine renders it unconditionally (and attribution is required).

Adding face effects, sky effects or video capture via the engine means putting
these back. The symptom of getting it wrong is a 404 on a phone, not a build
error. See the exclusion list and reasoning in `vite.config.ts`.

---

## Campaigns

```ts
export const campaigns = {
  "dino-001": {
    targetName: "dino-001",                            // must equal `name` in the target JSON
    targetJson: "/targets/dino-001/dino-001.json",     // fetched at runtime, not bundled
    model: "/models/dino-001-basecolor-small.glb",
    scale: 1,                                          // multiplier on scaledWidth, not absolute
    idleAnim: "Animation",
    animations: ["Animation"],                         // button order the child sees
    pack: "creatures",                                 // stickers tracked in the same session
  },
} satisfies Record<string, Campaign>
```

Route: `/ar/<id>` is canonical and is what gets printed. `?id=` works for desktop
testing only. **An unknown id shows a friendly error screen — never a fallback
campaign.** A child scanning a frog sticker must not get a dinosaur.

### One endpoint, many stickers

A page load tracks a **pack**, not a single sticker. The engine holds several
image targets at once, so scanning one sticker's QR brings up every sticker
filed under the same `pack`: point the phone at a friend's sticker and their
character appears too, from the same page, with no reload.

| URL | Tracks |
| --- | --- |
| `/ar/dino-001` | the whole `creatures` pack, dino-001's model pre-loaded |
| `/ar/creatures` | the whole pack, nothing singled out |
| `/ar` | the only pack — an error once a second pack exists |

A pack is at most **10 stickers** and `campaigns.ts` throws at import if one is
bigger. That 10 is our policy, not a number the engine reports — nobody has
measured what this binary does at target 11.

**If packs do not hold up, the way back is one sticker per link, and it is a
one-field change**: give each campaign its own `pack` value and every URL tracks
exactly one sticker. No code edit, no route change, nothing to revert — a pack
of one is a valid pack, and `/ar/<id>` was always the printed URL in both modes.

Where the 10 came from, why a limit exists at all, what actually runs out first,
the measurement that would settle it, and the two modes above these — see
[`docs/image-target-budget.md`](docs/image-target-budget.md). Read it before
changing `MAX_ACTIVE_TARGETS` or adding an eleventh sticker to a pack.

Per sticker, lazily: its GLB downloads on **first sight**, not at boot, and is
cached for the rest of the session. 20 characters at ~1.2 MB each is not
something a phone should hold, and most of them will never be pointed at. Only
the sticker named in the URL is fetched up front, behind the start tap. Each
sticker gets its own anchor, shadow catcher, lights and mixer; the button bar
follows whichever sticker came into view last.

Target JSON is fetched at runtime rather than imported through the bundler, so a
recompiled target is swappable without a rebuild.

Model size derives from the event's `scaledWidth`, so an 8 cm sticker produces
the same on-screen character on every device. `campaign.scale` multiplies that.

---

## Asset pipeline

### Image targets

```sh
npm run targets -- art/my-sticker.png my-campaign-id
```

`@8thwall/image-target-cli` is interactive — it documents no flags — but it does
read piped stdin, so the script answers its prompts, writes into
`public/targets/<id>/`, checks the target name matches the campaign id, and
rewrites `imagePath` to the URL we actually serve. A target whose `imagePath`
404s never fires `imagescanning` and, on a phone, looks exactly like artwork that
will not track.

The CLI version is **pinned**: its prompt order is the contract and is not
versioned.

Two rules that constrain all target artwork:

- **The default crop is always 3:4.** Author at 3:4 or 4:3 and the whole image is
  taken; any other aspect silently loses its edges to a centred crop.
- **The engine only ever sees the 480×640 grayscale luminance image.** Judge
  *that* file against the artwork gate, not the source art. Hue contrast at equal
  lightness is invisible to the tracker, and detail finer than ~4 px at 1050 px
  source does not survive the downscale.

### Models

```sh
npm run glb -- public/models/foo.glb                  # report
npm run glb -- public/models/foo.glb foo-fixed.glb    # report and fix
```

`tools/glb-doctor.mjs` checks a GLB against the three.js **this repo installs**.
The supported-extension list is parsed out of the installed `GLTFLoader.js` at
run time rather than hardcoded, so upgrading three re-derives the check instead
of quietly invalidating it. It reports unsupported extensions, whether any
material actually reaches a base-colour texture, texture sizes, rig and clip
names (printed ready to paste into `campaigns.ts`), and size against the 2 MB
budget. Given an output path it fixes the specular-glossiness case, then re-reads
the file it wrote to prove extensions are clear, base colour is present, and
joints and clips survived. It refuses to write over its input.

Run it on every model **before** wiring it into `campaigns.ts`.

---

## Hard-won findings

Things that cost real debugging time here, none of which are in any doc.

**Image targets use the XY plane, +Z is the surface normal.** For a FLAT target,
"up off the paper" is +Z, not +Y. Verified against
`8thwall/aframe-image-targets-example`, where an unrotated A-Frame `plane`
primitive — an XY quad — lands flush on the printed artwork. GLBs are authored
Y-up, so the model goes under a group rotated `+PI/2` about X. The shadow-catcher
plane needs no rotation.

**The camera feed will render as a 300×150 box in the corner.** The engine builds
its renderer from the canvas's `width`/`height` *attributes*, which default to
300×150 on a bare `<canvas>`. three.js `setSize()` then writes that back as an
*inline* style, which outranks any stylesheet. A full-screen CSS rule alone never
applies. Size the attributes to the viewport before `run()`.

**A wrong asset path returns `200 text/html`, not `404`.** The `/ar/*` rewrite
means a typo'd model URL serves `index.html`, and `GLTFLoader` then reports
`Unexpected token '<'`, which names neither the file nor the cause. `loadModel`
asserts the glTF magic number and `loadTargetData` asserts the content type, so
both now say *"a served index.html here means the file does not exist at that
path"*.

**A model whose textures three.js cannot read renders plain white and says
almost nothing.** `KHR_materials_pbrSpecularGlossiness` was *removed* from
three.js; a GLB requiring it still loads, but the loader ignores every
`diffuseTexture` and falls back to a blank `MeshStandardMaterial`, whispering one
`Unknown extension` warning. `ModelLoader` now detects this and names the fix.

The check is specifically for the **base-colour** map. `normalTexture` and
`occlusionTexture` are core glTF and still get applied, so an earlier version
asking "does any map slot exist" passed on a model that renders white — a check
that could not go red. It was rewritten and then verified in both directions
against a genuinely broken file.

**`gltf-transform` prints a `prune: Removed ... Skin (1)` line that looks like it
broke skinning and does not.** Verify rather than trust it — every conversion in
`tools/` re-reads its output and asserts the joint and clip counts survived.

**Vite blocks ngrok by default.** Since the host-header fix (Vite ≥ 5.4.12) the
dev server rejects requests whose `Host` isn't allowlisted, so the documented
phone-test workflow 403s. `server.allowedHosts` lists the ngrok domains as
suffixes — never `true`, which reopens the DNS-rebinding hole the default closes.

---

## Capture

A shutter and a record toggle sit over the camera feed. Capturing opens a preview
with a Share button that hands the file to the OS share sheet, falling back to a
download where the Web Share API cannot take files.

One canvas grab is already the composited shot: the engine draws the camera feed
into the same canvas three.js renders the character into, and it creates its GL
context with `preserveDrawingBuffer: true`, so `toBlob` works outside the render
loop. The DOM overlay is deliberately not in the picture.

Deliberate choices:

- **Web APIs only, not `XR8.MediaRecorder`** — that would pull the 5 MB
  `media-worker.js` back into the build for something the platform does natively.
  Verified working on a phone, including playback of the recorded video.
- **The video mimeType is feature-detected**, not assumed, and the file extension
  derived from whichever wins. Safari records mp4; Chrome varies.
- **Share is its own tap**, never automatic when a recording ends. Safari drops
  user activation across an `await`, and blob assembly happens in between.
  `AbortError` means the sheet was dismissed — a choice, not a failure.
- Recording caps at 60 s and flushes on a timeslice so a long take does not spike
  memory on a low-end phone.
- Capture failures warn and continue. The one-screen error UI is for boot
  failures, not a failed snapshot.

No microphone: canvas capture is view-only. Audio would need a second permission
prompt and stream merging.

---

## Deploy

Static hosting only. `vercel.json` rewrites `/ar/*` to `/index.html`.

```sh
npm run build
npx vercel deploy --prebuilt --prod
```

Verify on the deployed URL in this order — each step rules out one class of
failure:

1. `/` loads
2. `/external/xr/xr.js` returns 200 with a JavaScript content type
3. `/targets/<id>/<id>.json` returns 200, **and the `imagePath` inside it does too**
4. `/models/<id>.glb` returns 200
5. `/ar/<id>` loads **and** `/external/xr/xr.js` still resolves from that route
6. `/ar/does-not-exist` shows the error screen

Check response **bodies**, not just status codes — under an SPA rewrite a missing
file returns `200` with HTML. A status-only check passes on a broken deploy.

A deploy is not done until a printed sticker has been scanned against production.

---

## Current sticker quality — a caveat

The `spider-001` target is a photographed pen drawing on ruled notebook
paper. It **does track on a device**, but it violates several points of the
artwork gate, so it is a weak target and worth knowing about before anyone
blames the code for marginal tracking:

- The ruled lines are a strongly periodic pattern, giving the tracker a family of
  near-equivalent matches offset along that axis
- Thin pen line art on white — few pixels carry any signal
- Large empty areas, well over the ~20% flat-region limit
- Detail concentrated in the centre; corners are blank
- Photographed at an angle, so perspective skew and a lighting gradient are baked in

If tracking ever proves marginal — slow to acquire, or drifting along the ruled
lines — the fix is artwork, not code: redraw edge-to-edge on unlined paper, fill
empty areas with irregular non-repeating marks, and scan it flat. Filter and
smoothing constants are banned by `CLAUDE.md`.
`dino-001` is the counter-example: `art/make-sticker.mjs dino-001` generates it
edge-to-edge from a seeded PRNG, and it is what the compiled `dino-001` target
comes from, so a reprint and the target can never drift apart. Each layout in
that script differs from the others in seed, in where its large shapes sit AND
in which creature it draws — two stickers that differ only in their speckle
field are two stickers the engine can confuse in one frame.
`art/spider-001.png` is the same generator's spider layout, kept for comparison;
the compiled spider-001 target is still the photograph.

---

## Stack

Vite 8 · TypeScript 6 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) · three.js 0.183.2 · `@8thwall/engine-binary` 1.0.0
· Node 22+

`three` is pinned exactly to match
[`8thwall/threejs-world-effects-example`](https://github.com/8thwall/threejs-world-effects-example),
which is the current home of what the docs call `examples/threejs`.
`@types/three` tracks the same minor. Bump both together, and only after a phone
test.

TypeScript is pinned to 6.x because typescript-eslint does not yet support the
TypeScript 7 API ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).

---

## Credits and licences

**3D models**

- *Animated T-Rex Dinosaur Biting Attack Loop* by
  [LasquetiSpice](https://sketchfab.com/LasquetiSpice) —
  [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) —
  [source](https://sketchfab.com/3d-models/animated-t-rex-dinosaur-biting-attack-loop-5bbcadb7d9274843abb5ada35767dba1).
  Redistributed here with its materials converted from specular-glossiness to
  metallic-roughness and its textures re-encoded; author, licence and source
  metadata are preserved inside the GLB.
- Spider model by [Quaternius](https://quaternius.com) — CC0. Animation clips
  renamed and unused clips removed.

**8th Wall Engine** is used under its limited-use licence, which permits
commercial use as part of a broader experience. See
[8thwall.org/docs/open-source](https://8thwall.org/docs/open-source). The engine
binary itself is **not** committed to this repository — it is installed from npm
and copied into the build.

This repository's own source is provided as a proof of concept.
