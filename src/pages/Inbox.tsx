import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useNav, useUi } from "../app/store";
import { call, rbx } from "../lib/ipc";
import { Empty, ErrorState, Headshot, Icon, SkeletonRows, Verified } from "../components/ui";
import { fmtDate, t } from "../lib/i18n";

/* Roblox's message inbox (system notices, moderation, refunds…), via privatemessages v1. */

type MsgUser = { id: number; name: string; displayName: string; hasVerifiedBadge?: boolean };
type Message = { id: number; sender: MsgUser; recipient: MsgUser; subject: string; body: string; created: string; isRead: boolean; isSystemMessage: boolean };
type Page = { collection: Message[]; totalCollectionSize: number; totalPages: number; pageNumber: number };
type Tab = "Inbox" | "Sent" | "News" | "Archive";

const PM = "https://privatemessages.roblox.com/v1";
const PAGE_SIZE = 20;

async function loadPage(tab: Tab, page: number): Promise<Page> {
  if (tab === "News") {
    const r = await rbx<{ collection?: Message[] }>(`${PM}/announcements`);
    const c = r.collection ?? [];
    return { collection: c, totalCollectionSize: c.length, totalPages: 1, pageNumber: 0 };
  }
  return rbx<Page>(`${PM}/messages?pageNumber=${page}&pageSize=${PAGE_SIZE}&messageTab=${tab}`);
}
const act = (what: "mark-read" | "mark-unread" | "archive" | "unarchive", ids: number[]) => rbx(`${PM}/messages/${what}`, { method: "POST", body: { messageIds: ids } });

const when = (iso: string) => {
  const d = new Date(iso);
  return `${fmtDate(d, { month: "short", day: "numeric" })} | ${fmtDate(d, { hour: "numeric", minute: "2-digit" })}`;
};
/** Roblox message bodies are plain text with \n and the odd HTML entity. */
const clean = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/**
 * Roblox message bodies are HTML (bold, links, boxed notes). Rebuild them from an allowlist:
 * only plain formatting tags survive, links must be http(s) and open in the browser, and no
 * attributes, styles or scripts are ever copied over.
 */
const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "P", "BR", "UL", "OL", "LI", "A", "DIV", "SPAN", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "HR", "CODE", "PRE"]);
function richNodes(html: string): ReactNode {
  // Plain-text bodies: keep their line breaks.
  const isHtml = /<[a-z][\s\S]*>/i.test(html);
  const src = (isHtml ? html : html.replace(/&/g, "&amp;").replace(/</g, "&lt;")).replace(/\r?\n/g, "<br>");
  const doc = new DOMParser().parseFromString(src, "text/html");
  let k = 0;
  const walk = (n: Node): ReactNode => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent;
    if (n.nodeType !== Node.ELEMENT_NODE) return null;
    const el = n as Element;
    const kids = [...el.childNodes].map(walk);
    if (!ALLOWED.has(el.tagName)) return kids.length ? <span key={k++}>{kids}</span> : null;
    if (el.tagName === "BR") return <br key={k++} />;
    if (el.tagName === "HR") return <hr key={k++} />;
    if (el.tagName === "A") {
      const href = el.getAttribute("href") ?? "";
      let ok = false;
      try {
        ok = /^https?:$/.test(new URL(href).protocol);
      } catch {
        ok = false;
      }
      return ok ? (
        <a key={k++} href={href} onClick={(e) => (e.preventDefault(), void call("openExternal", href))} title={href}>
          {kids}
        </a>
      ) : (
        <span key={k++}>{kids}</span>
      );
    }
    // A bordered note box on roblox.com is a div with a border style; keep the look via a class.
    const boxed = el.tagName === "DIV" && /border/i.test(el.getAttribute("style") ?? "");
    const Tag = el.tagName.toLowerCase() as "b";
    return (
      <Tag key={k++} className={boxed ? "inbox-note" : undefined}>
        {kids}
      </Tag>
    );
  };
  return [...doc.body.childNodes].map(walk);
}

const tabLabel = (tb: Tab) => ({ Inbox: t("Inbox"), Sent: t("Sent"), News: t("News"), Archive: t("Archive") })[tb];

