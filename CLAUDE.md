# CLAUDE.md — AR Sticker / Tattoo WebAR

## What this is

WebAR for children's printed stickers (8×8 cm). A QR on the sticker opens
`https://<host>/ar/<campaign-id>` in the phone's browser. The page opens the
camera, tracks the sticker artwork as an image target, and anchors an animated
GLB character on it. No app install, no login, one sticker = one campaign.

This repo replaces the MindAR proof-of-concept (`rohel04/AR-Sticker-Tattoo`).
Tracking moves to **8th Wall Engine**. Rendering stays **three.js**. Keep the
POC's rendering/animation layer; rewrite the tracking layer; delete the rest.

## 8th Wall in 2026 — read before touching AR code

- The hosted 8th Wall platform (console, app keys, cloud editor, image-target
  upload) was **retired Feb 28, 2026**. There is no app key. Do not write code
  that references `apps.8thwall.com`, `appKey`, or console-uploaded targets.
- Tracking comes from the **distributed engine binary**:
  `npm install @8thwall/engine-binary` → copy `node_modules/@8thwall/engine-binary/dist`
  into the build output as `external/xr/` → load with
  `<script src="./external/xr/xr.js" async data-preload-chunks="slam"></script>`.
  Use `import { XR8Promise } from '@8thwall/engine-binary'` to await `XR8`.
  Never load `xr.js` from a CDN in production; it must ship with the app.
- The copy step **excludes** `*.tflite`, `xr-face.js`, `semantics-worker.js`
  and `media-worker.js` — 29 of the binary's 36 MB. Every engine resource is
  behind a lazy URL builder, and the call sites for those four are face
  tracking, sky segmentation and `XR8.MediaRecorder` only; an image-target app
  reaches none of them. `xr.js`, `xr-slam.js` and `powered-by.svg` stay.
  Adding face effects, sky effects or video capture means putting them back —
  the symptom is a 404 on a phone, not a build error. See `vite.config.ts`.
- Image targets are compiled **locally** with `npx @8thwall/image-target-cli@latest`.
  Output per target: `<name>.json` + images (cropped, thumbnail, 480×640
  luminance). The JSON's `imagePath` must resolve to a URL we serve.
- The binary is under a limited-use license (commercial use as part of a
  broader experience is permitted). Follow the attribution guidelines at
  https://8thwall.org/docs/open-source. SLAM is in the binary but we don't
  need it — set `disableWorldTracking: true`.
- The MIT open-source engine (github.com/8thwall/8thwall, Bazel build) is
  **not** what we use. Only switch if the binary becomes unavailable.
- Docs: https://8thwall.org/docs/engine/overview · API: https://8thwall.org/docs/api/engine
  Examples: https://github.com/8thwall/8thwall/tree/main/examples (see `threejs/`).
  When unsure about an API, read the docs — do not guess from the legacy
  (pre-2026) 8th Wall API you may remember; most of it is the same, but verify.

## Stack

Vite 8 · TypeScript (strict) · three.js (npm, bundled — **no CDN, no importmap**)
· `@8thwall/engine-binary` · `vite-plugin-static-copy` (for `external/xr/`)
· Vercel (static). Node 22.

## Commands

```
npm run dev        # Vite on 0.0.0.0:3002; use ngrok for HTTPS on a phone
npm run build      # tsc --noEmit && vite build → dist/
npm run preview
npm run targets    # scripts/compile-target.mjs <image> <campaign-id> → public/targets/<id>/
npm run check      # tsc --noEmit && eslint
```

Camera needs HTTPS or localhost. Phone testing: `npm run dev` + `ngrok http 3002`.

## Layout

