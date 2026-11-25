import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import { useThumb, type ThumbType } from "../lib/thumbs";
import { t, fmtNum } from "../lib/i18n";

/* Builder icons from public/icons, tinted with currentColor via CSS mask. */
export type IconName =
  | "house" | "magnifying-glass" | "bell" | "gear" | "robux" | "star" | "clock" | "two-people" | "person" | "person-plus"
  | "backpack" | "envelope" | "roblox-plus" | "circle-i" | "studio" | "three-bars-horizontal" | "thumb-up" | "thumb-down"
  | "chevron-small-left" | "chevron-small-right" | "arrow-large-left" | "x-small" | "check" | "play-small" | "heart"
  | "arrow-spin-clockwise" | "shirt" | "pants" | "dress" | "crown" | "two-folders" | "wallet" | "lock" | "pencil-square"
  | "plus-small" | "minus-small" | "arrow-small-down" | "trash-can" | "circle-person" | "two-arrows-left-right" | "chain-link"
  | "verified-check" | "person-standing" | "three-sliders-horizontal" | "squares-grid-qr" | "tag-sparkle" | "chat"
  | "arrow-curl-to-left" | "arrow-curl-to-right" | "person-play" | "triangle-exclamation" | "two-arrows-from-center"
  | "dots-horizontal" | "megaphone" | "paint-brush" | "compass" | "arrow-large-right" | "speaker" | "speaker-x";

const INLINE: Partial<Record<IconName, ReactNode>> = {
  speaker: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  ),
  "speaker-x": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
      <path d="m16 9 6 6M22 9l-6 6" />
    </svg>
  ),
  "dots-horizontal": (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18" cy="12" r="1.7" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z" />
      <path d="M8.5 9h7M8.5 12.5h4.5" />
    </svg>
  ),
};

/** Style for a range input so its track fills up to the current value. */
export const rangeFill = (value: number, min: number, max: number) => ({ "--pct": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` }) as CSSProperties;

export function Icon({ name, size = 20, className = "", style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  const inline = INLINE[name];
  if (inline) {
    return (
      <span className={`icon ${className}`} style={{ width: size, height: size, ...style }} aria-hidden>
        {inline}
      </span>
    );
  }
  const url = `url(${import.meta.env.BASE_URL}icons/${name}.svg)`;
  return (
    <span
      className={`icon icon-mask ${className}`}
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url, ...style }}
      aria-hidden
    />
  );
}

export function Thumb({ type, id, size, className = "", alt = "" }: { type: ThumbType; id?: number | null; size?: string; className?: string; alt?: string }) {
  const url = useThumb(type, id, size);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [url]);
  // Shimmer until the image has actually arrived, then fade it in.
  return (
    <div className={`thumb ${className} ${loaded ? "loaded" : "loading"}`}>
      {url ? <img src={url} alt={alt} draggable={false} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} /> : null}
    </div>
  );
}

export function Headshot({ userId, size = 40, presence, className = "" }: { userId: number; size?: number; presence?: number; className?: string }) {
  const url = useThumb("AvatarHeadShot", userId);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [url]);
  return (
    <div className={`headshot ${className} ${loaded ? "loaded" : "loading"}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" draggable={false} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} /> : null}
      {presence ? <span className={`presence-dot p${presence}`} /> : null}
    </div>
  );
}

export function Robux({ amount, size = 16 }: { amount?: number | null; size?: number }) {
  return (
    <span className="robux">
      <Icon name="robux" size={size} />
      {amount != null ? <span>{fmtNum(amount)}</span> : null}
    </span>
  );
}

export function Verified({ size = 14 }: { size?: number }) {
  return <img className="verified" src={`${import.meta.env.BASE_URL}icons/RobloxVerified.svg`} width={size} height={size} alt={t("Verified")} />;
}

