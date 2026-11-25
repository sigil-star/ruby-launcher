import { askConfirm } from "../components/Confirm";
import { AccountTypeCard } from "../components/AccountGate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountModeration, timeLeft, voiceStatus } from "../lib/moderation";
import { useEffect, useRef, useState } from "react";
import { currentRecentId, recentBackgrounds, removeRecentBackground, setBackgroundFile, applyRecentBackground } from "../lib/appearance";
import { ACCENTS, BACKGROUND_TYPES, CORNERS, FONTS, clearCustomBackground, loadCustomBackground, pref, resetAppearance, setPref, type PrefKey } from "../lib/appearance";
import { launcher, session } from "../lib/api";
import { call, win } from "../lib/ipc";
import { useMe, useNav, useUi } from "../app/store";
import { Select, Headshot, Icon, rangeFill, Skel } from "../components/ui";
import { WebEmbed } from "../components/WebEmbed";
import { DiscordPreview } from "../components/DiscordPreview";
import { CreditLine, setBackgroundCredit, WallpaperSearch } from "../components/WallpaperSearch";
import { useInstallUpdate, useUpdate } from "../components/UpdateBanner";
import { roundUpOffered, setRoundUpOffered } from "../lib/support";
import { LANGUAGES, fmtDate, setLang, t, useLang, type LangCode } from "../lib/i18n";

type Section = "info" | "security" | "privacy" | "notifications" | "spending" | "robux" | "subscriptions" | "parental" | "apps";

/** Main Settings list, grouped, → which inner section each row opens. */
const MAIN: { label: () => string; section: Section | "ruby" }[][] = [
  [
    { label: () => t("Account Info"), section: "info" },
    { label: () => t("Security"), section: "security" },
    { label: () => t("Privacy & content restrictions"), section: "privacy" },
    { label: () => t("Parental Controls"), section: "parental" },
  ],
  [
    { label: () => t("Payment Methods"), section: "spending" },
    { label: () => t("Subscriptions"), section: "subscriptions" },
    { label: () => t("Robux"), section: "robux" },
  ],
  [{ label: () => t("Notifications"), section: "notifications" }],
  [{ label: () => t("Account standing"), section: "ruby" }],
];