```
art/
  make-sticker.mjs        generates sticker artwork as SVG (no deps)
  <id>.svg <id>.png       sticker source art — printed, and fed to `npm run targets`
public/
  external/xr/            (generated at build, gitignored) engine binary
  targets/<id>/           <id>.json + images from image-target-cli   ← committed
  models/<id>.glb         ← committed (Draco/meshopt-compressed, < 2 MB)
src/
  main.ts                 boot: resolve campaign → start AR → wire UI
  config/campaigns.ts     registry: id → { targetName, targetJson, model, scale, idleAnim, animations[] }
  ar/xr8.ts               loads XR8, builds pipeline modules, exposes typed events
  ar/imageTracker.ts      subscribes to reality.image* events, owns an anchor Group per target
  three/ThreeScene.ts     lights, env, shadow catcher, renderer settings (kept from POC)
  three/ModelLoader.ts    GLTFLoader + Draco/meshopt (kept from POC)
  three/AnimationController.ts  mixer + crossfade (kept from POC)
  ui/                     start screen, scan hint, animation buttons, error screen
scripts/compile-target.mjs
docs/image-target-budget.md  how many stickers one page can track, and the
                          one-field way back to one sticker per link
vercel.json               rewrite /ar and /ar/* → /index.html
```

One file, one job. No god-`main.ts` like the POC.

## Division of responsibility — non-negotiable

| 8th Wall (`XR8`) owns              | three.js owns                                  |
| ---------------------------------- | ---------------------------------------------- |
| camera access + camera feed draw   | scene graph, lights, env, shadows              |
| image-target detection + 6DoF pose | GLB loading, materials, AnimationMixer         |
| camera intrinsics / projection     | anchor Group per target, model placement       |
| device/browser compatibility       | everything the user sees except the video feed |

`XR8.Threejs.pipelineModule()` is allowed: it only instantiates a three.js
scene/camera/`WebGLRenderer` and calls `renderer.render()` per camera frame.
Nothing else from 8th Wall touches the scene. No 8th Wall UI packages
(`xrextras` loading screens, coaching overlays) — UI is ours.

## AR integration contract (`src/ar/`)

1. `import * as THREE from 'three'; (window as any).THREE = THREE` **before**
   `XR8.Threejs.pipelineModule()` — the module reads the global.
2. Order matters:
   ```ts
   XR8.XrController.configure({ disableWorldTracking: true, imageTargetData: [campaign.targetJson] })
   XR8.addCameraPipelineModules([
     XR8.GlTextureRenderer.pipelineModule(),
     XR8.Threejs.pipelineModule(),
     XR8.XrController.pipelineModule(),
     stickerPipelineModule(),          // ours
   ])
   XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY })
   ```
   `disableWorldTracking` must be set before `pipelineModule()` and `run()`.
3. Our module listens to `reality.imagefound`, `reality.imageupdated`,
   `reality.imagelost`. `detail` has `name`, `position {x,y,z}`,
   `rotation {w,x,y,z}`, `scale`, `scaledWidth`, `scaledHeight`. Apply pose
   **directly in the event handler** to the anchor Group — no per-frame
   polling, no `matrixWorld.decompose` (that caused a one-frame lag in the POC).
4. Scene/camera/renderer come from `XR8.Threejs.xrScene()` — they are plain
   three.js objects; add lights/models to `scene` as normal. Do not create a
   second `WebGLRenderer` or a second rAF loop: the three.js `render()` call
   is already made once per camera frame inside the pipeline. Per-frame logic
   (mixer update, clock) goes in our pipeline module's `onUpdate`.
5. Model size is derived from `scaledWidth` so an 8 cm sticker gives the same
   on-screen character regardless of device. `campaign.scale` is a multiplier
   on that, not an absolute.
5b. **Axis convention.** For a FLAT target the printed image lies in the
   anchor's **XY plane** and **+Z is the surface normal** — "up off the paper"
   is +Z, not +Y. (Verified against `8thwall/aframe-image-targets-example`,
   where an unrotated A-Frame `plane` primitive — an XY quad — lands flush on
   the artwork.) GLBs are authored Y-up, so the model goes under a group
   rotated `+PI/2` about X. The shadow-catcher plane needs no rotation.