export function InboxPage() {
  const qc = useQueryClient();
  const { toast } = useUi();
  const [tab, setTab] = useState<Tab>("Inbox");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Message | null>(null);
  const q = useQuery({ queryKey: ["inbox", tab, page], queryFn: () => loadPage(tab, page), placeholderData: (p) => p, staleTime: 30_000 });
  useEffect(() => (setSel(new Set()), setOpen(null)), [tab, page]);
  const list = q.data?.collection ?? [];
  const pages = Math.max(1, q.data?.totalPages ?? 1);
  const all = list.length > 0 && list.every((m) => sel.has(m.id));

  const run = async (what: Parameters<typeof act>[0], ids: number[], done?: string) => {
    if (!ids.length) return;
    try {
      await act(what, ids);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["inboxUnread"] });
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Roblox didn't accept that."), "error");
    }
  };
  const openMsg = (m: Message) => {
    setOpen(m);
    if (!m.isRead && tab !== "News" && tab !== "Sent") void run("mark-read", [m.id]);
  };
  const toggle = (id: number) => setSel((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));

  return (
    <div className="page inbox-page">
      <h1 className="page-title">{t("Inbox")}</h1>
      <div className="inbox-tabs" role="tablist">
        {(["Inbox", "Sent", "News", "Archive"] as Tab[]).map((tb) => (
          <button key={tb} role="tab" aria-selected={tab === tb} className={tab === tb ? "on" : ""} onClick={() => (setTab(tb), setPage(0))}>
            {tabLabel(tb)}
          </button>
        ))}
      </div>

      {open ? (
        <MessageView m={open} tab={tab} onBack={() => setOpen(null)} onArchive={() => run(tab === "Archive" ? "unarchive" : "archive", [open.id], tab === "Archive" ? t("Moved to Inbox.") : t("Archived.")).then(() => setOpen(null))} />
      ) : (
        <>
          {tab !== "News" ? (
            <div className="inbox-bar">
              <label className="inbox-check">
                <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(list.map((m) => m.id)))} /> {t("All")}
              </label>
              {tab !== "Sent" ? (
                <>
                  <button className="btn btn-secondary btn-small" disabled={!sel.size} onClick={() => run(tab === "Archive" ? "unarchive" : "archive", [...sel])}>
                    {tab === "Archive" ? t("Unarchive") : t("Archive")}
                  </button>
                  <button className="btn btn-secondary btn-small" disabled={!sel.size} onClick={() => run("mark-read", [...sel])}>
                    {t("Mark As Read")}
                  </button>
                  <button className="btn btn-secondary btn-small" disabled={!sel.size} onClick={() => run("mark-unread", [...sel])}>
                    {t("Mark As Unread")}
                  </button>
                </>
              ) : null}
              <div className="inbox-pager">
                <button className="icon-btn" disabled={page === 0} onClick={() => setPage(0)} aria-label={t("First page")}>
                  «
                </button>
                <button className="icon-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label={t("Previous page")}>
                  <Icon name="chevron-small-left" size={18} />
                </button>
                <span className="small">
                  {page + 1} / {pages}
                </span>
                <button className="icon-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t("Next page")}>
                  <Icon name="chevron-small-right" size={18} />
                </button>
                <button className="icon-btn" disabled={page + 1 >= pages} onClick={() => setPage(pages - 1)} aria-label={t("Last page")}>
                  »
                </button>
              </div>
            </div>
          ) : null}
          {q.isLoading ? (
            <SkeletonRows count={8} avatar={36} />
          ) : q.error ? (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          ) : !list.length ? (
            <Empty icon="envelope">{t("No messages here.")}</Empty>
          ) : (
            <div className={`inbox-list ${q.isFetching ? "fetching" : ""}`}>
              {list.map((m) => {
                const who = tab === "Sent" ? m.recipient : m.sender;
                return (
                  <div key={m.id} className={`inbox-row ${m.isRead || tab === "Sent" ? "" : "unread"}`}>
                    {tab !== "News" ? <input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} aria-label={t("Select message")} /> : null}
                    <button className="inbox-row-main" onClick={() => openMsg(m)}>
                      {who?.id === 1 || m.isSystemMessage ? <span className="inbox-logo" aria-hidden /> : <Headshot userId={who.id} size={36} />}
                      <span className="inbox-text">
                        <span className="inbox-from">
                          <b>{who?.displayName ?? "Roblox"}</b> {who?.hasVerifiedBadge ? <Verified size={12} /> : null}
                          <span className="muted small">@{who?.name ?? "Roblox"}</span>
                          <span className="muted small inbox-date">{when(m.created)}</span>
                        </span>
                        <span className="inbox-preview ellipsis">
                          <b>{m.subject}</b> - {clean(m.body).replace(/\s+/g, " ")}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MessageView({ m, tab, onBack, onArchive }: { m: Message; tab: Tab; onBack: () => void; onArchive: () => void }) {
  const { go } = useNav();
  const who = tab === "Sent" ? m.recipient : m.sender;
  return (
    <div className="inbox-message card-in">
      <div className="inbox-msg-bar">
        <button className="link back-link" onClick={onBack}>
          <Icon name="arrow-large-left" size={16} /> {t("Back")}
        </button>
        {tab === "Inbox" || tab === "Archive" ? (
          <button className="btn btn-secondary btn-small" onClick={onArchive}>
            {tab === "Archive" ? t("Move to Inbox") : t("Archive")}
          </button>
        ) : null}
      </div>
      <h2 className="inbox-subject">{m.subject}</h2>
      <button className="inbox-from link-plain" onClick={() => who?.id && who.id !== 1 && go({ name: "profile", userId: who.id })}>
        {who?.id === 1 || m.isSystemMessage ? <span className="inbox-logo" aria-hidden /> : <Headshot userId={who.id} size={32} />}
        <b>{who?.displayName ?? "Roblox"}</b> {who?.hasVerifiedBadge ? <Verified size={12} /> : null}
        <span className="muted small">{fmtDate(m.created, { dateStyle: "medium", timeStyle: "short" })}</span>
      </button>
      <div className="inbox-body rich">{richNodes(m.body)}</div>
    </div>
  );
}
