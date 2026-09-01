/**
 * The campaign registry. One printed sticker = one entry = one QR code.
 *
 * A session tracks a PACK, not a single sticker: the engine can hold several
 * image targets at once, so scanning one sticker's QR brings up every sticker
 * in its pack and the child can point the phone at any of them.
 *
 * Target JSON is fetched at runtime rather than imported through the bundler,
 * so a re-compiled target can be swapped in public/targets/ without a rebuild.
 */

/**
 * Image targets we allow active at once. This is OUR policy number, not a
 * limit the engine reports — do not cite it as one:
 *
 * - The retired hosted platform's docs said 10 with world tracking disabled,
 *   5 with it on. We run `disableWorldTracking: true`, hence 10. That site is
 *   gone (retired 2026-02-28) and only reachable through search snippets.
 * - The LIVE docs (8thwall.org) state no limit at all.
 * - The binary contains no such constant on the JS side: neither the
 *   `_c8EmAsm_*` exports nor any `[XR]` warning string mentions a maximum.
 *   If a hard limit exists it is inside the wasm and cannot be read out.
 *
 * So nobody has verified what actually happens at target 11 — a refusal, a
 * silent drop, or just a slower scan. Until a device test measures the real
 * curve (detection latency and fps against target count, on the slowest
 * Android we support), 10 is a conservative default, and the guard below is
 * what stops a 20-sticker registry shipping on an untested assumption.
 *
 * A project may contain any number of targets — only the ACTIVE set is capped.
 * Above this, the set has to be swapped at runtime: calling
 * `XR8.XrController.configure({imageTargetData})` after `run()` diffs against
 * what is loaded, unloads what left the array and loads what joined it
 * (verified in the engine binary, xr-slam.js). We do not do that yet, and we
 * should not until a phone test says packs of 10 are not enough.
 */
export const MAX_ACTIVE_TARGETS = 10;

export interface Campaign {
  /** Must equal the `name` inside the compiled target JSON. */
  targetName: string;
  /** Served URL of the @8thwall/image-target-cli output. */
  targetJson: string;
  model: string;
  /** Multiplier on the size derived from the sticker's physical width. Not absolute. */
  scale: number;
  idleAnim: string;
  /** Animation buttons shown to the child, in this order. */
  animations: string[];
  /**
   * Stickers scanned together. Every sticker in a pack is tracked in the same
   * session, so a pack must never exceed MAX_ACTIVE_TARGETS — enforced below.
   */
  pack: string;
}

