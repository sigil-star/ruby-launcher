/**
 * App-wide smooth wheel scrolling: each wheel notch eases the nearest vertical scroller toward
 * its target instead of jumping. Anything that handles the wheel itself (3D views zooming,
 * inputs, horizontal rows, elements marked `data-native-scroll`) keeps native behaviour, and
 * reduced-motion users get normal scrolling.
 */
type Anim = { target: number; raf: number };
const anims = new WeakMap<HTMLElement, Anim>();

function scrollerFor(start: Element | null): HTMLElement | null {
  for (let el = start as HTMLElement | null; el && el !== document.documentElement; el = el.parentElement) {
    if (el.dataset?.nativeScroll !== undefined) return null;
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
  }
  const root = document.scrollingElement as HTMLElement | null;
  return root && root.scrollHeight > root.clientHeight + 1 ? root : null;
}

function step(el: HTMLElement) {
  const a = anims.get(el);
  if (!a) return;
  const cur = el.scrollTop;
  const diff = a.target - cur;
  if (Math.abs(diff) < 0.5) {
    el.scrollTop = a.target;
    anims.delete(el);
    return;
  }
  el.scrollTop = cur + diff * 0.18;
  // If the browser couldn't move (hit an edge), stop.
  if (Math.abs(el.scrollTop - cur) < 0.1) {
    anims.delete(el);
    return;
  }
  a.raf = requestAnimationFrame(() => step(el));
}

export function installSmoothScroll() {
  // On even when Windows animations are off: smooth scrolling is a core part of how Ruby feels.
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.shiftKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const t = e.target as Element | null;
      if (!t || t.closest("canvas, input, textarea, select, [contenteditable], [data-native-scroll]")) return;
      const el = scrollerFor(t);
      if (!el) return;
      const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      // Let the page above take over once this scroller is at its edge (nested scrolling).
      const max = el.scrollHeight - el.clientHeight;
      const a = anims.get(el);
      const base = a ? a.target : el.scrollTop;
      const target = Math.max(0, Math.min(max, base + px));
      if (target === base && (base <= 0 || base >= max)) return;
      e.preventDefault();
      if (a) a.target = target;
      else {
        const anim = { target, raf: 0 };
        anims.set(el, anim);
        anim.raf = requestAnimationFrame(() => step(el));
      }
    },
    { passive: false },
  );
}
