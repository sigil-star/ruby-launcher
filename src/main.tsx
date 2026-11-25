import { ToastsApp } from "./app/ToastsApp";
import { RubySettings } from "./pages/RubySettings";
import { Plugins, PluginView } from "./pages/Plugins";
import { emitRubyEvent, loadPlugins } from "./lib/plugins";
import { AccountGate } from "./components/AccountGate";
import { CommunitySearch } from "./pages/CommunitySearch";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installSmoothScroll } from "./lib/smoothScroll";
import { Shell } from "./app/Shell";
import { NavProvider, SessionProvider, UiProvider, useNav, useSession, useUi } from "./app/store";
import { Center, Spinner } from "./components/ui";
import { call, rbx } from "./lib/ipc";
import { Avatar } from "./pages/Avatar";
import { Chat } from "./pages/Chat";
import { Community } from "./pages/Community";
import { Game, ServersPage } from "./pages/Game";
import { Home } from "./pages/Home";
import { ItemPage } from "./pages/Item";
import { RobuxPage } from "./pages/Robux";
import { ClientPage } from "./pages/Client";
import { ModsPage } from "./pages/Mods";
import { WebEmbed } from "./components/WebEmbed";
import { ItemPreviewProvider } from "./components/ItemPreview";
import { GameList, Search } from "./pages/Lists";
import { Login } from "./pages/Login";
import { Communities, Connections, Friends, Profile } from "./pages/People";
import { applyDisplayPrefs, Settings } from "./pages/Settings";
import { loadUiFont } from "./lib/appearance";
import { OverlayApp } from "./overlay/Overlay";
import { TradeComposer, TradesPage } from "./pages/Trades";
import { EditProfile } from "./pages/EditProfile";
import { CapturesPage } from "./pages/Captures";
import { HelpPage, InventoryPage } from "./pages/Misc";
import { InboxPage } from "./pages/Inbox";
import "./styles.css";
import "./i18n.css";
import { I18nProvider, initI18n, t } from "./lib/i18n";

const newQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

function Page() {
  const { route } = useNav();
  switch (route.name) {
    case "home":
      return <Home tab={route.tab} />;
    case "game":
      return <Game key={route.universeId} universeId={route.universeId} />;
    case "servers":
      return <ServersPage key={route.placeId} universeId={route.universeId} placeId={route.placeId} gameName={route.gameName} openCreate={route.openCreate} />;
    case "search":
      return <Search q={route.q} />;
    case "list":
      return <GameList kind={route.kind} />;
    case "friends":
      return <Friends tab={route.tab} />;
    case "chat":
      return (
        <AccountGate feature="chat">
          <Chat conversationId={route.conversationId} withUserId={route.withUserId} />
        </AccountGate>
      );
    case "avatar":
      return <Avatar tab={route.tab} />;
    case "profile":
      return <Profile key={route.userId} userId={route.userId} />;
    case "connections":
      return <Connections key={`${route.userId}-${route.kind}`} userId={route.userId} kind={route.kind} />;
    case "communitySearch":
      return <CommunitySearch q={route.q} />;
    case "communities":
      return <Communities />;
    case "community":
      return <Community groupId={route.groupId} initialTab={route.tab} />;
    case "item":
      return <ItemPage key={`${route.itemType}-${route.id}`} itemType={route.itemType} id={route.id} />;
    case "web":
      return <WebEmbed key={route.url} url={route.url} title={route.title} />;
    case "client":
      return <ClientPage />;
    case "mods":
      return <ModsPage key={route.cat ?? ""} initialCat={route.cat} />;
    case "rubySettings":
      return <RubySettings tab={route.tab} />;
    case "plugins":
      return <Plugins />;
    case "plugin":
      return <PluginView key={`${route.pluginId}:${route.pageId}`} pluginId={route.pluginId} pageId={route.pageId} />;
    case "robux":
      return <RobuxPage />;
    case "create":
      // The Creator Hub itself, themed: always up to date with what Roblox ships.
      return <WebEmbed key="create" url={route.universeId ? `https://create.roblox.com/dashboard/creations/experiences/${route.universeId}/overview` : "https://create.roblox.com/dashboard/creations"} title={t("Create")} />;
    case "settings":
      return <Settings />;
    case "captures":
      return <CapturesPage />;
    case "help":
      return <HelpPage />;
    case "inbox":
      return <InboxPage />;
    case "inventory":
      return <InventoryPage />;
    case "editProfile":
      return <EditProfile />;
    case "trades":
      return (
        <AccountGate feature="trade">
          <TradesPage box={route.box} />
        </AccountGate>
      );
    case "trade":
      return <TradeComposer key={`${route.userId}-${route.counterId ?? ""}`} userId={route.userId} counterId={route.counterId} />;
  }
}

