import { useMe, useNav } from "../app/store";
import { InventoryBrowser } from "../components/InventoryBrowser";
import { Headshot, Icon } from "../components/ui";
import { t } from "../lib/i18n";

/** Help & Safety, laid out like the app's: you at the top, then a list that opens each roblox.com page in Ruby. */
const helpRows = (): { label: string; url: string }[] => [
  { label: t("Account status, violations, and appeals"), url: "https://www.roblox.com/report-appeals" },
  { label: t("Help"), url: "https://en.help.roblox.com/hc/en-us" },
  { label: t("Report history"), url: "https://www.roblox.com/abusereport/history" },
  { label: t("Experience Support History"), url: "https://www.roblox.com/support/history" },
  { label: t("About"), url: "https://www.roblox.com/info/about-us" },
];

export function HelpPage() {
  const me = useMe();
  const { go } = useNav();
  return (
    <div className="page help-page">
      <h1 className="help-title">{t("Help & Safety")}</h1>
      <div className="help-me">
        <Headshot userId={me.id ?? 0} size={64} />
        <b>{me.displayName || me.name}</b>
        <span className="muted small">@{me.name}</span>
      </div>
      <div className="help-list">
        {helpRows().map((r) => (
          <button key={r.label} className="help-row" onClick={() => go({ name: "web", url: r.url, title: r.label })}>
            <span>{r.label}</span>
            <Icon name="chevron-small-right" size={20} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** My Inventory: the same category browser as on profiles. */
export function InventoryPage() {
  const me = useMe();
  const { go } = useNav();
  return (
    <div className="page inventory-page">
      <div className="inv-page-head">
        <h1>{t("My Inventory")}</h1>
        <div className="inv-get-more">
          <span className="muted small">{t("Explore the marketplace to find more items!")}</span>
          <button className="btn btn-primary btn-small" onClick={() => go({ name: "avatar", tab: "marketplace" })}>
            {t("Get More")}
          </button>
        </div>
      </div>
      {me.id ? <InventoryBrowser userId={me.id} /> : null}
    </div>
  );
}
