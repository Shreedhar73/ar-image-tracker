import {defineConfig} from 'vite'
import {viteStaticCopy} from 'vite-plugin-static-copy'

// The 8th Wall engine binary must ship with the app — never a CDN.
// Its dist/ holds xr.js plus xr-slam.js, xr-face.js and a resources/ folder of
// worker and model assets that xr.js fetches by relative path at runtime, so
// the whole tree is copied, not just the entry script.
export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        // stripBase: 4 drops "node_modules/@8thwall/engine-binary/dist" and
        // keeps everything below it, so xr.js lands at external/xr/xr.js and
        // its runtime fetches under external/xr/resources/ still resolve.
        // Without a rename, vite-plugin-static-copy v4 preserves the whole
        // matched path and xr.js 404s.
        //
        // The negative patterns drop ~29 MB of the binary's 36 MB. Every
        // resource is reached through a lazy URL builder (`hI = A => () => wI() + A`),
        // so a file is only fetched at its one call site. Call sites were read
        // out of the minified chunks, not assumed:
        //
        //   *.tflite (16.6 MB) — the three face models are resolved ONLY from
        //     xr-face.js; semantics-model is fetched by the semantics worker,
        //     which only starts for sky-segmentation layers.
        //   xr-face.js (7.3 MB) — face tracking. Never loaded; we add no face
        //     pipeline module.
        //   semantics-worker.js (5.0 MB) — sky segmentation. No call path.
        //   media-worker.js (5.0 MB) — XR8.MediaRecorder only (video/mp4 mux,
        //     encodeAudio, cover/footer images). We never add that module.
        //
        // KEPT: xr.js, xr-slam.js (image tracking may sit in the slam chunk —
        // untested, and index.html preloads it per CLAUDE.md), powered-by.svg
        // (attribution, rendered unconditionally) and the dom-tablet glbs (81 KB).
        //
        // To revert, delete the four negative patterns. If face tracking, sky
        // effects or recording is ever added, they MUST come back — the symptom
        // is a 404 on a phone, not a build error.
        {
          src: [
            'node_modules/@8thwall/engine-binary/dist/**/*',
            '!node_modules/@8thwall/engine-binary/dist/**/*.tflite',
            '!node_modules/@8thwall/engine-binary/dist/xr-face.js',
            '!node_modules/@8thwall/engine-binary/dist/resources/semantics-worker.js',
            '!node_modules/@8thwall/engine-binary/dist/resources/media-worker.js',
          ],
          dest: 'external/xr',
          rename: {stripBase: 4},
        },
        // Draco decoder for compressed GLBs. DRACOLoader fetches these at
        // runtime by path, so they cannot be bundled — they must be files.
        {
          src: 'node_modules/three/examples/jsm/libs/draco/gltf/*',
          dest: 'external/draco',
          rename: {stripBase: true},
        },
      ],
    }),
  ],
  // Vite rejects requests whose Host header is not allowlisted (DNS-rebinding
  // fix, Vite >=5.4.12). Phone testing goes through an ngrok tunnel, which
  // sends its own domain — without these suffixes every request is a
  // "Blocked request. This host is not allowed." Suffixes, never `true`:
  // `true` reopens the hole the default exists to close.
  server: {
    host: '0.0.0.0',
    port: 3002,
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
  },
  preview: {host: '0.0.0.0', port: 3002},
  build: {target: 'es2022'},
})
