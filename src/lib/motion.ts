import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export type Presence<T> = { item: T; key: string | number; phase: "enter" | "idle" | "exit" };

/**
 * Keeps items that just left the list around for `exitMs` (marked "exit") so they can animate
 * out, and marks new ones "enter" so they can pop in. Order follows the new list; leaving items
 * stay where they were.
 */
export function usePresence<T>(items: T[], keyOf: (t: T) => string | number, exitMs = 260): Presence<T>[] {
  const [, force] = useState(0);
  const prev = useRef<Presence<T>[]>([]);
  const seen = useRef(false);
  const timers = useRef(new Map<string | number, number>());

  const nextKeys = new Set(items.map(keyOf));
  const prevMap = new Map(prev.current.map((p) => [p.key, p]));
  const out: Presence<T>[] = items.map((item) => {
    const key = keyOf(item);
    const before = prevMap.get(key);
    // The first batch appears at once (no pop-in storm on page load).
    return { item, key, phase: !seen.current ? "idle" : before && before.phase !== "exit" ? "idle" : "enter" };
  });
  prev.current.forEach((p, i) => {
    if (nextKeys.has(p.key)) return;
    const leaving: Presence<T> = { ...p, phase: "exit" };
    out.splice(Math.min(i, out.length), 0, leaving);
    if (!timers.current.has(p.key)) {
      timers.current.set(
        p.key,
        window.setTimeout(() => {
          timers.current.delete(p.key);
          prev.current = prev.current.filter((x) => x.key !== p.key);
          force((n) => n + 1);
        }, exitMs),
      );
    }
  });
  if (items.length) seen.current = true;
  prev.current = out;
  return out;
}

/**
 * FLIP: when children (marked with `data-flip="<key>"`) change position between renders, slide
 * them from the old spot to the new one instead of jumping.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, dep: unknown, duration = 320) {
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = document.documentElement.classList.contains("reduce-motion");
    const next = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((child) => {
      const key = child.dataset.flip!;
      const r = child.getBoundingClientRect();
      next.set(key, r);
      const was = last.current.get(key);
      if (!was || reduce) return;
      const dx = was.left - r.left;
      const dy = was.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
        duration,
        easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
      });
    });
    last.current = next;
  }, [ref, dep, duration]);
}