export function Spinner({ size = 28 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Skel({ w = "100%", h = 14, r = 8, className = "" }: { w?: number | string; h?: number | string; r?: number | string; className?: string }) {
  return <span className={`skel ${className}`} style={{ width: w, height: h, borderRadius: r }} />;
}

/** Rows with an avatar circle + two text lines (chat list, people, notifications, members). */
export function SkeletonRows({ count = 8, avatar = 44 }: { count?: number; avatar?: number }) {
  return (
    <div className="skel-rows" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-row" style={{ animationDelay: `${i * 40}ms` }}>
          <Skel w={avatar} h={avatar} r="50%" />
          <div className="skel-lines">
            <Skel w={`${40 + ((i * 17) % 30)}%`} h={13} />
            <Skel w={`${60 + ((i * 23) % 30)}%`} h={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A grid of cards: square item cards (marketplace / inventory) or game tiles. */
export function SkeletonGrid({ count = 12, variant = "item" }: { count?: number; variant?: "item" | "tile" }) {
  return (
    <div className={variant === "item" ? "item-grid" : "skel-tile-grid"} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-card">
          <Skel h={0} r={10} className={variant === "item" ? "skel-square" : "skel-wide"} />
          <Skel w="80%" h={12} />
          {variant === "item" ? <Skel w="45%" h={10} /> : <Skel w="35%" h={10} />}
        </div>
      ))}
    </div>
  );
}

/** Chat bubbles, alternating sides. */
export function SkeletonMessages() {
  const rows = [false, false, true, false, true, true, false, true];
  return (
    <div className="skel-messages" aria-busy="true">
      {rows.map((mine, i) => (
        <div key={i} className={`skel-bubble-row ${mine ? "mine" : ""}`}>
          {!mine ? <Skel w={28} h={28} r="50%" /> : null}
          <Skel w={90 + ((i * 53) % 180)} h={36} r={18} />
        </div>
      ))}
    </div>
  );
}

/** Generic page: a header block, a line of text and a couple of shelves. */
export function SkeletonPage({ hero = 220 }: { hero?: number }) {
  return (
    <div className="page skel-page" aria-busy="true">
      <Skel h={hero} r={16} />
      <Skel w="35%" h={26} />
      <Skel w="60%" h={14} />
      <SkeletonGrid count={6} variant="tile" />
    </div>
  );
}

/**
 * Fill {placeholders} in an already-translated string with React nodes, e.g.
 * interp(t("Buy {item} for {price}?"), { item: <b>{name}</b>, price: <Robux amount={p} /> }).
 */
export function interp(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/g).map((seg, i) => {
    const m = /^\{(\w+)\}$/.exec(seg);
    return m && m[1] in parts ? <Fragment key={i}>{parts[m[1]]}</Fragment> : seg;
  });
}

export function Center({ children }: { children: ReactNode }) {
  return <div className="center-fill">{children}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="state">
      <Icon name="circle-i" size={28} />
      <p>{error instanceof Error ? error.message : t("Something went wrong.")}</p>
      {retry ? (
        <button className="btn btn-secondary" onClick={retry}>
          {t("Try again")}
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ icon = "circle-i", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="state">
      <Icon name={icon} size={28} />
      <p>{children}</p>
    </div>
  );
}

export function SectionHeader({ title, onMore }: { title: string; onMore?: () => void }) {
  return (
    <div className="section-header">
      {onMore ? (
        <button className="section-title link" onClick={onMore}>
          {title}
          <Icon name="chevron-small-right" size={22} />
        </button>
      ) : (
        <h2 className="section-title">{title}</h2>
      )}
    </div>
  );
}

export type SelectOption<T extends string> = { value: T; label: ReactNode; icon?: IconName; group?: string };

export function Select<T extends string>({
  value,
  options,
  onChange,
  className = "",
  placeholder,
  ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [hi, setHi] = useState(-1);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const place = () => btn.current && setRect(btn.current.getBoundingClientRect());
    place();
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const away = (e: Event) => {
      const tg = e.target as Node;
      if (!menu.current?.contains(tg) && !btn.current?.contains(tg)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", place);
    window.addEventListener("blur", () => setOpen(false));
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", place);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && hi >= 0) menu.current?.querySelectorAll<HTMLElement>(".sel-opt")[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (v: T) => {
    setOpen(false);
    if (v !== value) onChange(v);
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) return e.preventDefault(), setOpen(true);
    if (!open) return;
    if (e.key === "Escape") return e.preventDefault(), setOpen(false);
    if (e.key === "ArrowDown") return e.preventDefault(), setHi((h) => Math.min(options.length - 1, h + 1));
    if (e.key === "ArrowUp") return e.preventDefault(), setHi((h) => Math.max(0, h - 1));
    if (e.key === "Enter" && options[hi]) return e.preventDefault(), pick(options[hi].value);
  };

  // Open downward unless there's no room; cap the height to the space available.
  const below = rect ? window.innerHeight - rect.bottom - 12 : 0;
  const above = rect ? rect.top - 12 : 0;
  const up = rect ? below < 220 && above > below : false;
  const maxH = Math.min(420, up ? above : below);
  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`sel ${open ? "open" : ""} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className="sel-value ellipsis">
          {cur?.icon ? <Icon name={cur.icon} size={16} /> : null}
          {cur ? cur.label : <span className="muted">{placeholder ?? t("Select")}</span>}
        </span>
        <Icon name="chevron-small-right" size={16} className="sel-caret" />
      </button>
      {open && rect
        ? createPortal(
            <div
              ref={menu}
              className={`sel-menu ${up ? "up" : ""}`}
              role="listbox"
              style={{
                left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 200) - 8),
                minWidth: rect.width,
                maxHeight: maxH,
                ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
              }}
            >
              {options.map((o, i) => {
                const head = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <div key={o.value}>
                    {head ? <div className="sel-group">{head}</div> : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={o.value === value}
                      className={`sel-opt ${o.value === value ? "on" : ""} ${i === hi ? "hi" : ""}`}
                      onMouseEnter={() => setHi(i)}
                      onClick={() => pick(o.value)}
                    >
                      {o.icon ? <Icon name={o.icon} size={16} /> : null}
                      <span className="ellipsis">{o.label}</span>
                      {o.value === value ? <Icon name="check" size={16} className="sel-check" /> : null}
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
