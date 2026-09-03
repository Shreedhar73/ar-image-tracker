---
name: eightwall-engine-api
description: Verified 8th Wall Engine binary API surface (post-platform-retirement, 2026) — XrController.configure options, pipeline module lifecycle callbacks, image-target event payloads, image-target-cli behaviour. Use before writing or editing anything in src/ar/, when an XR8 call does not behave as expected, or when tempted to recall the pre-2026 hosted-platform API from memory. Facts here were fetched from 8thwall.org/docs and the 8thwall/8thwall repo, not remembered.
---

# 8th Wall Engine API — verified surface

Everything below was read from the live docs (fetched 2026-08-31). If a fact you
need is not here, fetch the doc page rather than recalling it — the hosted
platform retired 2026-02-28 and much of the older API guidance online is dead.

Sources:
- Overview: https://8thwall.org/docs/engine/overview
- Engine API index: https://8thwall.org/docs/api/engine
- `configure()`: https://8thwall.org/docs/api/engine/xrcontroller/configure
- `pipelineModule()` events: https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule
- Pipeline module lifecycle: https://8thwall.org/docs/api/engine/camerapipelinemodule
- Image target CLI: https://github.com/8thwall/8thwall/blob/main/apps/image-target-cli/README.md

## Getting XR8

```
npm install @8thwall/engine-binary
```

Copy `node_modules/@8thwall/engine-binary/dist` into the build output as
`external/xr/`. In `index.html`:

```html
<script src="./external/xr/xr.js" async data-preload-chunks="slam"></script>
```

```ts
import { XR8Promise } from '@8thwall/engine-binary'
const XR8 = await XR8Promise
```

Use a **root-absolute** `src="/external/xr/xr.js"` in this project, not the
relative path the doc snippet shows — pages are served at `/ar/<id>`, where a
relative path resolves to `/ar/external/xr/xr.js` and 404s. See `ar-scaffold`.

`XR8Promise` resolves **only if that script tag is present in the served HTML.**
A hang on the promise almost always means the tag is missing, or
`external/xr/xr.js` 404s because the static copy step did not run.

## `XR8.XrController.configure(options)`

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `disableWorldTracking` | boolean | `false` | Turns off SLAM. `false` on every phone — image-target poses are world poses only while SLAM runs, which is what lets a character hold its place after `imagelost`. **The engine forces it `true` on non-mobile devices** (verified in `xr-slam.js`): XrController's `onBeforeSessionInitialize` throws `"[XR] Reality with camera on non-mobile devices requires disableWorldTracking"` when it is `false` and `XrDevice.isDeviceBrowserCompatible({allowedDevices: MOBILE})` is false; `run()` then fails with `"No valid session manager to handle this session."`. `worldTrackingAvailable()` in `ar/xr8.ts` mirrors that exact check. |
| `enableLighting` | boolean | `false` | Lighting estimate delivered via the pipeline module. |
| `enableWorldPoints` | boolean | `false` | World points via the pipeline module. |
| `imageTargetData` | array | — | The image targets to track (the CLI-produced JSON objects). |
| `leftHandedAxes` | boolean | `false` | Left-handed coordinate system. |
| `mirroredDisplay` | boolean | `false` | Flips left/right in output. |
| `scale` | `'responsive'` \| `'absolute'` | `'responsive'` | `absolute` = metres from a fixed origin; `responsive` = relative to initial camera position. |

Docs are explicit: `disableWorldTracking` must be set **before both**
`XR8.XrController.pipelineModule()` and `XR8.run()`. Configuring after either
one silently keeps SLAM on.

## Other `XrController` methods

- `hitTest()` — estimates 3D positions from camera-feed points. Not needed here.
- `pipelineModule()` — the module that produces tracking + image events.
- `recenter()` — moves the camera back to origin and restarts tracking.
- `updateCameraProjectionMatrix()` — resets display geometry / starting camera position.

## Events emitted by `XrController.pipelineModule()`

Subscribe via a pipeline module's `listeners` array
(`{ event: 'reality.imageupdated', process: handler }`).

