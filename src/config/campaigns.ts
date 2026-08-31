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
  // /ar/<id> accepts a campaign id or a pack name, so the two namespaces share
  // one URL segment and a collision would make one of them unreachable.
  if (Object.prototype.hasOwnProperty.call(campaigns, name)) {
    throw new Error(
      `pack "${name}" has the same name as a campaign; /ar/${name} would be ambiguous`,
    );
  }
}

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
  /** The URL segment this was resolved from. Diagnostics only. */
  id: string | null;
}

/**
 * `/ar/<id>` is canonical and is what gets printed. `?id=` exists for desktop
 * testing only and is not on any sticker.
 */
export function resolveCampaignId(location: {
  pathname: string;
  search: string;
}): string | null {
  const fromPath = /^\/ar\/([^/?#]+)/.exec(location.pathname)?.[1];
  if (fromPath) return decodeURIComponent(fromPath);
  return new URLSearchParams(location.search).get("id");
}

/**
 * Resolves the URL to the set of stickers this page will track:
 *
 *   /ar/spider-001   a campaign id  -> that sticker's whole pack, it first
 *   /ar/spiders      a pack name    -> that pack, no sticker singled out
 *   /ar             no id           -> the only pack, if there is only one
 *
 * An unknown id returns null. It never falls back to another campaign, and the
 * no-id form deliberately fails once a second pack exists rather than guessing
 * which one the child is holding.
 */
export function resolveSession(location: {
  pathname: string;
  search: string;
}): Session | null {
  const id = resolveCampaignId(location);

  if (id === null) {
    const only = packs.size === 1 ? [...packs.values()][0] : undefined;
    return only ? { campaigns: only, primary: null, id: null } : null;
  }

  const campaign = getCampaign(id);
  if (campaign) {
    return {
      campaigns: packs.get(campaign.pack) ?? [campaign],
      primary: campaign,
      id,
    };
  }

  const pack = packs.get(id);
  return pack ? { campaigns: pack, primary: null, id } : null;
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
