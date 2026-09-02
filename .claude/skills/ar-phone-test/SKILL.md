---
name: ar-phone-test
description: Run the on-device test that closes every phase of this project — dev server plus ngrok HTTPS, the per-phase acceptance checklist (boot, track, character, product UI, ship), reading logs off a phone, and the Vercel deploy checklist. Use when finishing any phase, when asked whether something works, before a deploy, or when a change works on desktop but is reported broken on a phone.
---

# Phone test

CLAUDE.md's rule: **every phase ends with a phone test, not a desktop test.** A
desktop browser gives a webcam feed and a fake pose; it cannot tell you whether
tracking, scale, thermal behaviour or iOS Safari's quirks are right. Never report
a phase complete on desktop evidence.

## Get onto a phone

```
npm run dev                 # 0.0.0.0:3002
ngrok http 3002             # use the https:// URL
```

Camera requires HTTPS or `localhost`; a LAN IP over plain HTTP silently gives no
camera on both iOS and Android. If `XR8Promise` hangs, first check
`/external/xr/xr.js` returns 200 on the phone — an ngrok interstitial page or a
404 there looks exactly like an engine bug.

Test the real route (`/ar/<id>`), not `?id=`, from at least phase 4 on. `?id=`
skips the `vercel.json` / dev-fallback rewrite, which is where routing bugs live.

## Reading what happened on the device

- **Android Chrome:** `chrome://inspect` on the desktop, phone in USB debug mode
  → full DevTools including network and console.
- **iOS Safari:** Settings → Safari → Advanced → Web Inspector, then Safari on
  the Mac → Develop → device → the tab.
- **Neither available:** `?debug=1` panel (the only sanctioned debug UI). Show
  tracking state, last event name, `scaledWidth`, fps. Nothing else, and never
  visible without the flag — kids see start button, scan hint and the
  character. (The animation bar is unplugged: `ANIMATION_BUTTONS_ENABLED`.)

## Per-phase acceptance

### Phase 1 — Boot
- [ ] Page loads over ngrok on iOS Safari and Android Chrome
- [ ] Camera permission prompt appears; granting shows a live feed
- [ ] Feed fills the screen, correct orientation, correct aspect (no stretch)
- [ ] `XR8Promise` resolved; zero console errors
- [ ] Rotating the device does not break the feed

### Phase 2 — Track
- [ ] `imagescanning` fires with the expected target name
- [ ] Pointing at the printed 8 cm sticker fires `imagefound` within ~1 s
- [ ] A test cube sits **on** the sticker, not floating or sunk
- [ ] Cube edge length reads roughly right against the 8 cm sticker on both a
      phone and a tablet (this proves `scaledWidth` sizing, not a hardcoded scale)
- [ ] Moving the phone: **no visible lag** between sticker and cube — if the
      cube trails, the pose is not being applied in the event handler
- [ ] Covering the sticker LEAVES the cube where the sticker is (holding is the
      designed behaviour since SLAM went on — see CLAUDE.md AR contract rule 7).
      It must not slide or float with the camera: that would mean the pose is
      camera-relative, and holding is wrong
- [ ] Panning until the sticker is off screen drops the cube within ~0.5 s;
      panning back re-finds it with no visible pop
- [ ] Steep viewing angle (~60°) still tracks
- [ ] Printed sticker under glare still tracks; note the failure angle

### Phase 3 — Character
- [ ] GLB loads on mobile data (not just wifi); time it
- [ ] Idle animation plays on `imagefound`
- [ ] Character grounded on the sticker; feet not clipping through
- [ ] Shadow catcher visible and sized to `scaledWidth × scaledHeight` — the
      single biggest "it's really on the sticker" cue
- [ ] Materials look right: sRGB output, ACES tone mapping, `RoomEnvironment`
      reflections. Compare against desktop; a washed-out or black model means
      colour space or env map
- [ ] Sustained 30 s of tracking: no frame-rate collapse, phone not scalding
- [ ] Low-end Android included in this pass, not deferred to phase 5

### Phase 4 — Product UI
- [ ] Start screen → camera permission → scan hint → character, no dead ends
- [ ] Scan hint disappears on found, returns on lost
- [ ] No animation bar on screen (`ANIMATION_BUTTONS_ENABLED` is `false`); the
      character plays its idle clip and nothing else is offered
- [ ] Tap targets that ARE on screen reachable one-handed, ≥ 44 px
- [ ] `/ar/<id>` loads directly (deep link, and a fresh tab)
- [ ] Unknown id → the error screen, never a fallback campaign
- [ ] **Camera denied** → error screen with one action, and recovering after
      granting in settings works
- [ ] **Unsupported browser** (in-app webview: Instagram, Facebook, TikTok — this
      is how most children will actually open the QR) → the "open in Safari /
      Chrome" screen, with a working way out
- [ ] Locking and unlocking the phone mid-session recovers

### Phase 5 — Ship
- [ ] `npm run build` and `npm run check` clean
- [ ] Deployed to Vercel; `dist/external/xr/` present in the deployment
- [ ] `/ar/<id>` works on the production host (proves the `vercel.json` rewrite)
- [ ] Printed QR scans from ~20 cm on iOS and a low-end Android
- [ ] Full pass on iOS Safari, Android Chrome, and one low-end Android
- [ ] Cold-load time on mobile data recorded per campaign

## Deploy

Static only, no backend.

```
npm run build
npx vercel deploy --prebuilt          # preview
npx vercel deploy --prebuilt --prod   # production
```

Verify on the deployed URL, in this order — each rules out one class of failure:

1. `/` loads.
2. `/external/xr/xr.js` returns 200 with a JavaScript content type.
3. `/targets/<id>/<id>.json` returns 200, and the `imagePath` inside it also
   returns 200.
4. `/models/<id>.glb` returns 200.
5. `/ar/<id>` loads (rewrite works) **and** `/external/xr/xr.js` still resolves
   from that route — the classic break is a relative script src resolving to
   `/ar/external/xr/xr.js`.
6. `/ar/does-not-exist` shows the error screen.

Only then re-scan a physical sticker against production. A deploy is not done
until a printed sticker has been scanned on the production host.

## Reporting

Say which devices, which OS versions, and which checklist items were verified
versus skipped. "Works on my phone" is not a phase gate. If an item failed, quote
what happened; do not tick it.