export const campaigns = {
  "spider-001": {
    targetName: "spider-001",
    targetJson: "/targets/spider-001/spider-001.json",
    // Quaternius CC0 spider, prepared by tools/prep-glb.mjs. See tools/README.md.
    model: "/models/spider-001.glb",
    scale: 1,
    idleAnim: "Walk",
    // From `gltf-transform inspect public/models/spider-001.glb`, not from memory.
    animations: ["Idle", "Walk", "Jump", "Attack"],
    pack: "creatures",
  },
  "dino-001": {
    targetName: "dino-001",
    targetJson: "/targets/dino-001/dino-001.json",
    // Four builds of the same Sketchfab T-Rex are in public/models/ — swap the
    // path to compare. See tools/README.md.
    //   dino-001.glb                    original download; renders WHITE
    //   dino-001-basecolor.glb          same textures at full PNG size, 5.07 MB
    //   dino-001-basecolor-small.glb    active: those textures re-encoded, 1.18 MB
    //   dino-001-metalrough.glb         full conversion, adds a derived map
    // Only the active build is committed; the rest are local comparison
    // artifacts (see .gitignore).
    model: "/models/dino-001-basecolor-small.glb",
    scale: 1,
    idleAnim: "Animation",
    // This Sketchfab T-Rex ships exactly one clip, literally named "Animation".
    animations: ["Animation"],
    pack: "creatures",
  },
  spiderman: {
    targetName: "spiderman",
    // Compiled from art/spider-001.png — the GENERATED sticker (confetti,
    // corner marks, cartoon spider), not the notebook photo that spider-001
    // was retargeted onto in e42cb4a. Its luminance image is the better of the
    // two against the artwork gate: contrast everywhere, no flat expanse.
    targetJson: "/targets/spiderman/spiderman.json",
    // POC ONLY — red-and-blue webbing is somebody else's trade dress. Swap to
    // /models/webhero-001.glb (identical rig, identical clips, original teal
    // costume) before ANY print run or public deploy. See tools/README.md,
    // "webhero-001.glb".
    model: "/models/webhero-001-spider-poc.glb",
    scale: 1,
    idleAnim: "Idle",
    // From `node tools/glb-doctor.mjs public/models/webhero-001-spider-poc.glb`,
    // not from memory. The GLB also carries "Climb", left off the button row to
    // keep it to four.
    animations: ["Idle", "Web Shoot", "Jump", "Perch"],
    pack: "heroes",
  },
  superman: {
    targetName: "superman",
    // Compiled from art/superman.jpg, a photo of a costumed statue lit from the
    // front. 640x960 is 2:3, so the CLI's fixed 3:4 crop kept 640x853 from
    // top: 54 and dropped the rest — read the numbers off superman.json, not
    // off the source. The luminance image passes the artwork gate on the chest
    // emblem, the face and the folds behind it; the concrete wall is the one
    // flat expanse and it sits at the edges.
    targetJson: "/targets/superman/superman.json",
    // POC ONLY — both the target art and this model are somebody else's
    // trade dress. Swap to /models/webhero-001.glb (identical rig, identical
    // clips, original teal costume) and recompile the target from original art
    // before ANY print run or public deploy. See tools/README.md.
    model: "/models/superman-slim.glb",
    scale: 1,
    idleAnim: "Idle",
    // From `node tools/glb-doctor.mjs public/models/superman-slim.glb`, not
    // from memory. tools/slim-glb.mjs cut the source's 180 clips to exactly
    // these four, so the GLB carries nothing else to show.
    animations: ["Laser", "Jump", "Idle", "Fly"],
    pack: "heroes",
  },
} satisfies Record<string, Campaign>;

export type CampaignId = keyof typeof campaigns;

/** A campaign plus the registry key it is filed under. */
export interface CampaignEntry extends Campaign {
  readonly id: string;
}

const entries: CampaignEntry[] = Object.entries(campaigns).map(
  ([id, campaign]) => ({
    id,
    ...campaign,
  }),
);

const packs = new Map<string, CampaignEntry[]>();
for (const entry of entries) {
  const pack = packs.get(entry.pack);
  if (pack) pack.push(entry);
  else packs.set(entry.pack, [entry]);
}

/**
 * Registry invariants, checked at import so a bad registry fails on the first
 * load in dev rather than as a sticker that mysteriously never tracks.
 *
 * The size rule is the one that matters: the engine silently keeps only part of
 * an oversized target set, which on a phone looks exactly like artwork that
 * will not track.
 */
for (const [name, pack] of packs) {
  if (pack.length > MAX_ACTIVE_TARGETS) {
    throw new Error(
      `pack "${name}" has ${String(pack.length)} stickers; the engine tracks at most ` +
        `${String(MAX_ACTIVE_TARGETS)} at once. Split it into two packs.`,
    );
  }
}

/** Which URL shape a session came from. */
export type SessionRoute = "sticker" | "pack";

/** What one page load tracks. */
export interface Session {
  /** Every campaign whose target is loaded. Never more than MAX_ACTIVE_TARGETS. */
  campaigns: CampaignEntry[];
  /**
   * The sticker the URL named, when it named one. Its model is pre-loaded and
   * its animation buttons are shown first, because it is the sticker the child
   * is holding.
   */
  primary: CampaignEntry | null;
  route: SessionRoute;
  /** The pack name or campaign id the URL carried. Diagnostics only. */
  id: string;
}

