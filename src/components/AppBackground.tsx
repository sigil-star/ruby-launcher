import { useEffect, useState } from "react";
import { BACKGROUNDS, customBackgroundVersion, loadCustomBackground, pref } from "../lib/appearance";

type Shown = { kind: "img" | "video"; src: string } | null;

/** First frame of an image (a GIF stops on frame one), for "Animate background" off. */
async function firstFrame(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return await new Promise((resolve) => c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ""), "image/webp", 0.9));
}

/** The picture or video behind the whole launcher (Customize → Ruby look → Background). */
export function AppBackground() {
  const [, setTick] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);
  const [shown, setShown] = useState<Shown>(null);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const vis = () => setHidden(document.hidden);
    window.addEventListener("ruby:prefs", bump);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("ruby:prefs", bump);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const id = pref("bg");
  const version = customBackgroundVersion();
  // Still frame when animation is off, motion is reduced, or Ruby is minimized/in the tray.
  const still = pref("bgAnimate") !== "1" || pref("reduceMotion") === "1" || hidden;

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      if (id !== "custom") return setShown(null);
      const builtIn = BACKGROUNDS.find((b) => b.id === id);
      if (builtIn) return setShown({ kind: "img", src: still ? builtIn.still : builtIn.src });
      const blob = await loadCustomBackground();
      if (cancelled) return;
      if (!blob) return setShown(null);
      if (blob.type.startsWith("video/")) {
        const u = URL.createObjectURL(blob);
        urls.push(u);
        return setShown({ kind: "video", src: u });
      }
      const u = blob.type === "image/gif" && still ? await firstFrame(blob).catch(() => URL.createObjectURL(blob)) : URL.createObjectURL(blob);
      urls.push(u);
      if (!cancelled) setShown({ kind: "img", src: u });
    })();
    return () => {
      cancelled = true;
      // Let the next picture paint before the old one is released.
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
    };
  }, [id, still, version]);

  if (!shown) return null;
  return (
    <div className="app-bg" aria-hidden>
      {shown.kind === "video" ? (
        <video
          key={shown.src}
          src={shown.src}
          muted
          loop
          playsInline
          autoPlay={!still}
          ref={(v) => {
            if (!v) return;
            if (still) v.pause();
            else void v.play().catch(() => {});
          }}
        />
      ) : (
        <img key={shown.src} src={shown.src} alt="" draggable={false} />
      )}
    </div>
  );
}
