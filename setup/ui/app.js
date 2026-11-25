const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const win = window.__TAURI__.window.getCurrentWindow();
const $ = (id) => document.getElementById(id);
const show = (id) => ["start", "working", "done"].forEach((s) => ($(s).hidden = s !== id));

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';

$("min").onclick = () => win.minimize();
$("close").onclick = () => !busy && win.close();
$("closeBtn").onclick = () => win.close();
$("optionsToggle").onclick = () => {
  const o = $("options");
  o.hidden = !o.hidden;
  $("optionsToggle").textContent = o.hidden ? "Options" : "Hide options";
};

let busy = false;
window.addEventListener("beforeunload", (e) => busy && e.preventDefault());

listen("progress", (e) => {
  const { pct, step } = e.payload;
  $("bar").style.width = `${pct}%`;
  $("pct").textContent = `${pct}%`;
  $("step").textContent = step;
});

function finish(ok, text, button, action) {
  busy = false;
  $("doneIcon").innerHTML = ok ? CHECK : CROSS;
  $("doneIcon").classList.toggle("err", !ok);
  $("doneText").textContent = text;
  $("doneBtn").textContent = button;
  $("doneBtn").hidden = !button;
  $("doneBtn").onclick = action;
  show("done");
}

async function start() {
  const info = await invoke("setup_info");
  $("dir").textContent = info.dir;

  if (info.mode === "uninstall") {
    $("title").textContent = "Uninstall Ruby";
    $("subtitle").textContent = "Roblox will be put back exactly as Roblox ships it.";
    $("primary").textContent = "Uninstall";
    $("primary").classList.add("danger");
    $("optionsToggle").hidden = true;
    $("removeDataRow").hidden = false;
    $("fine").textContent = "Your Roblox account and anything you bought are not affected.";
    $("primary").onclick = async () => {
      busy = true;
      show("working");
      try {
        await invoke("run_uninstall", { removeData: $("removeData").checked });
        finish(true, "Ruby has been removed. Thanks for trying it.", "", null);
      } catch (err) {
        finish(false, String(err), "Try again", () => location.reload());
      }
    };
    return;
  }

  $("primary").textContent = info.installed ? "Update Ruby" : "Install";
  $("subtitle").textContent = info.installed ? `Version ${info.version} is ready to install` : "A cleaner way to play Roblox";
  $("fine").innerHTML = `${info.sizeMb} MB · Not affiliated with Roblox Corporation.<br>By installing you agree to the <a id="lic">license</a> and <a id="priv">privacy policy</a>.`;
  $("lic").onclick = () => invoke("open_link", { url: "https://dsk.wtf/ruby/credits" }).catch(() => {});
  $("priv").onclick = () => invoke("open_link", { url: "https://dsk.wtf/ruby/privacy" }).catch(() => {});
  $("primary").onclick = async () => {
    busy = true;
    show("working");
    try {
      await invoke("run_install", { desktop: $("desktop").checked });
      if ($("launch").checked) {
        await invoke("launch_ruby").catch(() => {});
        setTimeout(() => win.close(), 900);
        finish(true, "Ruby is installed. Opening it now…", "", null);
      } else {
        finish(true, "Ruby is installed.", "Open Ruby", async () => {
          await invoke("launch_ruby").catch(() => {});
          win.close();
        });
      }
    } catch (err) {
      finish(false, String(err), "Try again", () => location.reload());
    }
  };

  // Started by Ruby's updater: install straight away, keep the shortcuts as they were, reopen Ruby.
  if (info.update) {
    $("desktop").checked = info.desktop;
    $("launch").checked = true;
    $("primary").click();
  }
}
start();
