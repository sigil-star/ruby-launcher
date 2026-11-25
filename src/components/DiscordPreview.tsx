import { useState } from "react";
import { t } from "../lib/i18n";

type Prefs = { enabled: boolean; showGame: boolean; showCover: boolean; showCreator: boolean; showElapsed: boolean; joinButton: boolean; profileButton: boolean; downloadButton?: boolean; showBrowsing: boolean };

const logo = `${import.meta.env.BASE_URL}RubyLauncher.png`;

/** What your Discord profile will show, drawn from your settings (an example game while not playing). */
export function DiscordPreview({ p }: { p: Prefs }) {
  const [mode, setMode] = useState<"game" | "ruby">("game");
  const game = mode === "game";
  const lines: string[] = game
    ? [p.showGame ? "Murder Mystery 2" : "Roblox", ...(p.showGame && p.showCreator ? [t("by {creator}", { creator: "Nikilis" })] : []), t("via Ruby Launcher")]
    : ["Ruby", ...(p.showBrowsing ? [t("In settings")] : []), t("In Ruby Launcher")];
  const dl = p.downloadButton !== false ? [t("Download Ruby Launcher")] : [];
  const buttons = (game ? [...(p.showGame && p.joinButton ? [t("Join")] : []), ...(p.profileButton ? [t("View Profile")] : []), ...dl] : [...(p.profileButton ? [t("View Profile")] : []), ...dl]).slice(0, 2);
  const cover = game && p.showGame && p.showCover;
  const W = 340;
  const top = 40;
  const art = 84;
  const textH = lines.length * 20 + (p.showElapsed ? 20 : 0);
  const body = Math.max(art, textH);
  const H = top + body + 16 + buttons.length * 40 + (buttons.length ? 4 : 0);

  return (
    <div className="dc-preview">
      <div className="dc-preview-head">
        <span className="muted small">{t("Preview")}</span>
        <div className="segmented small">
          <button className={game ? "active" : ""} onClick={() => setMode("game")}>
            {t("In a game")}
          </button>
          <button className={!game ? "active" : ""} onClick={() => setMode("ruby")}>
            {t("In Ruby")}
          </button>
        </div>
      </div>
      {!p.enabled ? (
        <div className="dc-off muted small">{t("Nothing from Ruby shows on your Discord profile.")}</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="dc-card" role="img" aria-label={t("Discord status preview")}>
          <defs>
            <clipPath id="dc-art">
              <rect x="14" y={top} width={art} height={art} rx="10" />
            </clipPath>
            <linearGradient id="dc-cover" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2b1d4a" />
              <stop offset="1" stopColor="#0d0d12" />
            </linearGradient>
          </defs>
          <rect width={W} height={H} rx="12" fill="#232428" />
          <text x="14" y="25" fill="#dbdee1" fontSize="12" fontWeight="700">
            {t("Playing")}
          </text>
          <text x={W - 18} y="25" fill="#949ba4" fontSize="14" textAnchor="end">
            ···
          </text>
          {cover ? (
            <g clipPath="url(#dc-art)">
              <rect x="14" y={top} width={art} height={art} fill="url(#dc-cover)" />
              <text x={14 + art / 2} y={top + art / 2 + 12} fill="#e0b0ff" fontSize="34" fontWeight="800" textAnchor="middle">
                MM2
              </text>
            </g>
          ) : (
            <image href={logo} x="14" y={top} width={art} height={art} clipPath="url(#dc-art)" preserveAspectRatio="xMidYMid slice" />
          )}
          {lines.map((l, i) => (
            <text key={i} x={14 + art + 14} y={top + 16 + i * 20} fill={i === 0 ? "#f2f3f5" : "#b5bac1"} fontSize={i === 0 ? 15 : 13} fontWeight={i === 0 ? 700 : 400}>
              {l}
            </text>
          ))}
          {p.showElapsed ? (
            <text x={14 + art + 14} y={top + 16 + lines.length * 20} fill="#3ba55d" fontSize="13" fontWeight="600" fontFamily="Consolas, monospace">
              🎮 {game ? "15:40" : "0:24"}
            </text>
          ) : null}
          {buttons.map((b, i) => {
            const y = top + body + 14 + i * 40;
            return (
              <g key={b}>
                <rect x="14" y={y} width={W - 28} height="32" rx="8" fill="#393a41" />
                <text x={W / 2} y={y + 21} fill="#f2f3f5" fontSize="13" fontWeight="600" textAnchor="middle">
                  {b}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
