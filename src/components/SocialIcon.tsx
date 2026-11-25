/**
 * Real platform logos for social links (Simple Icons marks in public/icons/brands), drawn in
 * the current text colour like the Roblox app's round social buttons.
 */
const FILES: Record<string, string> = {
  discord: "discord",
  twitter: "x",
  x: "x",
  youtube: "youtube",
  twitch: "twitch",
  facebook: "facebook",
  guilded: "guilded",
  robloxgroup: "roblox",
  roblox: "roblox",
};

function fileFor(type: string): string | null {
  const t = type.toLowerCase().replace(/[^a-z]/g, "");
  if (FILES[t]) return FILES[t];
  const hit = Object.keys(FILES).find((k) => t.includes(k));
  return hit ? FILES[hit] : null;
}

export function SocialIcon({ type, size = 22 }: { type: string; size?: number }) {
  const f = fileFor(type);
  if (!f) return <span style={{ fontWeight: 700 }}>{type.slice(0, 1).toUpperCase()}</span>;
  const url = `url("/icons/brands/${f}.svg")`;
  return (
    <span
      role="img"
      aria-label={type}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        background: "currentColor",
        WebkitMask: `${url} center / contain no-repeat`,
        mask: `${url} center / contain no-repeat`,
      }}
    />
  );
}