/** The inner left menu of the app's account settings sheet. */
const INNER: { id: Section; label: () => string; web: string }[] = [
  { id: "info", label: () => t("Account info"), web: "https://www.roblox.com/my/account#!/info" },
  { id: "security", label: () => t("Security"), web: "https://www.roblox.com/my/account#!/security" },
  { id: "privacy", label: () => t("Privacy & content restrictions"), web: "https://www.roblox.com/my/account#!/privacy" },
  { id: "notifications", label: () => t("Notifications"), web: "https://www.roblox.com/my/account#!/notifications" },
  { id: "spending", label: () => t("Spending"), web: "https://www.roblox.com/my/account#!/billing" },
  { id: "robux", label: () => t("Robux"), web: "https://www.roblox.com/transactions" },
  { id: "subscriptions", label: () => t("Subscriptions"), web: "https://www.roblox.com/my/account#!/subscriptions" },
  { id: "parental", label: () => t("Parental controls"), web: "https://www.roblox.com/my/account#!/parental-controls" },
  { id: "apps", label: () => t("App permissions"), web: "https://www.roblox.com/my/account#!/app-permissions" },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

/** Bans, warnings and voice chat suspensions, straight from Roblox. */
function AccountStanding() {
  const acct = useQuery({ queryKey: ["accountModeration"], queryFn: accountModeration, staleTime: 60_000 });
  const voice = useQuery({ queryKey: ["voiceStatus"], queryFn: voiceStatus, staleTime: 60_000 });
  const v = voice.data;
  const a = acct.data;
  return (
    <>
      <h3 className="acct-h3">{t("Account standing")}</h3>
      <div className="discord-prefs">
        <div className="dp-row">
          <div>
            <b>{t("Account")}</b>
            <div className="muted small">
              {acct.isLoading ? t("Checking…") : acct.error ? t("Couldn't check.") : a ? `${a.kind === "warning" ? t("Warning") : a.label}${a.end && a.kind === "ban" && Date.parse(a.end) > Date.now() ? ` · ${t("ends in {time}", { time: timeLeft(a.end) })}` : ""}` : t("Good standing. No bans or warnings.")}
            </div>
          </div>
        </div>
        <div className="dp-row">
          <div>
            <b>{t("Voice chat")}</b>
            <div className="muted small">
              {voice.isLoading
                ? t("Checking…")
                : voice.error || !v
                  ? t("Couldn't check.")
                  : v.banned
                    ? v.bannedUntil ? t("Suspended for {time} (until {date})", { time: timeLeft(v.bannedUntil), date: fmtDate(v.bannedUntil, { dateStyle: "medium", timeStyle: "short" }) }) : t("Suspended")
                    : v.enabled
                      ? t("On")
                      : v.eligible
                        ? t("Off. Turn it on in Roblox's privacy settings.")
                        : t("Not available for this account yet (needs age verification).")}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

type DiscordPrefs = {
  enabled: boolean;
  showGame: boolean;
  showCover: boolean;
  showCreator: boolean;
  showElapsed: boolean;
  joinButton: boolean;
  profileButton: boolean;
  downloadButton: boolean;
  showBrowsing: boolean;
};

const DISCORD_ROWS: { key: keyof DiscordPrefs; label: () => string; help: () => string; needsGame?: boolean }[] = [
  { key: "showGame", label: () => t("Show which game I'm playing"), help: () => t("Off: Discord just says you're playing Roblox.") },
  { key: "showCover", label: () => t("Game cover art"), help: () => t("The game's icon as the big picture."), needsGame: true },
  { key: "showCreator", label: () => t("Game creator"), help: () => t("Shows \"by <creator>\" under the game name."), needsGame: true },
  { key: "showElapsed", label: () => t("Time played"), help: () => t("How long you've been in the game.") },
  { key: "joinButton", label: () => t("Join button"), help: () => t("Lets anyone who sees your profile join your exact server."), needsGame: true },
  { key: "profileButton", label: () => t("View Profile button"), help: () => t("Links to your Roblox profile.") },
  { key: "downloadButton", label: () => t("Download Ruby Launcher button"), help: () => t("Lets friends get Ruby. Discord shows at most two buttons, so it's hidden when Join and View Profile are both on.") },
  { key: "showBrowsing", label: () => t("What I'm doing in Ruby"), help: () => t("e.g. \"Viewing Epic Minigames\" when you're not in a game.") },
];

/** Ruby's Discord status (Rich Presence): what others can see, all local to Ruby. */
export function DiscordStatus() {
  const q = useQuery({ queryKey: ["discordPrefs"], queryFn: () => call<DiscordPrefs>("getDiscordPrefs") });
  const qc = useQueryClient();
  const p = q.data;
  const save = (patch: Partial<DiscordPrefs>) => {
    if (!p) return;
    const next = { ...p, ...patch };
    qc.setQueryData(["discordPrefs"], next);
    call("setDiscordPrefs", next).catch(() => q.refetch());
  };
  return (
    <>
      <h3 className="acct-h3">{t("Discord status")}</h3>
      <p className="muted small">{t("What your Discord profile shows while you use Ruby. Changes apply within a couple of seconds.")}</p>
      {!p ? (
        <Skel h={120} r={10} />
      ) : (
        <div className="discord-prefs">
          <DiscordPreview p={p} />
          <div className="dp-row main">
            <div>
              <b>{t("Show my activity on Discord")}</b>
              <div className="muted small">{t("Turn this off to hide Ruby from Discord entirely.")}</div>
            </div>
            <Toggle checked={p.enabled} onChange={(v) => save({ enabled: v })} />
          </div>
          {DISCORD_ROWS.map((r) => {
            const off = !p.enabled || (r.needsGame && !p.showGame);
            return (
              <div key={r.key} className={`dp-row ${off ? "off" : ""}`}>
                <div>
                  <b>{r.label()}</b>
                  <div className="muted small">{r.help()}</div>
                </div>
                <Toggle checked={p[r.key]} onChange={(v) => save({ [r.key]: v })} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function AccountSheet({ start, onBack }: { start: Section; onBack: () => void }) {
  const me = useMe();
  const sec = start;
  const cur = INNER.find((s) => s.id === sec)!;
  return (
    <div className="sheet">
      <div className="sheet-head">
        <button className="icon-btn" onClick={onBack} aria-label={t("Back")}>
          <Icon name="arrow-large-left" size={22} />
        </button>
        <div className="sheet-title">
          <span className="muted small">{t("{name}'s", { name: me.name })}</span>
          <b>{cur.label()}</b>
        </div>
      </div>
      {/* Roblox's own settings page, signed in and restyled to match Ruby. Changes that need
          Roblox's confirmation steps (age checks, parental consent) work here as on roblox.com. */}
      <div className="acct-embed">
        <WebEmbed key={cur.web} url={cur.web} title={cur.label()} />
      </div>
    </div>
  );
}

/** Account standing and account type (Roblox account things, so they live in Account Settings). */
function RubyPrefs({ onBack }: { onBack: () => void }) {
  return (
    <div className="page settings-page">
      <div className="settings-head">
        <button className="icon-btn" onClick={onBack} aria-label={t("Back")}>
          <Icon name="arrow-large-left" size={22} />
        </button>
        <h1 className="settings-title">{t("Account standing")}</h1>
      </div>
      <div className="device-prefs">
        <AccountStanding />
        <AccountTypeCard />
      </div>
    </div>
  );
}

export function Updates() {
  const update = useUpdate();
  const { install, pct, error, busy } = useInstallUpdate();
  const d = update.data;
  const status = busy
    ? t("Downloading Ruby {version}… {pct}%", { version: d?.latest, pct })
    : error || (d?.newer ? t("Ruby {latest} is out ({size} MB). You have {current}.", { latest: d.latest, size: d.sizeMb, current: d.current }) : d?.error ? t("Couldn't check: {error}", { error: d.error }) : d ? t("You have the newest Ruby ({current}).", { current: d.current }) : t("Checking…"));
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{t("Updates")}</div>
        <div className="muted small">{status} {t("Updates come from dsk.wtf and are checked against Ruby's signature before they install.")}</div>
      </div>
      {d?.newer ? (
        <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void install()}>
          {busy ? `${pct}%` : t("Update now")}
        </button>
      ) : (
        <button className="btn btn-secondary btn-small" disabled={update.isFetching} onClick={() => void update.refetch()}>
          {t("Check now")}
        </button>
      )}
    </div>
  );
}

export function RoundUpPref() {
  const [on, setOn] = useState(roundUpOffered);
  return (
    <label className="setting-row">
      <div>
        <div className="setting-label">{t("Offer to round up purchases")}</div>
        <div className="muted small">{t("When you buy something, Ruby asks if you'd like to round the price up to the next 10 Robux to support Ruby. It's never on unless you tick it for that purchase.")}</div>
      </div>
      <Toggle
        checked={on}
        onChange={(v) => {
          setRoundUpOffered(v);
          setOn(v);
        }}
      />
    </label>
  );
}

/** Credits and the license texts for what ships with Ruby (the fonts' licenses require this). */
export function Licenses() {
  const [text, setText] = useState<string | null>(null);
  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-label">{t("Credits and licenses")}</div>
          <div className="muted small">{t("The fonts, cursors and code Ruby is built with, and the licenses they come under.")}</div>
        </div>
        <button
          className="btn btn-secondary btn-small"
          onClick={() =>
            text !== null
              ? setText(null)
              : void fetch(`${import.meta.env.BASE_URL}licenses/fonts.txt`)
                  .then((r) => r.text())
                  .then(setText)
                  .catch(() => setText(t("Couldn't open the license file.")))
          }
        >
          {text !== null ? t("Hide") : t("Show")}
        </button>
      </div>
      {text !== null ? (
        <div className="license-box">
          <p className="muted small">
            {t("Full credits:")} <button className="link" onClick={() => void win.openExternal("https://dsk.wtf/ruby/credits")}>dsk.wtf/ruby/credits</button>
          </p>
          <pre>{text}</pre>
        </div>
      ) : null}
    </>
  );
}

export { applyDisplayPrefs } from "../lib/appearance";

function RangePref({ k, min, max, step, low, high }: { k: PrefKey; min: number; max: number; step: number; low: string; high: string }) {
  return (
    <div className="slider-wrap">
      <input type="range" min={min} max={max} step={step} value={Number(pref(k))} style={rangeFill(Number(pref(k)), min, max)} onChange={(e) => setPref(k, e.target.value)} />
      <div className="slider-labels muted small">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

/** Ruby's settings. "look" is the theme, background and fonts (shown in Customize); "general" is behaviour and accessibility. */
export function RubyPrefsSections({ part }: { part: "look" | "general" }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const settings = useQuery({ queryKey: ["launcherSettings"], queryFn: launcher.settings });
  const install = useQuery({ queryKey: ["install"], queryFn: launcher.install });
  // Re-read prefs whenever one changes (here or anywhere else in the app).
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("ruby:prefs", bump);
    return () => window.removeEventListener("ruby:prefs", bump);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, setHasCustom] = useState(false);
  useEffect(() => {
    void loadCustomBackground().then((b) => setHasCustom(!!b));
  }, []);

  const set = async (key: string, value: boolean) => {
    await launcher.setSetting(key, value);
    qc.invalidateQueries({ queryKey: ["launcherSettings"] });
  };
  const bg = pref("bg");
  const accent = pref("accent");
  const lang = useLang();
  const recents = recentBackgrounds();
  const current = currentRecentId();
  const pickFile = async (file?: File) => {
    if (!file) return;
    try {
      setBackgroundCredit(null);
      await setBackgroundFile(file);
      setHasCustom(true);
      toast(t("Background set."));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
      <div className="device-prefs">
        {part === "look" ? (
        <>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Mode")}</div>
            <div className="muted small">{t("Only changes Ruby on this PC. Match Windows follows your Windows light or dark setting.")}</div>
          </div>
          <Select
            value={pref("mode")}
            onChange={(v) => setPref("mode", v)}
            options={[
              { value: "dark", label: t("Dark") },
              { value: "black", label: t("Matte black") },
              { value: "light", label: t("Light") },
              { value: "system", label: t("Match Windows") },
            ]}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Accent color")}</div>
            <div className="muted small">{t("Buttons, highlights and selected tabs. The last one is any color you like.")}</div>
          </div>
          <div className="accent-swatches" role="radiogroup" aria-label={t("Accent color")}>
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={accent === a.id}
                className={`accent-swatch ${accent === a.id ? "on" : ""}`}
                style={{ background: a.color }}
                title={a.name}
                aria-label={a.name}
                onClick={() => setPref("accent", a.id)}
              />
            ))}
            <label className={`accent-swatch accent-custom-swatch ${accent === "custom" ? "on" : ""}`} title={t("Pick any color")}>
              <input
                type="color"
                aria-label={t("Custom accent color")}
                value={pref("accentCustom")}
                onChange={(e) => {
                  setPref("accentCustom", e.target.value);
                  setPref("accent", "custom");
                }}
              />
            </label>
          </div>
        </div>

        <div className="setting-block">
          <div>
            <div className="setting-label">{t("Background")}</div>
            <div className="muted small">{t("A picture, GIF or video behind Ruby. It's tinted with your mode and accent so text stays readable.")}</div>
          </div>
          <div className="bg-grid" role="radiogroup" aria-label={t("Background")}>
            <button role="radio" aria-checked={bg === "none"} className={`bg-tile bg-none ${bg === "none" ? "on" : ""}`} onClick={() => setPref("bg", "none")}>
              <span className="bg-tile-art" />
              <span className="bg-tile-name">{t("None")}</span>
            </button>
            {recents.map((r) => {
              const on = bg === "custom" && current === r.id;
              return (
                <div key={r.id} className="bg-recent">
                  <button role="radio" aria-checked={on} className={`bg-tile ${on ? "on" : ""}`} onClick={() => void applyRecentBackground(r.id)} title={r.title}>
                    {r.thumb ? <img className="bg-tile-art" src={r.thumb} alt="" draggable={false} /> : <span className="bg-tile-art bg-tile-video">▶</span>}
                    {r.video ? <span className="bg-tile-tag">{t("LIVE")}</span> : null}
                    <span className="bg-tile-name ellipsis">{r.title}</span>
                  </button>
                  <button className="bg-recent-x" aria-label={t("Remove {title} from recents", { title: r.title })} onClick={() => removeRecentBackground(r.id)}>
                    <Icon name="x-small" size={14} />
                  </button>
                </div>
              );
            })}
            <button role="radio" aria-checked={false} className="bg-tile bg-add" onClick={() => fileRef.current?.click()}>
              <span className="bg-tile-art">+</span>
              <span className="bg-tile-name">{t("Add your own")}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={BACKGROUND_TYPES.join(",")}
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {bg === "custom" ? (
            <div className="bg-custom-actions">
              <button className="btn btn-secondary btn-small" onClick={() => fileRef.current?.click()}>
                {t("Choose another file")}
              </button>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => {
                  void clearCustomBackground().then(() => {
                    setHasCustom(false);
                    setPref("bg", "none");
                  });
                }}
              >
                {t("Remove it")}
              </button>
              <span className="muted small">{t("PNG, JPG, WebP, GIF, MP4 or WebM, up to 40 MB. It stays on this PC.")}</span>
              <CreditLine />
            </div>
          ) : null}
          <div className="wp-discover">
            <div className="setting-label">{t("Discover")}</div>
            <WallpaperSearch onPicked={() => setHasCustom(true)} />
          </div>
        </div>
        {bg !== "none" ? (
          <>
            <div className="setting-row">
              <div>
                <div className="setting-label">{t("Dim")}</div>
                <div className="muted small">{t("How much the background fades into Ruby's colors.")}</div>
              </div>
              <RangePref k="bgDim" min={30} max={95} step={1} low={t("Vivid")} high={t("Subtle")} />
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">{t("Blur")}</div>
                <div className="muted small">{t("Softens busy pictures.")}</div>
              </div>
              <RangePref k="bgBlur" min={0} max={30} step={1} low={t("Sharp")} high={t("Soft")} />
            </div>
            <label className="setting-row">
              <div>
                <div className="setting-label">{t("Animate background")}</div>
                <div className="muted small">{t("Play GIFs and videos. They always pause while Ruby is minimized.")}</div>
              </div>
              <Toggle checked={pref("bgAnimate") === "1"} onChange={(v) => setPref("bgAnimate", v ? "1" : "0")} />
            </label>
          </>
        ) : null}
        <div className="setting-block">
          <div>
            <div className="setting-label">{t("Font")}</div>
            <div className="muted small">{t("Builder Sans is the Roblox font, read from your Roblox install. The others come with Ruby.")}</div>
          </div>
          <div className="font-grid" role="radiogroup" aria-label={t("Font")}>
            {FONTS.map((x) => (
              <button key={x.id} role="radio" aria-checked={pref("font") === x.id} className={`font-tile ${pref("font") === x.id ? "on" : ""}`} style={{ fontFamily: x.stack }} onClick={() => setPref("font", x.id)}>
                <span className="font-tile-sample">Aa</span>
                <span className="font-tile-name">{x.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Corners")}</div>
            <div className="muted small">{t("How round buttons, cards and panels are.")}</div>
          </div>
          <div className="segmented small">
            {CORNERS.map((x) => (
              <button key={x.id} className={pref("corners") === x.id ? "active" : ""} onClick={() => setPref("corners", x.id)}>
                {x.name}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Game tile size")}</div>
            <div className="muted small">{t("How big games and items are in grids. Smaller fits more on screen.")}</div>
          </div>
          <div className="segmented small">
            {(["small", "medium", "large"] as const).map((x) => (
              <button key={x} className={pref("tiles") === x ? "active" : ""} onClick={() => setPref("tiles", x)}>
                {x === "small" ? t("Small") : x === "medium" ? t("Medium") : t("Large")}
              </button>
            ))}
          </div>
        </div>
        <label className="setting-row">
          <div>
            <div className="setting-label">{t("Sidebar labels")}</div>
            <div className="muted small">{t("Show the names under the icons on the left.")}</div>
          </div>
          <Toggle checked={pref("railLabels") === "1"} onChange={(v) => setPref("railLabels", v ? "1" : "0")} />
        </label>
        <label className="setting-row">
          <div>
            <div className="setting-label">{t("Tint the sidebar")}</div>
            <div className="muted small">{t("Give the sidebar a wash of your accent color.")}</div>
          </div>
          <Toggle checked={pref("railTint") === "1"} onChange={(v) => setPref("railTint", v ? "1" : "0")} />
        </label>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Open Ruby on")}</div>
            <div className="muted small">{t("The page you land on when Ruby starts.")}</div>
          </div>
          <Select
            value={pref("startPage")}
            onChange={(v) => setPref("startPage", v)}
            options={[
              { value: "home", label: t("Home") },
              { value: "friends", label: t("Friends") },
              { value: "chat", label: t("Chat") },
              { value: "mods", label: t("Mods") },
              { value: "avatar", label: t("Avatar") },
            ]}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Layout")}</div>
            <div className="muted small">{t("Compact uses less space around pages, good for smaller windows.")}</div>
          </div>
          <Select
            value={pref("density")}
            onChange={(v) => setPref("density", v)}
            options={[
              { value: "comfortable", label: t("Comfortable") },
              { value: "compact", label: t("Compact") },
            ]}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Reset appearance")}</div>
            <div className="muted small">{t("Back to dark mode, blue, Builder Sans and no background.")}</div>
          </div>
          <button
            className="btn btn-secondary btn-small"
            onClick={() => {
              resetAppearance();
              setHasCustom(false);
            }}
          >
            {t("Reset")}
          </button>
        </div>

        </>
        ) : (
        <>
        <h2 className="prefs-heading">{t("Language")}</h2>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Language")}</div>
            <div className="muted small">{t("Changes the language of Ruby Launcher. Roblox content stays as-is.")}</div>
          </div>
          <Select
            value={lang}
            ariaLabel={t("Language")}
            onChange={(v) => void setLang(v as LangCode)}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
          />
        </div>
        <h2 className="prefs-heading">{t("Privacy")}</h2>
        <label className="setting-row">
          <div>
            <div className="setting-label">{t("Streamer mode")}</div>
            <div className="muted small">{t("Blurs your Robux balance, username, server IDs and private server links, and hides message text in notifications. Ctrl+Shift+S turns it on or off anywhere.")}</div>
          </div>
          <Toggle checked={pref("streamer") === "1"} onChange={(v) => setPref("streamer", v ? "1" : "0")} />
        </label>

        <h2 className="prefs-heading">{t("Accessibility")}</h2>
        <label className="setting-row">
          <div>
            <div className="setting-label">{t("Reduce motion")}</div>
            <div className="muted small">{t("Stop or reduce motion effects, including animated backgrounds.")}</div>
          </div>
          <Toggle checked={pref("reduceMotion") === "1"} onChange={(v) => setPref("reduceMotion", v ? "1" : "0")} />
        </label>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Text size")}</div>
            <div className="muted small">{t("Adjust text size across Ruby according to your preferences")}</div>
          </div>
          <RangePref k="textSize" min={0} max={4} step={1} low={t("Default")} high={t("Largest")} />
        </div>

        <h2 className="prefs-heading">{t("Behaviour")}</h2>
        <label className="setting-row">
          <div>
            <div className="setting-label">{t("Minimize to tray when closed")}</div>
            <div className="muted small">{t("Closing the window sends Ruby to the system tray instead of fully exiting")}</div>
          </div>
          <Toggle checked={!!settings.data?.minimizeToTray} onChange={(v) => set("minimizeToTray", v)} />
        </label>
        <label className="setting-row">
          <div>
            <div className="setting-label">{t("Close Roblox when leaving a game")}</div>
            <div className="muted small">{t("Stops the Roblox app from opening its own home screen after you leave.")}</div>
          </div>
          <Toggle checked={!!settings.data?.dontOpenAppOnGameClose} onChange={(v) => set("dontOpenAppOnGameClose", v)} />
        </label>
        <label className="setting-row">
          <div>
            <div className="setting-label">{t("Open roblox.com games with Ruby")}</div>
            <div className="muted small">{t("\"Play\" on the website starts through Ruby, so your mods, the overlay and play time all work. Turn off to hand it back to Roblox.")}</div>
          </div>
          <Toggle checked={settings.data?.handleWebLaunches !== false} onChange={(v) => set("handleWebLaunches", v)} />
        </label>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Roblox Player")}</div>
            <div className="muted small ellipsis">{install.data?.installed ? install.data.path : t("Not installed")}</div>
          </div>
          {install.data?.installed ? (
            <button className="btn btn-secondary btn-small" onClick={() => launcher.openVersions()}>
              {t("Open folder")}
            </button>
          ) : null}
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t("Launcher log")}</div>
            <div className="muted small">{t("Useful if something isn't working.")}</div>
          </div>
          <button className="btn btn-secondary btn-small" onClick={() => launcher.openLog()}>
            {t("Open log")}
          </button>
        </div>
        </>
        )}
      </div>
  );
}

export function SwitchAccountsModal({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: session.accounts });
  const [managing, setManaging] = useState(false);
  /** Forget a saved account (Ruby only: it stays signed in on roblox.com and elsewhere). */
  const forget = async (id: string, name: string, current: boolean) => {
    const msg = current
      ? t("Remove {name} from Ruby? You'll be signed out here. Your Roblox account isn't affected.", { name })
      : t("Remove {name} from Ruby? You can add it again any time. Your Roblox account isn't affected.", { name });
    if (!await askConfirm(msg)) return;
    setBusy(true);
    try {
      await session.removeAccount(id);
      if (current) {
        await session.signOut();
        qc.clear();
        onClose();
        return;
      }
      await qc.invalidateQueries({ queryKey: ["accounts"] });
      toast(t("Removed {name}.", { name }));
    } catch (e) {
      toast(t("Couldn't remove it: {error}", { error: String(e) }), "error");
    } finally {
      setBusy(false);
    }
  };
  const switchTo = async (id: string, current: boolean) => {
    if (current || busy || managing) return;
    setBusy(true);
    try {
      await session.switchAccount(id);
      qc.clear();
      onClose();
    } catch (e) {
      toast(t("Couldn't switch: {error}", { error: String(e) }), "error");
      setBusy(false);
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="switch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="switch-head">
          <h2>{managing ? t("Manage accounts") : t("Switch accounts")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <div className="switch-list">
          {(accounts.data ?? []).map((a) => {
            const current = a.userId === me.id;
            return (
              <button key={a.id} className="switch-row" disabled={busy} onClick={() => switchTo(a.id, current)}>
                <Headshot userId={a.userId} size={48} />
                <div className="switch-id">
                  <div className="person-name">{a.displayName || a.username}</div>
                  <div className="muted">@{a.username}</div>
                </div>
                {managing ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="btn btn-secondary btn-small switch-remove"
                    onClick={(e) => (e.stopPropagation(), void forget(a.id, a.displayName || a.username, current))}
                    onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), void forget(a.id, a.displayName || a.username, current))}
                  >
                    {t("Remove")}
                  </span>
                ) : current ? (
                  <span className="switch-check">
                    <Icon name="check" size={16} />
                  </span>
                ) : (
                  <span className="pill muted">{t("Signed out")}</span>
                )}
              </button>
            );
          })}
        </div>
        {managing ? (
          <p className="muted small switch-note">{t("Removing an account only forgets it in Ruby. It stays signed in everywhere else.")}</p>
        ) : (
          <button className="btn btn-secondary btn-block" onClick={() => session.signIn()}>
            {t("Add an account")}
          </button>
        )}
        <button className="btn btn-secondary btn-block" onClick={() => setManaging((m) => !m)}>
          {managing ? t("Done") : t("Manage accounts")}
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const { go } = useNav();
  const [open, setOpen] = useState<Section | "ruby" | null>(null);
  if (open === "ruby") return <RubyPrefs onBack={() => setOpen(null)} />;
  if (open) return <AccountSheet start={open} onBack={() => setOpen(null)} />;
  return (
    <div className="page settings-page">
      <h1 className="settings-title center">{t("Settings")}</h1>
      <div className="settings-list">
        <div className="settings-group">
          <button className="settings-cat" onClick={() => go({ name: "rubySettings" })}>
            <span>{t("Ruby Settings")}</span>
            <Icon name="chevron-small-right" size={20} />
          </button>
          <button className="settings-cat" onClick={() => go({ name: "mods", cat: "look" })}>
            <span>{t("Theme, background and fonts")}</span>
            <Icon name="chevron-small-right" size={20} />
          </button>
          <button className="settings-cat" onClick={() => go({ name: "rubySettings", tab: "roblox" })}>
            <span>{t("Roblox Client")}</span>
            <Icon name="chevron-small-right" size={20} />
          </button>
        </div>
        {MAIN.map((group, i) => (
          <div key={i} className="settings-group">
            {group.map((c) => (
              <button key={c.section} className="settings-cat" onClick={() => setOpen(c.section)}>
                <span>{c.label()}</span>
                <Icon name="chevron-small-right" size={20} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="muted tiny legal-note">
        {t("Ruby Launcher is an independent project. It is not affiliated with, endorsed by, or sponsored by Roblox Corporation. \"Roblox\" is a trademark of Roblox Corporation.")}
      </p>
    </div>
  );
}