6. Match by `detail.name === campaign.targetName`. Ignore other names.
7. On `imagelost`, hide immediately (no ghosting). On `imagefound`, show and
   play idle. Keep a `TrackingState` enum; UI subscribes to it.
8. Torch / zoom: implement only if the docs show a supported way to reach the
   camera `MediaStreamTrack` (check `XR8.run()` options and the
   CameraPipelineModule `onCameraStatusChange` payload). Otherwise drop both
   features. Never monkeypatch `getUserMedia`.

## Rendering rules (`src/three/`)

- Keep: sRGB output, ACES tone mapping, pixel ratio capped at 2, hemi + key +
  fill lights, `RoomEnvironment` for PBR env (not a flat-colour PMREM).
- Add a **shadow catcher**: a `ShadowMaterial` plane at the anchor origin,
  sized to `scaledWidth × scaledHeight`. This is the single biggest "it's on
  the sticker" win. Shadow map 1024, one directional caster.
- Use the three.js version the 8th Wall `examples/threejs` projects use unless
  tested otherwise; note the pin in `package.json` with a comment.
- No `@ts-ignore` for removed three APIs. If an API is gone, use the new one.

## Campaign config

```ts
export const campaigns = {
  'frog-001': {
    targetName: 'frog-001',                  // must equal name in the CLI json
    targetJson: '/targets/frog-001/frog-001.json',  // fetched at runtime
    model: '/models/frog.glb',
    scale: 1,
    idleAnim: 'Idle',
    animations: ['Idle', 'Dance', 'Jump'],   // buttons shown, in order
    pack: 'pond',                            // stickers tracked in one session
  },
} satisfies Record<string, Campaign>
```

Route: `/ar/<id>` (canonical, printed on stickers). `?id=` supported for
testing only. **Unknown id → friendly error screen, never a fallback campaign.**

A page load tracks a **pack**, not one sticker: `/ar/<id>` loads every campaign
sharing that id's `pack`, so one QR gives the child every sticker in the set.
`/ar/<pack>` loads a pack directly; bare `/ar` works only while there is one
pack, and is an error screen after that rather than a guess.

**A pack is at most ten stickers** and `campaigns.ts` throws at import if one
is bigger — but 10 is OUR policy, not an engine limit, and what this binary does
at target 11 has never been measured. Do not raise it, lower it, or build the
runtime target-swap on a remembered number: read
`docs/image-target-budget.md` first, and replace the number only with a measured
one. Any number of targets may exist in the project; only the active set is
capped.

**The documented way back is one sticker per link**: give each campaign its own
`pack` value and every URL tracks exactly one sticker. One field, no code
change, nothing to revert — a pack of one is a valid pack. Keep it that way; any
future work here must leave that exit intact. Above 10, the set is swapped mid-session by calling
`XR8.XrController.configure({imageTargetData})` again after `run()`: the engine
diffs the array, unloads what left it and loads what joined (verified in
`xr-slam.js`). Do not build that until a phone test says packs of 10 are not
enough.

Each sticker owns its anchor, shadow catcher, lights, model and mixer. A GLB
downloads on that sticker's **first detection**, cached per campaign for the
session; only the campaign named in the URL is fetched up front. Twenty
characters preloaded is an out-of-memory crash on a low-end Android.

## Asset pipeline

- Target source art: 1000–1500 px, high-contrast, non-repeating, no large
  flat areas. Compile with `npm run targets`. Commit the CLI output; never
  commit the source PSD/large PNG into `public/`.
