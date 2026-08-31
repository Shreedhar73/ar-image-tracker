# Asset prep

Models are supplied by the art pipeline; this repo does not author them. But a
supplied GLB sometimes needs converting before three.js can render it, and a
converted binary with no record of how it was made is worse than no record at
all. Every derived file in `public/models/` is reproducible from here.

**Always convert to a NEW filename and swap it in.** Do not overwrite the file
you were given — it may be the only copy.

## `npm run glb` — check any GLB against the three.js we install

```sh
npm run glb -- public/models/foo.glb                    # report only
npm run glb -- public/models/foo.glb public/models/foo-fixed.glb   # report + fix
```

Run this on **every** model before wiring it into `campaigns.ts`. It reports
unsupported glTF extensions, whether any material actually reaches a
base-colour texture, texture sizes, rig and clip names (printed ready to paste
into `campaigns.ts`), and file size against the 2 MB budget. Given an output
path it also fixes the specular-glossiness case and re-reads the file it wrote
to prove extensions are clear, base colour is present, and the joints and clips
survived. It refuses to write over its input.

The supported-extension list is parsed out of the installed
`three/examples/jsm/loaders/GLTFLoader.js` at run time, not written down — so
upgrading three re-derives this check instead of quietly invalidating it. That
is also why the tool fails loudly if it cannot parse that list, rather than
falling back to a stale one and reporting everything as fine.

Exit code is non-zero when a problem is found and not fixed, so it can gate CI.

## spider-001.glb — Sketchfab T-Rex

Source: `~/Desktop/yipl_projects/3d-models-glb/Exports/animated_t-rex_dinosaur_biting_attack_loop.glb`

The source requires `KHR_materials_pbrSpecularGlossiness`, which three.js has
**removed**. The loader ignores the extension's `diffuseTexture`, falls back to
a blank `MeshStandardMaterial`, and the model renders plain white while only
whispering `Unknown extension` to the console. `metalrough` rewrites the same
images into the `baseColorTexture`/`metallicRoughnessTexture` slots the loader
does read. (`ModelLoader` now detects this case and says so explicitly.)

### Option 1 — minimal: bring back only the textures that were there

`specgloss-to-basecolor.mjs` in this directory MOVES the existing diffuse
texture into `baseColorTexture` and disposes the dead extension. It generates
no image data: the three surviving textures come out SHA-256 identical to the
source, and only the specularGlossiness map is dropped (three.js cannot use it
in any form). Per-pixel shininess becomes one flat roughness value; colour,
normals and AO are untouched.

```sh
node tools/specgloss-to-basecolor.mjs trex-src.glb spider-001-basecolor.glb
# 6.31 -> 5.07 MB. Optionally re-encode the SAME images for phones:
npx @gltf-transform/cli webp    spider-001-basecolor.glb tmp.glb --quality 95
npx @gltf-transform/cli meshopt tmp.glb spider-001-basecolor-small.glb
# -> 1.18 MB
```

Clearing the extension off each material is not enough — it stays registered on
the document, keeps appearing in `extensionsRequired`, and keeps its texture
alive. The extension object itself must be disposed. Check the output really
does report `extensionsUsed: none`.

### Option 2 — fuller: rebake shininess

```sh
npx @gltf-transform/cli metalrough trex-src.glb  trex-mr.glb
npx @gltf-transform/cli webp       trex-mr.glb   trex-w.glb  --quality 95
npx @gltf-transform/cli meshopt    trex-w.glb    spider-001.glb
```

6.3 MB -> 1.64 MB. This bakes a NEW `metallicRoughnessTexture` out of the
specularGlossiness map, so per-pixel shininess survives — but it is an image
that was not in the source. Prefer Option 1 when the textures must be exactly
the source textures.

One clip, named `Animation`. Verify with
`npx @gltf-transform/cli inspect public/models/spider-001.glb` before editing
`campaigns.ts` — the clip list there must match exactly.

## spider-002.glb — Quaternius spider (CC0)

See `prep-glb.mjs` in this directory: drops the three `Wasp_*` clips (they drive
a `WaspArmature` that is not in the file) and `Spider_Death`, renames the rest
to `Idle` / `Walk` / `Jump` / `Attack`, then `meshopt`. 721 KB -> 200 KB.

## Checking a conversion did not break rigging

`gltf-transform` prints a `prune: Removed ... Skin (1)` line that looks like it
broke skinning and does not. Verify rather than trust it:

```js
const root = (await io.read(file)).getRoot()
root.listSkins().length            // expect 1
root.listNodes().filter(n => n.getSkin()).length   // expect 1
```
