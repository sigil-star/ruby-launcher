/** Extra data the Roblox app's game page shows (hero video, maturity, events, info rows). */
import { rbx } from "./ipc";

type MediaItem = { assetTypeId: number; assetType: string; imageId: number; videoId?: string | null; approved: boolean };

export type GameHero = { poster: string | null; video: string | null };

const heroCache = new Map<number, Promise<GameHero>>();

async function thumbUrl(imageId: number): Promise<string | null> {
  const r = await rbx<{ data: { imageUrl: string | null }[] }>(`https://thumbnails.roblox.com/v1/assets?assetIds=${imageId}&size=768x432&format=Webp`);
  return r.data?.[0]?.imageUrl ?? null;
}

/**
 * The app plays the experience's preview video as a full-width banner. Its file comes from
 * assetdelivery (signed CDN link) as WebM; we fetch it once and keep a blob URL.
 */
export function gameHero(universeId: number): Promise<GameHero> {
  const hit = heroCache.get(universeId);
  if (hit) return hit;
  const p = (async (): Promise<GameHero> => {
    const media = (await rbx<{ data: MediaItem[] }>(`https://games.roblox.com/v2/games/${universeId}/media`).catch(() => ({ data: [] }))).data ?? [];
    const vid = media.find((m) => m.assetType === "GamePreviewVideo" && m.approved && m.videoId);
    const firstImage = vid?.imageId ?? media.find((m) => m.assetType === "Image" && m.approved)?.imageId;
    const poster = firstImage ? await thumbUrl(firstImage).catch(() => null) : null;
    if (!vid?.videoId) return { poster, video: null };
    try {
      const loc = await rbx<{ locations?: { location?: string }[] }>(`https://assetdelivery.roblox.com/v2/asset/?id=${vid.videoId}`);
      const url = loc.locations?.[0]?.location;
      if (!url) return { poster, video: null };
      const blob = await (await fetch(url)).blob();
      return { poster, video: URL.createObjectURL(new Blob([blob], { type: "video/webm" })) };
    } catch {
      return { poster, video: null };
    }
  })();
  heroCache.set(universeId, p);
  p.catch(() => heroCache.delete(universeId));
  return p;
}

export async function gameMaturity(universeId: number): Promise<{ label: string; descriptors: string[] } | null> {
  try {
    const r = await rbx<{
      ageRecommendationDetails?: {
        summary?: { ageRecommendation?: { displayName?: string; displayNameWithHeaderShort?: string } };
        descriptorUsages?: { descriptor?: { displayName?: string } }[];
      };
    }>("https://apis.roblox.com/experience-guidelines-api/experience-guidelines/get-age-recommendation", { method: "POST", body: { universeId: String(universeId) } });
    const a = r.ageRecommendationDetails;
    const label = a?.summary?.ageRecommendation?.displayName;
    if (!label) return null;
    return { label, descriptors: (a?.descriptorUsages ?? []).map((d) => d.descriptor?.displayName ?? "").filter(Boolean) };
  } catch {
    return null;
  }
}

export type GameEvent = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  start: string;
  end: string;
  imageId: number | null;
  rsvp: string;
};

/** Upcoming and live events (ended ones are hidden, like the app). */
export async function gameEvents(universeId: number): Promise<GameEvent[]> {
  const r = await rbx<{
    data: {
      id: string;
      displayTitle?: string;
      title: string;
      displaySubtitle?: string;
      displayDescription?: string;
      eventTime?: { startUtc: string; endUtc: string };
      thumbnails?: { mediaId: number; rank: number }[];
      userRsvpStatus?: string;
    }[];
  }>(`https://apis.roblox.com/virtual-events/v1/universes/${universeId}/virtual-events?limit=25`).catch(() => ({ data: [] }));
  const now = Date.now();
  return (r.data ?? [])
    .filter((e) => e.eventTime && Date.parse(e.eventTime.endUtc) > now)
    .map((e) => ({
      id: e.id,
      title: e.displayTitle ?? e.title,
      subtitle: e.displaySubtitle ?? "",
      description: e.displayDescription ?? "",
      start: e.eventTime!.startUtc,
      end: e.eventTime!.endUtc,
      imageId: [...(e.thumbnails ?? [])].sort((a, b) => a.rank - b.rank)[0]?.mediaId ?? null,
      rsvp: e.userRsvpStatus ?? "none",
    }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** "Notify Me" on an event (the same RSVP call roblox.com makes). */
export const rsvpEvent = (eventId: string, going: boolean) =>
  rbx(`https://apis.roblox.com/virtual-events/v1/virtual-events/${eventId}/rsvps`, { method: "POST", body: { rsvpStatus: going ? "going" : "notGoing" } });

export type GameExtras = { genre: string | null; subgenre: string | null; voice: boolean | null; camera: boolean | null };

export async function gameExtras(universeId: number): Promise<GameExtras> {
  const [g, v] = await Promise.all([
    rbx<{ data: { genre_l1?: string; genre_l2?: string }[] }>(`https://games.roblox.com/v1/games?universeIds=${universeId}`).catch(() => ({ data: [] })),
    rbx<{ isUniverseEnabledForVoice?: boolean; isUniverseEnabledForAvatarVideo?: boolean }>(`https://voice.roblox.com/v1/settings/universe/${universeId}`).catch(() => null),
  ]);
  const d = g.data?.[0];
  return {
    genre: d?.genre_l1 || null,
    subgenre: d?.genre_l2 || null,
    voice: v ? !!v.isUniverseEnabledForVoice : null,
    camera: v ? !!v.isUniverseEnabledForAvatarVideo : null,
  };
}
