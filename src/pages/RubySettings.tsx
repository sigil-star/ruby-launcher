import { useNav } from "../app/store";
import { NotificationPrefs } from "../components/AccountGate";
import { Icon } from "../components/ui";
import { t } from "../lib/i18n";
import { ClientPage } from "./Client";
import { PluginSettingsSections } from "./Plugins";
import { DiscordStatus, Licenses, RoundUpPref, RubyPrefsSections, Updates } from "./Settings";

export type RubySettingsTab = "general" | "roblox" | "about";

const TABS: { id: RubySettingsTab; label: () => string }[] = [
  { id: "general", label: () => t("General") },
  { id: "roblox", label: () => t("Roblox") },
  { id: "about", label: () => t("About") },
];

/** Ruby's own settings, one place: behaviour, the Roblox client, and updates. Looks live in Customize. */
export function RubySettings({ tab = "general" }: { tab?: RubySettingsTab }) {
  const { replace, go } = useNav();
  return (
    <div className="page settings-page ruby-settings">
      <h1 className="settings-title">{t("Ruby Settings")}</h1>
      <div className="tabs">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? "active" : ""} onClick={() => replace({ name: "rubySettings", tab: x.id })}>
            {x.label()}
          </button>
        ))}
      </div>

      {tab === "general" ? (
        <>
          <button className="settings-shortcut" onClick={() => go({ name: "mods", cat: "look" })}>
            <Icon name="paint-brush" size={22} />
            <span>
              <b>{t("Theme, background and fonts")}</b>
              <span className="muted small">{t("Change how Ruby looks in Customize.")}</span>
            </span>
            <Icon name="chevron-small-right" size={20} />
          </button>
          <RubyPrefsSections part="general" />
          <PluginSettingsSections />
          <button className="settings-shortcut" onClick={() => go({ name: "plugins" })}>
            <Icon name="squares-grid-qr" size={22} />
            <span>
              <b>{t("Plugins")}</b>
              <span className="muted small">{t("Add features to Ruby, or build your own.")}</span>
            </span>
            <Icon name="chevron-small-right" size={20} />
          </button>
          <div className="device-prefs">
            <h2 className="prefs-heading">{t("Integrations")}</h2>
            <DiscordStatus />
            <NotificationPrefs />
            <RoundUpPref />
          </div>
        </>
      ) : tab === "roblox" ? (
        <>
          <button className="settings-shortcut" onClick={() => go({ name: "mods", cat: "graphics" })}>
            <Icon name="three-sliders-horizontal" size={22} />
            <span>
              <b>{t("Graphics and performance")}</b>
              <span className="muted small">{t("Quality, textures, anti-aliasing and graphics API are in Customize › Graphics.")}</span>
            </span>
            <Icon name="chevron-small-right" size={20} />
          </button>
          <ClientPage embedded />
        </>
      ) : (
        <div className="device-prefs">
          <Updates />
          <Licenses />
        </div>
      )}
    </div>
  );
}
