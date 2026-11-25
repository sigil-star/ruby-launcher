import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
import { t } from "../lib/i18n";

type Box = { top: number; height: number; left: number; right: number; canL: boolean; canR: boolean };

/**
 * Hover arrows for every horizontal row in the app (anything with `.hscroll`): friends,
 * recently played, avatar picks, badges, chips… Rendered once, in a fixed layer over whichever
 * row the pointer is on, so the rows themselves don't change.
 */
export function RowArrows() {
  const row = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const overArrow = useRef(false);

  useEffect(() => {
    const measure = () => {
      const el = row.current;
      if (!el || !el.isConnected) return setBox(null);
      const max = el.scrollWidth - el.clientWidth;
      if (max < 4) return setBox(null);
      const r = el.getBoundingClientRect();
      const next = { top: r.top, height: r.height, left: r.left, right: r.right, canL: el.scrollLeft > 2, canR: el.scrollLeft < max - 2 };
      setBox((b) => (b && b.top === next.top && b.height === next.height && b.left === next.left && b.right === next.right && b.canL === next.canL && b.canR === next.canR ? b : next));
    };
    const onScroll = () => measure();
    // Rows fill in after their data loads (and resize with the window): re-measure then too.
    const ro = new ResizeObserver(() => measure());
    const attach = (el: HTMLElement | null) => {
      if (row.current === el) return;
      row.current?.removeEventListener("scroll", onScroll);
      if (row.current) ro.unobserve(row.current);
      row.current = el;
      if (el) {
        el.addEventListener("scroll", onScroll, { passive: true });
        ro.observe(el);
      }
      measure();
    };
    const mouse = { x: -1, y: -1 };
    const rowAt = (x: number, y: number) => {
      for (const el of document.elementsFromPoint(x, y) as HTMLElement[]) {
        if (el.closest?.(".row-arrow")) continue;
        return (el.closest?.(".hscroll") as HTMLElement | null) ?? null;
      }
      return null;
    };
    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (overArrow.current || (e.target as HTMLElement | null)?.closest?.(".row-arrow")) return;
      attach((e.target as HTMLElement | null)?.closest?.(".hscroll") as HTMLElement | null);
    };
    const onLeaveWindow = () => !overArrow.current && attach(null);
    // Page scroll moves the row under a fixed layer: follow it.
    // Scrolling the page with the wheel slides a different row under a still pointer, which
    // fires no mouseover: look up what's under the pointer now.
    const onAnyScroll = () => {
      if (mouse.x < 0) return measure();
      overArrow.current = !!(document.elementFromPoint(mouse.x, mouse.y) as HTMLElement | null)?.closest?.(".row-arrow");
      attach(rowAt(mouse.x, mouse.y));
    };
    // Follow the row every frame while one is active: smooth scrolling moves the page between
    // scroll events, and a fixed arrow would drift off the row. Also drop the arrows the moment
    // the pointer is no longer over that row (or its arrows).
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!row.current) return;
      if (mouse.x >= 0) {
        const under = document.elementFromPoint(mouse.x, mouse.y) as HTMLElement | null;
        const onArrow = !!under?.closest?.(".row-arrow");
        overArrow.current = onArrow;
        if (!onArrow && rowAt(mouse.x, mouse.y) !== row.current) return attach(rowAt(mouse.x, mouse.y));
      }
      measure();
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseleave", onLeaveWindow);
    window.addEventListener("scroll", onAnyScroll, true);
    window.addEventListener("resize", onAnyScroll);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMove, true);
      ro.disconnect();
      document.removeEventListener("mouseleave", onLeaveWindow);
      window.removeEventListener("scroll", onAnyScroll, true);
      window.removeEventListener("resize", onAnyScroll);
      row.current?.removeEventListener("scroll", onScroll);
    };
  }, []);

  const anim = useRef(0);
  const page = (dir: -1 | 1) => {
    const el = row.current;
    if (!el) return;
    cancelAnimationFrame(anim.current);
    const from = el.scrollLeft;
    const max = el.scrollWidth - el.clientWidth;
    const to = Math.max(0, Math.min(max, from + dir * Math.max(200, el.clientWidth * 0.8)));
    if (to === from) return;
    if (document.documentElement.classList.contains("reduce-motion")) {
      el.scrollLeft = to;
      return;
    }
    // Scroll snapping would fight the animation: pause it while we move.
    const snap = el.style.scrollSnapType;
    el.style.scrollSnapType = "none";
    const start = performance.now();
    const dur = 420;
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      el.scrollLeft = from + (to - from) * ease(k);
      if (k < 1) anim.current = requestAnimationFrame(step);
      else el.style.scrollSnapType = snap;
    };
    anim.current = requestAnimationFrame(step);
  };

  if (!box) return null;
  const size = 28;
  // Centre on the part of the row that's actually on screen.
  const visTop = Math.max(box.top, 0);
  const visBottom = Math.min(box.top + box.height, window.innerHeight);
  if (visBottom - visTop < size) return null;
  const top = (visTop + visBottom) / 2 - size / 2;
  const arrow = (dir: -1 | 1, show: boolean) =>
    show ? (
      <button
        className="row-arrow"
        style={{ top, left: dir < 0 ? box.left + 6 : box.right - size - 6, width: size, height: size }}
        aria-label={dir < 0 ? t("Scroll left") : t("Scroll right")}
        onMouseEnter={() => (overArrow.current = true)}
        onMouseLeave={() => (overArrow.current = false)}
        onClick={() => page(dir)}
      >
        <Icon name={dir < 0 ? "chevron-small-left" : "chevron-small-right"} size={24} />
      </button>
    ) : null;
  return (
    <>
      {arrow(-1, box.canL)}
      {arrow(1, box.canR)}
    </>
  );
}
