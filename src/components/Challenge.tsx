import { useEffect, useRef, useState } from "react";
import { call, on, setChallengeHandler, type Challenge, type ChallengeAnswer } from "../lib/ipc";
import { Icon, Spinner } from "./ui";
import { t } from "../lib/i18n";

/*
 * Roblox's verification challenges, solved by the user inside Ruby: the signed-in embed loads a
 * roblox.com page and runs Roblox's own challenge component (AccountIntegrityChallengeService),
 * which reports the answer back through a marker URL that Ruby's embed intercepts.
 */

const script = (c: Challenge) => `(function(){
  if (window.__rubyChallenge === ${JSON.stringify(c.id)}) return;
  window.__rubyChallenge = ${JSON.stringify(c.id)};
  var done = function (o) { location.href = "https://www.roblox.com/ruby-challenge-done#" + encodeURIComponent(JSON.stringify(o)); };
  var st = document.createElement("style");
  st.textContent = "#header, .rbx-header, #navigation-container, #left-navigation-container, #container-main, .content, #footer-container, footer, #chat-container, .chat-container, .notification-stream-container, #rbx-body > .alert-container { display: none !important; } html, body { background: #111216 !important; overflow: auto !important; } #ruby-challenge { min-height: 100vh; display: grid; place-items: center; }";
  document.documentElement.appendChild(st);
  var box = document.createElement("div"); box.id = "ruby-challenge"; document.body.appendChild(box);
  var tries = 0;
  var t = setInterval(function () {
    var G = window.Roblox && window.Roblox.AccountIntegrityChallengeService && window.Roblox.AccountIntegrityChallengeService.Generic;
    if (!G) { if (++tries > 75) { clearInterval(t); done({ error: "Roblox's verification didn't load." }); } return; }
    clearInterval(t);
    G.interceptChallenge({
      retryRequest: function (challengeId, metadataBase64) { done({ challengeId: challengeId, metadataBase64: metadataBase64 }); return new Promise(function () {}); },
      containerId: "ruby-challenge",
      challengeId: ${JSON.stringify(c.id)},
      challengeTypeRaw: ${JSON.stringify(c.type)},
      challengeMetadataJsonBase64: ${JSON.stringify(c.metadata)}
    }).catch(function (e) { done({ error: String((e && (e.kind || e.message)) || e) }); });
  }, 200);
})();`;

export function ChallengeHost() {
  const [cur, setCur] = useState<{ c: Challenge; resolve: (a: ChallengeAnswer | null) => void } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChallengeHandler((c) => new Promise((resolve) => setCur({ c, resolve })));
    return () => setChallengeHandler(null);
  }, []);

  // Place the embed over the box and run Roblox's challenge in it.
  useEffect(() => {
    if (!cur) return;
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void call("embedScript", script(cur.c));
    void call("showEmbed", "https://www.roblox.com/home?ruby-verify=1", Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height));
    const sub = on<string>("roblox-challenge-done", (frag) => {
      let o: { challengeId?: string; metadataBase64?: string; error?: string } = {};
      try {
        o = JSON.parse(decodeURIComponent(frag));
      } catch {
        /* treated as cancelled */
      }
      finish(o.challengeId && o.metadataBase64 != null ? { challengeId: o.challengeId, metadataBase64: o.metadataBase64 } : null);
    });
    return () => void sub.then((u) => u());
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (a: ChallengeAnswer | null) => {
    void call("embedScript", "");
    void call("closeEmbed");
    setCur((c) => (c?.resolve(a), null));
  };

  if (!cur) return null;
  return (
    <div className="modal-scrim challenge-scrim">
      <div className="challenge-card">
        <div className="challenge-head">
          <b>{t("Quick verification")}</b>
          <span className="muted small">{t("Roblox wants to check it's really you before doing that.")}</span>
          <button className="icon-btn" onClick={() => finish(null)} aria-label={t("Cancel")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <div className="challenge-box" ref={box}>
          <Spinner size={22} />
        </div>
      </div>
    </div>
  );
}
