---
name: ar-campaign
description: Add, change or debug a sticker campaign end to end — compile the image target with @8thwall/image-target-cli, validate the target artwork and the GLB, add the registry entry in src/config/campaigns.ts, generate the QR for /ar/<id>, and diagnose a target that will not track. Use whenever a new sticker or character is introduced, a model or animation name changes, or a campaign id is reported as not working.
---

# Add or fix a campaign

One sticker = one campaign = one id. The id is printed on physical stickers, so
**an id never changes after the first print run.** Renaming is a new campaign.

Load `eightwall-engine-api` alongside this for the event payloads and CLI facts.

## Checklist

- [ ] Target artwork passes the quality gate below
- [ ] Target compiled, output committed under `public/targets/<id>/`
- [ ] `imagePath` in the JSON resolves to a URL we actually serve
- [ ] `targetName` in the JSON matches the registry entry exactly
- [ ] GLB validated (size, compression, animation names)
- [ ] Registry entry added to `src/config/campaigns.ts`
- [ ] `npm run check` clean
- [ ] Phone test — target found, correct scale, no ghosting (`ar-phone-test`)
- [ ] QR generated and the printed size checked

## 1. Target artwork gate

Reject the art and go back to the art pipeline if any of these fail — a bad
target cannot be fixed in code, and tuning constants are banned by CLAUDE.md.

- 1000–1500 px on the long edge, sRGB, no alpha.
- High local contrast, plenty of fine detail across the whole frame.
- No repeating pattern, no rotational symmetry, no mirrored halves.
- No large flat colour areas (> ~20% of the frame in one flat block is a fail).
- Text-only or thin-line-art-on-white targets track badly. Ask for texture.
- The compiled 480×640 luminance image is the ground truth for how the engine
  sees the sticker — open it and judge that, not the glossy source art.

Never commit the source PSD or a multi-megabyte source PNG into `public/`.

## 2. Compile the target

```
npx @8thwall/image-target-cli@latest
```

The CLI is **interactive** — it prompts for image path, crop type (default
centred or custom dimensions), and the folder/target name. It takes no flags:
verified 2026-08-31 that `--help` is ignored and it prompts anyway. It does read
stdin, so a script can pipe the answers in (fragile — prompt order is unversioned). For a sticker choose FLAT (do not answer the cylindrical or
conical prompts).

Answer the name prompt with the campaign id verbatim (`frog-001`) — that string
becomes `detail.name` in the tracking events and must equal `targetName` in the
registry.

Output: JSON metadata, original image, cropped image, a 263×350 thumbnail, a
480×640 grayscale luminance image. Move the whole folder to
`public/targets/<id>/` and commit all of it.

> **Deviation from CLAUDE.md:** CLAUDE.md specifies
> `npm run targets` → `scripts/compile-target.mjs <image> <campaign-id>` as a
> non-interactive command. The published CLI does not support arguments, so
> `compile-target.mjs` can only (a) drive the CLI's prompts, or (b) act as a
> post-processor: run the CLI yourself, then have the script move the output into
> `public/targets/<id>/`, rewrite `imagePath` to the served URL, and verify the
> name. (b) is the honest option. Do not invent CLI flags. Raise this with the
> human and update CLAUDE.md — its own rule is that the docs win.

Then fix `imagePath` in the JSON so it resolves against the served page:

```
"imagePath": "/targets/frog-001/frog-001_luminance.jpeg"
```

Root-absolute, because pages are served at `/ar/<id>` and a relative path would
resolve to `/ar/targets/...`.

## 3. Validate the GLB

Models come from the Unity/art pipeline; this repo does not author them. Check,
do not fix:

- Single `.glb`, Draco or meshopt compressed, **under 2 MB**. Over budget on a
  low-end Android over mobile data is a black screen, not a slow load.
- Embedded textures ≤ 1024².
- Animation clip names **exactly** as they will appear in `animations[]` —
  case and spacing included. List them before writing the registry entry:

```
npx gltf-transform inspect public/models/frog.glb
```

Read the animations table from the output and copy the names from it. Guessing
`"Idle"` when the clip is `"idle_01"` gives a silently frozen character.

- Y-up, facing +Z, origin at the character's feet. A model whose origin is at
  its centre sinks half-way into the sticker. Wrong origin goes back to the art
  pipeline — do not compensate with a magic offset in code.

## 4. Registry entry

```ts
'frog-001': {
  targetName: 'frog-001',
  targetJson: () => fetch('/targets/frog-001/frog-001.json').then(r => r.json()),
  model: '/models/frog.glb',
  scale: 1,
  idleAnim: 'Idle',
  animations: ['Idle', 'Dance', 'Jump'],
}
```

- `scale` is a **multiplier on the size derived from `detail.scaledWidth`**, not
  an absolute size. Start at `1`; only change it if the character is
  deliberately meant to read bigger or smaller than the 8 cm sticker.
- `idleAnim` must also appear in `animations` if the user should be able to
  return to it.
- `animations` order is the button order children see. Keep it short — 3–4.
- Unknown id → the error screen. Never fall back to another campaign; a child
  scanning a frog sticker must not get a dinosaur.

## 5. QR code

The QR encodes the canonical route: `https://<host>/ar/<id>`. `?id=` is for
desktop testing only and never goes on print.

```
npx qrcode -o qr/frog-001.png -w 1024 -e H "https://<host>/ar/frog-001"
```

Error correction level H — the QR sits on an 8×8 cm sticker that will get bent,
scuffed and partly covered. Print check: on paper at final size, scan it from
~20 cm with the stock camera app on both an iPhone and a low-end Android. If the
module size is under ~0.5 mm at print size, the URL is too long — shorten the
host or the id, do not shrink the quiet zone.

## Debugging: target will not track

Work down this list in order; each step rules out a layer.

1. **No `imagescanning` event** — the target JSON never loaded. Check the network
   panel for a 404 on the JSON or on `imagePath`.
2. **`imagescanning` fires, no `imagefound`** — the engine is looking but not
   recognising. Check `detail.name` in `imagescanning` against `targetName`
   (this is a string mismatch far more often than an artwork problem). Then judge
   the luminance image against the artwork gate.
3. **`imagefound` then immediate `imagelost`, repeatedly** — glare, motion blur,
   or a low-detail target. Test under diffuse light with the sticker flat before
   blaming code.
4. **Tracks but the model is in the wrong place / wrong size** — pose maths.
   Quaternion field order (`{w,x,y,z}` from the event vs `set(x,y,z,w)` in
   three.js) and `scaledWidth`-derived sizing are the two usual causes.
5. **Tracks but lags a frame behind** — pose is being read outside the event
   handler, or via `matrixWorld.decompose`. Apply it in the handler. This was the
   POC's bug and CLAUDE.md forbids reintroducing it.
6. **Model persists after the sticker leaves frame** — `imagelost` is not hiding
   the anchor `Group`, or the hide is deferred to the next frame.

Never "fix" tracking with filter/smoothing constants. That road is closed by
project rule.
