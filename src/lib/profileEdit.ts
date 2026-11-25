import { rbx } from "./ipc";

/* Display name (users API: PATCH /v1/users/{id}/display-names). */
export async function validateDisplayName(userId: number, name: string): Promise<string | null> {
  try {
    await rbx(`https://users.roblox.com/v1/users/${userId}/display-names/validate?displayName=${encodeURIComponent(name)}`);
    return null;
  } catch (e) {
    return (e as Error).message || "That display name can't be used.";
  }
}
export const setDisplayName = (userId: number, name: string) =>
  rbx(`https://users.roblox.com/v1/users/${userId}/display-names`, { method: "PATCH", body: { newDisplayName: name } });

/*
 * Profile picture ("thumbnail customization"): an emote pose plus camera for the headshot.
 * Ranges as Roblox accepts them: field of view 15–45°, turn −60…60°, distance 0.5–4 (1 = default).
 */
export type HeadshotCamera = { fieldOfViewDeg: number; yRotDeg: number; distanceScale: number };
export type ThumbCustomization = { thumbnailType: number; emoteAssetId: number; camera: HeadshotCamera };
/** Roblox's thumbnail types: 1 = headshot (profile picture), 2 = full body. */
export const HEADSHOT = 1;
export const DEFAULT_CAMERA: HeadshotCamera = { fieldOfViewDeg: 30, yRotDeg: 0, distanceScale: 1 };

export async function thumbnailCustomizations(): Promise<ThumbCustomization[]> {
  const r = await rbx<{ avatarThumbnailCustomizations?: ThumbCustomization[] }>("https://avatar.roblox.com/v1/avatar/thumbnail-customizations");
  return r.avatarThumbnailCustomizations ?? [];
}
export const saveThumbnailCustomization = (c: ThumbCustomization) =>
  rbx("https://avatar.roblox.com/v1/avatar/thumbnail-customization", { method: "POST", body: c });

/** Emotes you own (asset type 61), newest first. */
export async function ownedEmotes(userId: number): Promise<{ id: number; name: string }[]> {
  const out: { id: number; name: string }[] = [];
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const r = await rbx<{ data: { assetId: number; assetName?: string; name?: string }[]; nextPageCursor: string | null }>(
      `https://inventory.roblox.com/v2/users/${userId}/inventory/61?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    out.push(...(r.data ?? []).map((d) => ({ id: d.assetId, name: d.assetName ?? d.name ?? "" })));
    if (!r.nextPageCursor) break;
    cursor = r.nextPageCursor;
  }
  return out;
}

export type ProfileFrame = { assetId: number; name: string };

/** Every frame on offer: the marketplace widget feed for "profile-frames", named via hydrate. */
export async function profileFrames(): Promise<ProfileFrame[]> {
  const r = await rbx<{ widgets?: Record<string, { content?: { type: string; id: number }[] }> }>(
    `https://apis.roblox.com/marketplace-widgets/v1/widgets?requestId=${crypto.randomUUID()}&context=catalog-tab:profile-frames`,
  );
  const ids: number[] = [];
  for (const w of Object.values(r.widgets ?? {})) for (const c of w.content ?? []) if (c.type === "Asset" && !ids.includes(c.id)) ids.push(c.id);
  if (!ids.length) return [];
  const h = await rbx<{ hydratedContent?: { id: number; name?: string }[] }>("https://apis.roblox.com/marketplace-widgets/v1/widgets/hydrate", {
    method: "POST",
    body: { content: ids.map((id) => ({ id, type: "Asset" })) },
  }).catch(() => ({ hydratedContent: [] }));
  const names = new Map((h.hydratedContent ?? []).map((x) => [x.id, x.name ?? ""]));
  return ids.map((id) => ({ assetId: id, name: names.get(id) || "Frame" }));
}

type V4Config = {
  avatarConfigurations?: {
    profileFrame?: { frameAsset?: { id: number; name?: string }; frameAssetId?: number } | null;
    thumbnailCustomizations?: ThumbCustomization[] | null;
  };
};

/** The frame you have on (asset id), or null for none. */
export async function equippedFrame(userId: number): Promise<number | null> {
  const r = await rbx<V4Config>(`https://avatar.roblox.com/v4/avatar/users/${userId}?selectionTypes=ProfileFrame`);
  const f = r.avatarConfigurations?.profileFrame;
  const id = f?.frameAsset?.id ?? f?.frameAssetId;
  return typeof id === "number" && id > 0 ? id : null;
}

/** Put a frame on (0 takes it off). */
export const equipFrame = (assetId: number) =>
  rbx("https://avatar.roblox.com/v4/avatar", {
    method: "PATCH",
    body: { updateTypes: ["UpdateProfileFrame"], avatarDefinition: { updateAvatarConfig: { profileFrameRequestModel: { id: assetId } } } },
  });

/** Your saved poses straight from the v4 avatar config (what roblox.com reads). */
export async function thumbnailCustomizationsV4(userId: number): Promise<ThumbCustomization[]> {
  const r = await rbx<V4Config>(`https://avatar.roblox.com/v4/avatar/users/${userId}?selectionTypes=ThumbnailCustomizations`);
  return r.avatarConfigurations?.thumbnailCustomizations ?? [];
}