const STICKER_PATH = /^\/ar\/([^/?#]+)/;
const PACK_PATH = /^\/pack\/([^/?#]+)/;

/**
 * Resolves the URL to the set of stickers this page will track. Two routes,
 * two separate namespaces — a pack name and a campaign id can never be mistaken
 * for one another, so they are free to collide:
 *
 *   /ar/<campaign-id>        exactly that sticker, and nothing else
 *   /pack/<pack-name>        every sticker in the pack
 *   /pack/<pack-name>?s=<id> the pack, with <id> named as the one scanned
 *
 * Which one is printed on a sticker is a PRINTING decision, not a code one.
 * Both routes are always live: putting /pack/creatures?s=spider-001 on the
 * sticker gives the child every sticker in the set from one QR, and putting
 * /ar/spider-001 on it gives them that sticker alone. Moving between those is a
 * reprint, not a deploy — which is what keeps "one link per sticker" reachable
 * without touching the registry.
 *
 * `?id=` and `?pack=` do the same as their path forms, for desktop testing.
 * They are not on any sticker.
 *
 * An unknown id or pack returns null. It never falls back to another campaign,
 * and no URL at all is an error rather than a guess at which sticker the child
 * is holding.
 */
export function resolveSession(location: {
  pathname: string;
  search: string;
}): Session | null {
  const params = new URLSearchParams(location.search);

  const fromPackPath = PACK_PATH.exec(location.pathname)?.[1];
  const packName =
    fromPackPath === undefined
      ? params.get("pack")
      : decodeURIComponent(fromPackPath);
  if (packName !== null) {
    const pack = packs.get(packName);
    if (!pack) return null;
    // `s` is only a hint: it decides which model is pre-loaded and which
    // buttons show first. A hint naming a sticker outside this pack is ignored
    // rather than refused — the pack is still exactly the right thing to track.
    const scanned = params.get("s");
    return {
      campaigns: pack,
      primary: pack.find((campaign) => campaign.id === scanned) ?? null,
      route: "pack",
      id: packName,
    };
  }

  const fromStickerPath = STICKER_PATH.exec(location.pathname)?.[1];
  const stickerId =
    fromStickerPath === undefined
      ? params.get("id")
      : decodeURIComponent(fromStickerPath);
  if (stickerId !== null) {
    const campaign = getCampaign(stickerId);
    return campaign
      ? {
          campaigns: [campaign],
          primary: campaign,
          route: "sticker",
          id: stickerId,
        }
      : null;
  }

  return null;
}

/** Unknown id returns null. Never fall back to another campaign. */
export function getCampaign(id: string | null): CampaignEntry | null {
  if (id === null) return null;
  return entries.find((entry) => entry.id === id) ?? null;
}

/**
 * Fetches the compiled target. The JSON's `imagePath` must resolve against the
 * served page — a target that never fires `imagescanning` is usually a 404 here.
 */
export async function loadTargetData(campaign: Campaign): Promise<unknown> {
  const response = await fetch(campaign.targetJson);
  if (!response.ok) {
    throw new Error(
      `target ${campaign.targetJson} returned ${String(response.status)}`,
    );
  }
  // /ar/<id> is rewritten to index.html, so a wrong target path comes back as
  // 200 text/html rather than a 404. Without this check, response.json() fails
  // with "Unexpected token '<'", which names neither the file nor the cause.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(
      `target ${campaign.targetJson} returned ${contentType}, not JSON. ` +
        `A served index.html here means the file does not exist at that path.`,
    );
  }
  return response.json();
}

/**
 * All of a session's targets, fetched in parallel. One failure fails the
 * session: a pack with a missing target would come up tracking some stickers
 * and silently ignoring others, which is worse than an error screen.
 */
export function loadSessionTargets(session: Session): Promise<unknown[]> {
  return Promise.all(session.campaigns.map(loadTargetData));
}
