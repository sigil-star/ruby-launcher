import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { rbx, on } from "../lib/ipc";
import { useUi } from "../app/store";
import { Icon } from "./ui";
import { useSuppressEmbed } from "./WebEmbed";
import { t } from "../lib/i18n";

type Step = "updating" | "starting" | "joining" | "ready";

async function placeIcon(placeId: number): Promise<string | null> {
  const r = await rbx<{ data: { imageUrl: string | null }[] }>(
    `https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeId}&returnPolicy=PlaceHolder&size=256x256&format=Webp&isCircular=false`,
  );
  return r.data?.[0]?.imageUrl ?? null;
}

/**
 * The "Joining…" card: the game's icon, its name, where the launch is (updating Roblox,
 * starting the client, joining the server) and a cancel. Closes itself once the game is up.
 */
export function LaunchCard() {
  const { launching, dismissLaunch } = useUi();
  const [step, setStep] = useState<Step>("starting");
  const [install, setInstall] = useState<{ done: number; total: number } | null>(null);
  const icon = useQuery({
    queryKey: ["placeIcon", launching?.placeId],
    queryFn: () => placeIcon(launching!.placeId),
    enabled: !!launching?.placeId,
    staleTime: 60 * 60_000,
  });

  useEffect(() => {
    if (!launching) return;
    setStep("starting");
    setInstall(null);
    const subs = [
      on<{ stage: string; done: number; total: number }>("roblox-install-progress", (p) => {
        if (p.stage === "done") {
          setInstall(null);
          setStep("starting");
        } else {
          setStep("updating");
          setInstall({ done: p.done, total: p.total });
        }
      }),
      on("launch-game-running", () => setStep("joining")),
      // "roblox-session-state" fires as soon as Ruby starts the client; only the log watcher
      // seeing a server join means we are really in.
      on("roblox-game-joined", () => setStep("ready")),
    ];
    return () => {
      subs.forEach((s) => s.then((un) => un()));
    };
  }, [launching]);

  // Once in, linger briefly so "Joined" registers, then get out of the way.
  useEffect(() => {
    if (step !== "ready") return;
    const timer = window.setTimeout(dismissLaunch, 2200);
    return () => window.clearTimeout(timer);
  }, [step, dismissLaunch]);

  useSuppressEmbed(!!launching);
  if (!launching) return null;
  const pct = install && install.total ? Math.round((install.done / install.total) * 100) : 0;
  const text =
    step === "updating" ? t("Updating Roblox · {pct}%", { pct }) : step === "starting" ? t("Starting Roblox…") : step === "joining" ? t("Joining server…") : t("Joined");

  return (
    <div className="modal-scrim launch-scrim">
      <div className="launch-card3" role="dialog" aria-label={t("Joining {name}", { name: launching.name })}>
        <div className="launch3-icon">{icon.data ? <img src={icon.data} alt="" draggable={false} /> : <span className="skel" />}</div>
        <div className="launch3-text">
          <div className="launch3-name ellipsis">{launching.name}</div>
          <div className="launch3-status">
            {step === "ready" ? <Icon name="check" size={14} /> : null}
            {text}
          </div>
        </div>
        <div className="launch3-bar">
          <span className={step === "updating" ? "" : step === "ready" ? "full" : "indeterminate"} style={step === "updating" ? { width: `${pct}%` } : undefined} />
        </div>
        <button className="btn btn-secondary launch3-btn" onClick={dismissLaunch}>
          {step === "ready" ? t("Close") : t("Hide")}
        </button>
      </div>
    </div>
  );
}
