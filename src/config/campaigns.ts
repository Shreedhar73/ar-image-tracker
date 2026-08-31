/**
 * The campaign registry. One printed sticker = one entry = one QR code.
 *
 * Target JSON is fetched at runtime rather than imported through the bundler,
 * so a re-compiled target can be swapped in public/targets/ without a rebuild.
 */

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
}

export const campaigns = {
  "spider-001": {
    targetName: "spider-001",
    targetJson: "/targets/spider-001/spider-001.json",
    model: "/models/spider.glb",
    scale: 1,
    idleAnim: "Idle",
    animations: ["Idle", "Dance", "Jump"],
  },
} satisfies Record<string, Campaign>;

export type CampaignId = keyof typeof campaigns;

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

/** Unknown id returns null. Never fall back to another campaign. */
export function getCampaign(id: string | null): Campaign | null {
  if (id === null) return null;
  return Object.prototype.hasOwnProperty.call(campaigns, id)
    ? campaigns[id as CampaignId]
    : null;
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
  return response.json();
}
