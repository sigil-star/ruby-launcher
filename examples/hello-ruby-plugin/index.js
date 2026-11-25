// Hello Ruby — the smallest useful plugin. Copy this folder, change plugin.json, and build.

// A page in the left bar.
ruby.registerPage({
  id: "main",
  label: "Hello",
  icon: "star",
  mount(container) {
    const clicks = Number(ruby.storage.get("clicks") || "0");
    const h = document.createElement("h1");
    h.textContent = "Hello from " + ruby.name + " 👋";
    const p = document.createElement("p");
    p.style.opacity = "0.7";
    p.textContent = "Plugin API v" + ruby.apiVersion + ". You've clicked " + clicks + " time(s).";
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Click me";
    let n = clicks;
    btn.onclick = () => {
      n += 1;
      ruby.storage.set("clicks", String(n));
      p.textContent = "Plugin API v" + ruby.apiVersion + ". You've clicked " + n + " time(s).";
      ruby.toast("Hello! (" + n + ")");
    };
    container.append(h, p, btn);
  },
});

// A section under Ruby Settings > General.
ruby.registerSettings({
  id: "about",
  title: "Hello Ruby",
  mount(container) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "This settings section was added by the Hello Ruby example plugin.";
    container.append(p);
  },
});

// React to navigation.
ruby.on("navigate", (route) => {
  console.log("[hello-ruby] navigated to", route && route.name);
});