/** Discord shows what you're doing in Ruby, updated on every navigation. */
function DiscordPage() {
  const { route } = useNav();
  const universeId = route.name === "game" ? route.universeId : 0;
  const game = useQuery({
    queryKey: ["discordGameName", universeId],
    queryFn: () => rbx<{ data: { name: string }[] }>(`https://games.roblox.com/v1/games?universeIds=${universeId}`).then((r) => r.data?.[0]?.name ?? ""),
    enabled: !!universeId,
    staleTime: 60 * 60_000,
  });
  const [details, state] = ((): [string, string] => {
    switch (route.name) {
      case "home": return [t("Browsing Roblox"), t("On the home page")];
      case "game": return [game.data ? t("Viewing {game}", { game: game.data }) : t("Viewing an experience"), t("In Ruby Launcher")];
      case "servers": return [t("Browsing servers"), route.gameName ? t("for {game}", { game: route.gameName }) : t("In Ruby Launcher")];
      case "search": return [t("Searching"), t("In Ruby Launcher")];
      case "list": return [t("Browsing experiences"), t("In Ruby Launcher")];
      case "friends": case "connections": return [t("Browsing friends"), t("In Ruby Launcher")];
      case "chat": return [t("Chatting"), t("In Ruby Launcher")];
      case "avatar": return [t("Editing their avatar"), t("In Ruby Launcher")];
      case "profile": return [t("Viewing a profile"), t("In Ruby Launcher")];
      case "communities": case "communitySearch": case "community": return [t("Browsing communities"), t("In Ruby Launcher")];
      case "item": return [t("Browsing the Marketplace"), t("In Ruby Launcher")];
      case "robux": return [t("Checking Robux"), t("In Ruby Launcher")];
      case "trades": case "trade": return [t("Trading"), t("In Ruby Launcher")];
      case "editProfile": return [t("Editing their profile"), t("In Ruby Launcher")];
      case "create": return [t("In the Create hub"), t("In Ruby Launcher")];
      case "client": return [t("Managing Roblox"), t("In Ruby Launcher")];
      case "mods": return [t("Customizing Roblox"), t("In Ruby Launcher")];
      case "web": return [route.title, t("In Ruby Launcher")];
      case "settings": return [t("In settings"), t("In Ruby Launcher")];
      default: return [t("Browsing Roblox"), t("In Ruby Launcher")];
    }
  })();
  useEffect(() => {
    call("setDiscordPage", details, state).catch(() => undefined);
  }, [details, state]);
  return null;
}

function ScrollReset() {
  const { route } = useNav();
  useEffect(() => {
    document.querySelector(".content")?.scrollTo(0, 0);
  }, [route]);
  return null;
}

// Route names a plugin may navigate to (param-less built-in pages only).
const PLUGIN_NAV = new Set(["home", "chat", "avatar", "mods", "plugins", "rubySettings", "settings", "friends", "communities", "inbox", "captures", "robux"]);

/** Loads enabled plugins once signed in, and tells them when the route changes. */
function PluginLoader() {
  const { toast } = useUi();
  const { go, route } = useNav();
  useEffect(() => {
    void loadPlugins(
      (m, k) => toast(m, k),
      (name) => {
        if (PLUGIN_NAV.has(name)) go({ name } as never);
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    emitRubyEvent("navigate", { name: route.name });
  }, [route]);
  return null;
}

function App() {
  const { status, me } = useSession();

  useEffect(() => {
    call("mainRendererReady").catch(() => undefined);
  }, []);

  // A fresh cache per account so nothing leaks between accounts when switching.
  const queryClient = useMemo(newQueryClient, [me.id]);

  if (status === "loading")
    return (
      <div className="boot">
        <Center>
          <Spinner size={36} />
        </Center>
      </div>
    );
  if (status === "signedOut") return <I18nProvider><Login /></I18nProvider>;
  return (
    <QueryClientProvider client={queryClient}>
      <NavProvider key={me.id}>
        <I18nProvider>
          <ItemPreviewProvider>
            <Shell>
              <ScrollReset />
              <DiscordPage />
              <PluginLoader />
              <Page />
            </Shell>
          </ItemPreviewProvider>
        </I18nProvider>
      </NavProvider>
    </QueryClientProvider>
  );
}

applyDisplayPrefs();
void loadUiFont();

void initI18n().then(() => {
// The in-game overlay window loads this same bundle at #overlay and renders only the panel.
if (location.hash === "#overlay") {
  createRoot(document.getElementById("root")!).render(<I18nProvider><OverlayApp /></I18nProvider>);
} else if (location.hash === "#toasts") {
  createRoot(document.getElementById("root")!).render(<I18nProvider><ToastsApp /></I18nProvider>);
} else {
  installSmoothScroll();
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary onHome={() => location.reload()}>
      <SessionProvider>
        <UiProvider>
          <App />
        </UiProvider>
      </SessionProvider>
    </ErrorBoundary>,
  );
}
});
