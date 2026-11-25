import { useEffect, useRef, useState } from "react";
import { useNav } from "../app/store";
import { t } from "../lib/i18n";

/**
 * The Roblox app's keyboard / controller mode. Esc turns it on (a white focus ring plus a hint
 * bar at the bottom); in the mode Esc goes Back, arrows / D-pad move between controls by
 * position, Enter / A activates, PgUp / PgDn scroll, "/" jumps to Search. Moving the mouse
 * hands control back to the pointer.
 */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Dir = "up" | "down" | "left" | "right";

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.opacity !== "0" && cs.pointerEvents !== "none";
}

/** A modal / popover wins focus scope; otherwise the whole app. */
function scope(): ParentNode {
  const overlays = document.querySelectorAll<HTMLElement>(".modal-scrim, .lightbox, .drawer.open, .notif-panel, .menu");
  return overlays.length ? overlays[overlays.length - 1] : document;
}

function candidates(): HTMLElement[] {
  return Array.from(scope().querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
}

/** Nearest control in a direction (centre-to-centre, penalising sideways drift). */
function neighbour(from: HTMLElement, dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const ahead = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    if (ahead <= 2) continue;
    const side = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    const score = ahead + side * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function scrollPage(by: number) {
  const el = document.querySelector<HTMLElement>(".content");
  el?.scrollBy({ top: by * (el.clientHeight * 0.8), behavior: "smooth" });
}

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

export function FocusMode() {
  const { back, canBack } = useNav();
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  onRef.current = on;
  const nav = useRef({ back, canBack });
  nav.current = { back, canBack };

  useEffect(() => {
    document.documentElement.classList.toggle("kbd-mode", on);
  }, [on]);

  useEffect(() => {
    const enter = () => {
      setOn(true);
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body || !visible(active)) candidates()[0]?.focus();
    };
    const move = (dir: Dir) => {
      const cur = document.activeElement as HTMLElement | null;
      const next = cur && cur !== document.body ? neighbour(cur, dir) : candidates()[0];
      if (next) {
        next.focus();
        next.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    const goBack = () => {
      if (scope() !== document) {
        // Let the open overlay handle its own Esc (menus/modals close themselves).
        document.activeElement instanceof HTMLElement && document.activeElement.blur();
        return;
      }
      if (nav.current.canBack) nav.current.back();
      else setOn(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !typing(e.target)) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
        return;
      }
      if (typing(e.target) && e.key !== "Escape") return;
      if (e.key === "Escape") {
        if (typing(e.target)) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (!onRef.current) enter();
        else goBack();
        return;
      }
      if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        scrollPage(e.key === "PageDown" ? 1 : -1);
        return;
      }
      if (!onRef.current) return;
      const dirs: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      if (dirs[e.key]) {
        e.preventDefault();
        move(dirs[e.key]);
      }
    };

    // Real mouse movement (not the synthetic events scrolling causes) returns to pointer mode.
    let last: { x: number; y: number } | null = null;
    const onMouse = (e: MouseEvent) => {
      if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 6 && onRef.current) setOn(false);
      last = { x: e.clientX, y: e.clientY };
    };

    // Controller: D-pad / left stick move, A clicks, B is Back, shoulders scroll.
    let raf = 0;
    const prev: Record<number, boolean> = {};
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find((p) => p);
      if (!pad) return;
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => {
        const now = pressed(i);
        const was = prev[i];
        prev[i] = now;
        return now && !was;
      };
      const stick = (axis: number, sign: number, id: number) => {
        const now = (pad.axes[axis] ?? 0) * sign > 0.6;
        const was = prev[id];
        prev[id] = now;
        return now && !was;
      };
      const act = (fn: () => void) => {
        if (!onRef.current) enter();
        fn();
      };
      if (edge(12) || stick(1, -1, 100)) act(() => move("up"));
      if (edge(13) || stick(1, 1, 101)) act(() => move("down"));
      if (edge(14) || stick(0, -1, 102)) act(() => move("left"));
      if (edge(15) || stick(0, 1, 103)) act(() => move("right"));
      if (edge(0)) act(() => (document.activeElement as HTMLElement | null)?.click());
      if (edge(1)) act(goBack);
      if (edge(4)) act(() => scrollPage(-1));
      if (edge(5)) act(() => scrollPage(1));
    };
    const startPad = () => {
      if (!raf) raf = requestAnimationFrame(poll);
    };
    if (navigator.getGamepads?.().some((p) => p)) startPad();

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("gamepadconnected", startPad);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("gamepadconnected", startPad);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (!on) return null;
  return (
    <div className="kbd-hints" aria-hidden>
      <span>
        <kbd>/</kbd> {t("Search")}
      </span>
      <span>
        <kbd>Esc</kbd> {t("Back")}
      </span>
      <span>
        <kbd>PgUp</kbd> {t("Scroll Up")}
      </span>
      <span>
        <kbd>PgDn</kbd> {t("Scroll Down")}
      </span>
    </div>
  );
}
