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

## dino-001.glb — Sketchfab T-Rex

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
node tools/specgloss-to-basecolor.mjs trex-src.glb dino-001-basecolor.glb
# 6.31 -> 5.07 MB. Optionally re-encode the SAME images for phones:
npx @gltf-transform/cli webp    dino-001-basecolor.glb tmp.glb --quality 95
npx @gltf-transform/cli meshopt tmp.glb dino-001-basecolor-small.glb
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
npx @gltf-transform/cli meshopt    trex-w.glb    dino-001.glb
```

6.3 MB -> 1.64 MB. This bakes a NEW `metallicRoughnessTexture` out of the
specularGlossiness map, so per-pixel shininess survives — but it is an image
that was not in the source. Prefer Option 1 when the textures must be exactly
the source textures.

One clip, named `Animation`. Verify with
`npx @gltf-transform/cli inspect public/models/dino-001.glb` before editing
`campaigns.ts` — the clip list there must match exactly.

## spider-001.glb — Quaternius spider (CC0)

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

## webhero-001.glb — a rigged, animated character assembled from CC0 parts

The first character in this repo that was not supplied whole. Nothing here
authors geometry or keyframes: two Quaternius CC0 packs are combined, and the
costume is derived from the rig the packs already ship.

Sources (CC0 1.0, licence files kept beside them in
`~/Desktop/yipl_projects/3d-models-glb/Exports/quaternius-cc0/`):

| Pack | What it gives | itch.io slug |
| --- | --- | --- |
| Universal Base Characters | `Superhero_Male_FullBody` — body, 65-bone rig, no clips | `universal-base-characters` |
| Universal Animation Library | 43 clips on a mannequin | `universal-animation-library` |
| Universal Animation Library 2 | 43 more, incl. `NinjaJump_Start`, `ClimbUp_1m` | `universal-animation-library-2` |

`quaternius.com` did not resolve from this machine; the packs came from
itch.io's free-download flow, scripted in `fetch-itch-pack.mjs`:

```sh
node tools/fetch-itch-pack.mjs universal-base-characters ubc.zip
```

Two things about that flow bite: the signed URL
its `download_url` endpoint returns **expires in about 45 seconds**, so the
whole chain has to run in one process, and the file endpoint is
`POST /<slug>/file/<upload_id>?source=game_download` — NOT under the
`/download/<key>/` path the page's own URL suggests, which 404s.

The base-character `.gltf` also ships two **broken image URIs**
(`T_Hair_1_Normal_png.png`, `T_Eye_Normal_png.png`, neither of which exists);
strip the `_png` and it loads. Those textures prune away anyway.

### The pipeline

```sh
# 1. clips, retargeted onto the superhero rig (see below)
node tools/retarget-anim.mjs Superhero_Male_FullBody.gltf UAL1_Standard.glb s1.glb \
  Idle_Loop=Idle Spell_Simple_Shoot="Web Shoot" Crouch_Idle_Loop=Perch
node tools/retarget-anim.mjs s1.glb UAL2_Standard.glb s2.glb \
  NinjaJump_Start=Jump ClimbUp_1m=Climb

# 2. drop the hair/eyebrow leftovers, blow the eyeballs up into mask lenses
node tools/prep-hero.mjs s2.glb s3.glb 1.6

# 3. paint the costume  (costume = hero | spider)
node tools/bake-suit-texture.mjs s3.glb s4.glb hero 1024

# 4. the usual squeeze: 6.7 MB -> 0.42 MB
npx @gltf-transform/cli resize  s4.glb a.glb --width 1024 --height 1024
npx @gltf-transform/cli webp    a.glb  b.glb --quality 90
npx @gltf-transform/cli meshopt b.glb  public/models/webhero-001.glb
```

Clips: `Idle`, `Web Shoot`, `Perch`, `Jump`, `Climb`. There is **no swing clip**
in either library — the one animation the brief asked for that CC0 does not
supply. It has to be hand-keyed or bought.

### Why the clips need retargeting rather than copying

Both packs use the same 65 bones with the same names in the same order, which
makes a straight channel copy look safe. It is not. The superhero's bone
lengths run 0.72x to 1.24x the mannequin's, its rest orientations differ by up
to 17 degrees, and **every UAL channel is fully baked** — translation, rotation
and scale on all 65 bones, every frame. Copying them across replaces the
target's rest pose with the mannequin's while the mesh is still bound through
the superhero's inverse bind matrices, and the body deforms.

`retarget-anim.mjs` copies the *delta from rest* instead, keeps the target's
own bone lengths, drops scale (the source's are all 1) and rescales only the
hip translation. Watch the hip scale: the rig is Z-up out of Blender, so
reading `translation[1]` compares the two rigs' sideways drift (0.86x) and not
their heights (1.03x).

`verify-retarget.mjs` checks the result by comparing world-space joint
positions frame by frame, height-normalised:

```sh
node tools/verify-retarget.mjs UAL1_Standard.glb Idle_Loop out.glb Idle
# worst normalised joint offset: 0.0431 head-heights — PASS
```

It goes red when it should: pointing it at the wrong target clip reports 0.33
and fails. Clips with a lot of limb travel (`Jump`) land near 0.09 because the
superhero's arms are 8% shorter — that is the proportion difference, not a
broken retarget, and the deciding test is still looking at it.

### Why the costume comes from the skin weights

The base character is a bare body with a 2048px skin texture, and there is no
UV layout written down anywhere. But the rig already partitions the body: a
vertex whose heaviest joint is `hand_r` is a glove, `ball_l` is a boot, `Head`
is the mask. `bake-suit-texture.mjs` rasterises those regions into UV space and
writes a PNG with `node:zlib` — no image library, so it cannot break when a
transitive dependency moves.

Two costumes are defined in that file:

- **`hero`** — teal and amber, two tones, original. This is the one that can
  ship.
- **`spider`** — red and blue with webbing and a chest spider. **POC ONLY.**
  It is somebody else's trade dress; it must not reach a printed sticker or a
  production campaign without a licence. Kept because it was asked for and it
  exercises the pattern path.

The webbing is spun in **3D, not in UV**: UV seams would cut the strands into
unrelated fragments. Every pixel knows the model-space point it came from, so
one sphere of spokes and rings wraps the whole torso continuously. Two details
matter — the web's pole points **forward**, not up (pole it along world up and
the mask becomes vertical stripes), and each red panel spins from its own
centre, so the mask webs from the face and the torso from the sternum. Strands
are suppressed near both poles, where they would merge into a black disc; that
is exactly where the spider glyph goes.

Which way the model faces is not recorded anywhere either. It is derived from
the feet: the ball of the foot always sits forward of the ankle, so the
flattened vector between them is the character's forward.
