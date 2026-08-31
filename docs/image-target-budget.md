# How many stickers can one page track?

Written 2026-08-31, when the app moved from one URL per sticker to one URL per
**pack**. The honest answer is *nobody has measured it on this engine*, so this
records what is known, what is assumed, what would settle it, and how to walk
the design back if the assumption turns out to be wrong.

---

## The number we ship, and where it is from

`MAX_ACTIVE_TARGETS = 10` in `src/config/campaigns.ts`. It is **our policy, not
a limit the engine reports.** Three sources, none of them the binary we run:

| Source | What it says |
| --- | --- |
| Retired hosted-platform docs (`www.8thwall.com`) | 10 active image targets with world tracking disabled, 5 with it enabled. 5 autoloaded per project. Platform retired 2026-02-28; the site no longer serves, so this survives only in search snippets |
| Live docs (`8thwall.org`) | No limit stated, anywhere — including the Studio image-targets guide |
| `@8thwall/engine-binary` itself | No such constant on the JS side. Neither the `_c8EmAsm_*` wasm exports nor any `[XR]` warning string in `xr-slam.js` mentions a maximum. If a hard limit exists it is compiled into the wasm and cannot be read out |

We run `disableWorldTracking: true`, which is why 10 and not 5.

**So what happens at target 11 is unknown.** It could be a refusal, a silent
drop of the extras, or simply a slower scan. Those three have very different
consequences, and the difference is not visible in code — the symptom of the
second one is a sticker that never tracks on a phone, which looks exactly like
bad artwork.

## Why any limit exists

Not a data-structure ceiling. A per-frame CPU budget.

While the engine is *scanning*, it extracts descriptors from each camera frame
and matches them against every loaded target's feature set. That work is linear
in the number of loaded targets and has to fit inside one frame. SLAM competes
for the same budget, which is exactly why the legacy number halved from 10 to 5
when world tracking was on.

Once a target is **found**, tracking it is cheap. The expense is the scan — i.e.
the entire time between the child pointing the phone and anything appearing.
More targets does not make a tracked character slower; it makes the wait longer.

## What actually limits this app, ranked by what bites first

1. **Model memory.** 20 characters at ~1.2 MB each is an out-of-memory crash on
   a low-end Android well before target count matters. Mitigated: a GLB
   downloads on that sticker's *first detection* and is cached per campaign for
   the session; only the sticker named in the URL is fetched up front.
2. **Download before scanning starts.** Every target's luminance PNG is fetched
   before `imagescanning` fires. Ours are ~270 KB each, so a full pack of 10 is
   ~2.7 MB sitting between the start tap and the first possible detection.
3. **Detection latency.** Linear in target count. This is the one a child feels.
4. **Cross-confusion.** Independent of any cap: more artworks loaded means more
   chance two share descriptors and the wrong character appears. This is an
   artwork problem, not a code one — see the layout rule in
   `art/make-sticker.mjs`.
5. **Wasm heap** for the descriptor sets. Smallest of these.

## The four modes, cheapest to reach first

### 1. Pack — what is shipped

Every campaign carries a `pack`. `/ar/<sticker-id>` loads that sticker's whole
pack, so one QR gives the child every sticker in the set and pointing the phone
at a friend's sticker works with no reload. `/ar/<pack>` loads a pack directly.
Bare `/ar` works only while exactly one pack exists.

### 2. One sticker per link — the fallback

**Give each campaign its own `pack` value. That is the entire change.** No code
edit, no route change, no revert of the multi-target work: a pack of one is a
valid pack, and every per-sticker structure in `main.ts` already exists.

Verified against the real `resolveSession`, with `pack` values made unique:

```
/ar/spider-001  -> spider-001 primary=spider-001
/ar/dino-001    -> dino-001   primary=dino-001
/ar             -> error screen (more than one pack)
/ar/creatures   -> error screen (no such pack)
```

The printed URL never changes — `/ar/<id>` was always the QR contract, in both
modes. What is lost is only the "point at a friend's sticker" behaviour. What is
kept: lazy per-sticker model loading, per-sticker anchor/rig/mixer, the runtime
guards, and the ability to go back to packs by editing the same field.

### 3. Smaller packs

If 10 proves too many but 1 is too few, packs are per-theme and any size ≤ the
cap. Lowering `MAX_ACTIVE_TARGETS` tightens the guard for everyone at once.

### 4. Swapping the active set mid-session — not built

Above the cap, the active set can be changed at runtime. Calling
`XR8.XrController.configure({imageTargetData})` **after** `run()` is honoured:
the loader in `xr-slam.js` diffs the new array against what is loaded, calls
`_c8EmAsm_unloadDetectionImages` for the ones that left, loads only the ones
that joined, and re-fires `imageloading` / `imagescanning`. Verified by reading
the binary, not from documentation.

The catch is knowing *which* window to load. The hosted platform solved this
with a cloud image-recognition call, which no longer exists and would mean a
backend this project does not have. Without that hint, the alternatives are to
key the window off the scanned sticker's id (which the QR already gives us) or
to rotate windows blindly, doubling time-to-detect. **Do not build this until a
measurement says packs are not enough.**

## The measurement that would settle it

One afternoon, not a research project:

1. Generate ~20 distinct target artworks (`art/make-sticker.mjs` layouts, or any
   20 non-repeating images) and compile each with `npm run targets`.
2. Load the first *N* into `imageTargetData` for N = 1, 2, 5, 10, 15, 20.
3. On the **slowest Android** in scope, with the same sticker in frame each
   time, record: time from `imagescanning` to the first `reality.imagefound`;
   sustained fps while scanning; whether every target fires `imagescanning` at
   all; and whether the right target is reported.
4. Read the curve. A hard refusal or a missing target at some N is the real cap.
   A smooth latency climb means the cap is a UX judgement, and the number should
   be whatever keeps time-to-detect acceptable — then written back into
   `MAX_ACTIVE_TARGETS` with the measurement beside it.

Until then the guard in `campaigns.ts` is what stops a 20-sticker registry
shipping on an untested assumption: it throws at import, in dev, on the first
page load.

## Related measured numbers

- The engine only ever sees the **480×640 grayscale luminance image**, and only
  `imagePath` is read from the target JSON — the CLI's other outputs are not
  fetched (`compile-target.mjs` deletes the largest of them).
- Luminance PNG: ~270 KB per target at our artwork complexity.
- Committed models: `spider-001.glb` 200 KB (meshopt, no textures),
  `dino-001-basecolor-small.glb` 1.18 MB (WebP textures + meshopt).