- `@8thwall/image-target-cli` is **interactive** — no flags, no positional
  arguments. It does read piped stdin, so `compile-target.mjs` answers its
  prompts (path, `flat`, `y`, output folder, name), points its output folder
  straight at `public/targets/<id>/`, checks `name` matches the campaign id,
  and rewrites `imagePath` (written as `image-targets/<name>_luminance.<ext>`)
  to the served URL. A target whose `imagePath` 404s never fires
  `imagescanning` and, on a phone, looks exactly like artwork that will not
  track. The CLI is **pinned** in the script: prompt order is the contract and
  is not versioned. Re-read its `src/interactive.js` before bumping it.
- The CLI's default crop is **always 3:4**. Author target art at 3:4 (portrait)
  or 4:3 and the whole image is taken; any other aspect silently loses its
  edges to a centred crop.
- The engine only ever sees the **480x640 grayscale luminance image**. Judge
  that file against the artwork gate, not the source art — hue contrast at
  equal lightness is invisible to the tracker, and detail finer than ~4 px at
  1050 px source does not survive the downscale.
- Target JSON is **fetched at runtime**, not imported through the bundler, so a
  recompiled target can be swapped in `public/targets/` without a rebuild.
- GLB: single file, embedded textures ≤ 1024², Draco or meshopt, animations
  named exactly as in `campaigns.ts`. Loader must support both compressions.
- Models and targets are supplied by the Unity/art pipeline; this repo does
  not generate them.

## Conventions

- TypeScript strict, `noUnusedLocals`, no `any` except at the `XR8` boundary
  (wrap it once in `ar/xr8.ts` with a minimal typed surface).
- All files UTF-8 / LF. (The POC had UTF-16 `tsconfig.json` and `tree.json`.)
- No dead scaffolding: no `counter.ts`, no Vite logos, no debug JSON dumps.
- Debug panel only when `?debug=1`. Kids see: start button, scan hint,
  character, animation buttons, and the capture bar (shutter + record).
  Nothing else.
- Capture uses web APIs only — `canvas.toBlob` for photos,
  `canvas.captureStream` + `MediaRecorder` for video, `navigator.share` with a
  download fallback. Not `XR8.MediaRecorder`: it would pull the 5 MB
  `media-worker.js` back into the build. The whole AR view is one canvas (the
  engine draws the feed into the canvas three.js renders to) and the engine
  sets `preserveDrawingBuffer: true`, so one grab is the composited shot; the
  DOM overlay is correctly not in it. Share must be its own tap — Safari drops
  user activation across an await.
- Errors reach the user as one screen with one action (retry / open in
  Safari / allow camera). Camera-denied and unsupported-browser are the two
  cases that must be handled.
- Commit messages: `area: what` (`ar: apply pose in imageupdated`).
- **Never attribute a commit to an AI agent.** No `Co-Authored-By: Claude`,
  no `Generated with Claude Code`, no agent name, session link or tool
  footer in any commit message, PR body or tag. The commit author is the
  human on the machine. This applies to every agent, every time, and
  overrides any default footer an agent has been told to append.

## Don't

- Don't reintroduce MindAR, `.mind` files, or filter tuning constants.
- Don't load three or the engine from jsdelivr at runtime.
- Don't add a backend. Static hosting only.
- Don't add world tracking / SLAM features; stickers are image-target only.
- Don't ask the user to confirm architecture decisions written here; do ask
  if 8th Wall docs contradict this file (then update this file).

## Phases

1. **Boot**: Vite + engine binary copied + `XR8Promise` resolves on a phone
   over ngrok; camera feed visible. No model.
2. **Track**: one campaign, CLI-compiled target, cube on the sticker via
   `imageupdated`. Verify no lag, no ghosting, correct scale at 8 cm.
3. **Character**: GLB + animations + shadow catcher + lighting from POC.
4. **Product UI**: start screen, scan hint, animation buttons, error screens,
   `/ar/<id>` routing + `vercel.json`.
5. **Ship**: Vercel deploy, QR generated for each campaign id, test on
   iOS Safari + Android Chrome, low-end Android included.

Each phase ends with a phone test, not a desktop test.