import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { backgroundImage, profileBackground } from "../lib/api";
import type { Avatar3DProps } from "./Avatar3D";
import type { AvatarRigProps } from "./AvatarRig";
import { t } from "../lib/i18n";

// three.js is large; only load it the first time a 3D view is actually shown.
const Avatar3DImpl = lazy(() => import("./Avatar3D").then((m) => ({ default: m.Avatar3D })));
const AvatarRigImpl = lazy(() => import("./AvatarRig").then((m) => ({ default: m.AvatarRig })));

function FigureSkeleton({ className }: { className?: string }) {
  return (
    <div className={`avatar-3d ${className ?? ""}`}>
      <div className="avatar-3d-state">
        <div className="model-loader" aria-busy="true" aria-label={t("Loading 3D")}><span /></div>
      </div>
    </div>
  );
}

/** Rigged, animated avatar (loops the first equipped emote). */
export function AvatarRig(props: AvatarRigProps) {
  return (
    <Suspense fallback={<FigureSkeleton className={props.className} />}>
      <AvatarRigImpl {...props} />
    </Suspense>
  );
}

/**
 * The image behind an avatar: `overrideAssetId` (e.g. a background being tried on) wins,
 * otherwise the user's own profile backdrop.
 */
export function useBackdrop(userId: number, overrideAssetId?: number | null) {
  const own = useQuery({
    queryKey: ["profileBackground", userId],
    queryFn: () => profileBackground(userId),
    staleTime: 5 * 60_000,
  });
  const assetId = overrideAssetId ?? own.data ?? null;
  const img = useQuery({
    queryKey: ["backgroundImage", assetId],
    queryFn: () => backgroundImage(assetId!),
    enabled: !!assetId,
    staleTime: 60 * 60_000,
  });
  return assetId ? (img.data ?? null) : null;
}

export function Avatar3D(props: Avatar3DProps) {
  return (
    <Suspense
      fallback={
        <div className={`avatar-3d ${props.className ?? ""}`}>
          <div className="avatar-3d-state">
            <div className="model-loader" aria-busy="true" aria-label={t("Loading 3D")}><span /></div>
          </div>
        </div>
      }
    >
      <Avatar3DImpl {...props} />
    </Suspense>
  );
}
