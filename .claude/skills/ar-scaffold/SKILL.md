---
name: ar-scaffold
description: Bootstrap or repair this repo's build setup — Vite 8 + strict TypeScript + three.js + @8thwall/engine-binary copied to external/xr/, npm scripts, vercel.json rewrite for /ar/*, tsconfig, eslint, .gitignore, directory skeleton. Use for phase-1 boot work, when a file listed in CLAUDE.md's layout is missing, when the engine binary is not reaching dist/external/xr/, or when XR8Promise never resolves.
---

# Scaffold / repair the build

Read `CLAUDE.md` for the architecture; it is authoritative. This skill carries
the mechanics it does not spell out. Load `eightwall-engine-api` before touching
`src/ar/`.

## Order of work

1. `npm init -y`, then dependencies.
2. `vite.config.ts` with the static-copy step.
3. `tsconfig.json` (strict), `eslint.config.js`.
4. `index.html` with the `xr.js` script tag.
5. Directory skeleton + `.gitignore`.
6. `vercel.json`.
7. `npm run build`, then verify `dist/external/xr/xr.js` exists.
8. Phone test — see `ar-phone-test`.

## Dependencies

```
npm i three @8thwall/engine-binary
npm i -D vite typescript @types/three vite-plugin-static-copy eslint typescript-eslint
```

Pin `three` to the version the 8th Wall `examples/threejs` projects use, and put
a comment above the pin in `package.json` saying why it is pinned and what it
was matched against. `@types/three` must match the `three` minor.

## `package.json` scripts

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 3002",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --host 0.0.0.0 --port 3002",
    "targets": "node scripts/compile-target.mjs",
    "check": "tsc --noEmit && eslint ."
  }
}
```

## `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@8thwall/engine-binary/dist/*', dest: 'external/xr' },
      ],
    }),
  ],
  server: { host: '0.0.0.0', port: 3002 },
})
```

The engine ships WASM and worker chunks alongside `xr.js`; the glob must copy the
whole `dist` contents, not just `xr.js`. After a build, confirm more than one
file landed in `dist/external/xr/`.

Do not put the copied files in `public/external/xr/` in git — that path is
generated. `.gitignore` gets `public/external/`, `dist`, `node_modules`,
`.vercel`.

## `index.html`

```html
<script src="./external/xr/xr.js" async data-preload-chunks="slam"></script>
<script type="module" src="/src/main.ts"></script>
```

The relative `./external/xr/xr.js` matters: `/ar/<id>` routes are rewritten to
`index.html`, so a relative path resolves against the *page* URL and breaks on a
nested route. Use root-absolute `/external/xr/xr.js` instead, and keep it that
way. (This is the one place to deviate from the doc snippet, which assumes a
single-page-at-root deployment.)

Also needed in `<head>`: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`
— pinch-zoom on an AR canvas is never wanted, and `viewport-fit=cover` avoids
letterboxing on notched iPhones.

## `tsconfig.json`

Strict plus `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `moduleResolution: "bundler"`, `target: "ES2022"`,
`lib: ["ES2022", "DOM", "DOM.Iterable"]`, `types: ["vite/client"]`.
Write it UTF-8 with LF — the POC's was UTF-16 and `tsc` choked.

`resolveJsonModule: true` if campaign target JSON is imported through the
bundler; prefer `fetch()` of `/targets/<id>/<id>.json` so targets stay static
assets and are swappable without a rebuild.

## Directory skeleton

Create the layout from CLAUDE.md exactly, with each file present and doing only
its one job:

```
public/targets/ public/models/
src/main.ts
src/config/campaigns.ts
src/ar/xr8.ts src/ar/imageTracker.ts
src/three/ThreeScene.ts src/three/ModelLoader.ts src/three/AnimationController.ts
src/ui/
scripts/compile-target.mjs
```

No `counter.ts`, no Vite logo, no `public/vite.svg`.

## `vercel.json`

```json
{
  "rewrites": [{ "source": "/ar/(.*)", "destination": "/index.html" }]
}
```

Nothing else. No headers hack for the WASM MIME type unless a real 404/415 shows
up in the network panel on device — verify before adding.

## Boot-order rule (the one that bites)

`(window as any).THREE = THREE` must happen **before**
`XR8.Threejs.pipelineModule()` is constructed, and
`XR8.XrController.configure({ disableWorldTracking: true, ... })` must happen
before both `XrController.pipelineModule()` and `XR8.run()`. Keep all of it in
one function in `src/ar/xr8.ts` so the order is visible in a single read.

## Phase-1 done means

- `npm run build` clean, `npm run check` clean.
- `dist/external/xr/` contains `xr.js` plus its chunks.
- On a real phone over ngrok: camera feed visible, `XR8Promise` resolved, no
  console errors. No model yet — that is phase 2.