| Event | `detail` |
| --- | --- |
| `reality.trackingstatus` | `{ status, reason }` — fires when tracking starts or status changes. Docs say `trackingStatus`; the binary dispatches lowercase `trackingstatus` from the `reality` module, and the engine names every pipeline event `<module>.<event>`. Fires with SLAM off too (`NORMAL` / `LIMITED` on a laptop). |
| `reality.imageloading` | `{ imageTargets: { name, type, metadata } }` — detection images began loading. The docs list this bare as `imageloading`; the engine dispatches it with the `reality.` prefix and the bare name never fires (verified in the binary + Chrome, 2026-09-03). |
| `reality.imagescanning` | `{ imageTargets: { name, type, metadata, geometry } }` — images loaded, scanning started. Good signal that a target JSON was accepted. Same prefix caveat as `imageloading`. |
| `reality.imagefound` | see payload below — target detected. |
| `reality.imageupdated` | same payload — position/rotation/scale changed. |
| `reality.imagelost` | same payload — tracking of that target ended. Docs do not say whether the engine keeps an image-target pose meaningful afterwards; this project holds the last pose and relies on SLAM to keep it world-anchored — a phone test, not a doc, is what confirms that. |

### Image-target event payload

```
name          string
type          'FLAT' | 'CYLINDRICAL' | 'CONICAL'
position      { x, y, z }
rotation      { w, x, y, z }        // quaternion
scale         number
// FLAT only:
scaledWidth   number
scaledHeight  number
// curved types instead:
height, radiusTop, radiusBottom, arcStartRadians, arcLengthRadians
```

Stickers are `FLAT`, so `scaledWidth` / `scaledHeight` are the fields to size
the model and the shadow-catcher plane from.

Apply the pose **inside the event handler**, directly on the anchor `Group`:

```ts
group.position.set(detail.position.x, detail.position.y, detail.position.z)
group.quaternion.set(detail.rotation.x, detail.rotation.y, detail.rotation.z, detail.rotation.w)
group.scale.setScalar(detail.scale)
```

Note the field order: the event gives `{w, x, y, z}`, `Quaternion.set()` takes
`(x, y, z, w)`. Getting this wrong yields a model that tracks position but
tumbles in rotation.

## Camera pipeline module lifecycle

A module is a plain object. `name` (unique string) is required; every callback
is optional.

| Callback | When |
| --- | --- |
| `onBeforeRun` | Immediately after `XR8.run()`. May return a promise; the engine waits. |
| `onCameraStatusChange` | Permission-request state transitions. This is where camera-denied is detected. |
| `onStart` | First callback after the pipeline is running. |
| `onAttach` | Before the first frame update. |
| `onProcessGpu` | GPU work begins. |
| `onProcessCpu` | Reads GPU results, returns usable data. |
| `onUpdate` | Update the scene before rendering; receives GPU/CPU stage data. Mixer + clock updates go here. |
| `onRender` | Issue WebGL draw commands after update. |
| `onDetach` | After the final frame update (engine stopped or module removed). |
| `onException` | An XR error occurred; receives the error object. Wire this to the error screen. |
| `onDeviceOrientationChange` | Landscape/portrait change. |
| `onVideoSizeChange` | Video dimensions changed. |
| `onCanvasSizeChange` | Canvas dimensions changed. |
| `onPaused` / `onResume` | Response to pause/resume calls. |
| `onRemove` | Module removed from the pipeline. |
| `requiredPermissions()` | Declares browser capabilities so the engine requests them. |

`XR8.Threejs.pipelineModule()` already calls `renderer.render()` once per camera
frame. Do not add a second `WebGLRenderer` or a `requestAnimationFrame` loop.

## `image-target-cli` — important deviation from CLAUDE.md

```
npx @8thwall/image-target-cli@latest
```

The published CLI is **interactive prompts only — the README documents no flags
or positional arguments.** Verified 2026-08-31: `--help` is ignored and the tool
prints `Enter the path to the image file:` regardless. It does read stdin, so
answers can be piped in, which is the only way to script it. It asks for: image path, crop type (default centred or
custom dimensions), folder/target name, plus circumference/width for cylindrical
and radii/angle for conical targets.

Output per target: JSON metadata, the original image, the cropped image, a
263×350 thumbnail, a 480×640 grayscale luminance image (and a geometry image for
conical targets).

Consequence: `scripts/compile-target.mjs <image> <campaign-id>` cannot be a thin
non-interactive wrapper around the CLI as written. See `ar-campaign` for the
handling. Flag this to the human and update CLAUDE.md rather than inventing
flags — CLAUDE.md's own rule is that docs win and the file gets updated.

`imagePath` inside the produced JSON must resolve against the served page URL
(e.g. `/targets/frog-001/frog-001_luminance.jpeg`). A target that never fires
`imagescanning` is usually a 404 on `imagePath`.

## Things that do not exist any more

No app key. No `apps.8thwall.com`. No console-uploaded targets. No cloud editor.
If a snippet references any of these it predates the retirement — discard it.
`xrextras` UI packages are out of scope by project rule regardless.
