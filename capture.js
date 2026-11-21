(() => {
  "use strict";
  if (window.__siteCapture?.active) {
    window.__siteCapture.open();
    return;
  }

  const state = {
    active: true,
    urls: new Set(),
    observer: null,
    panel: null,
    status: null,
    add(url) {
      try {
        const u = new URL(url, location.href);
        if (!/^https?:$/.test(u.protocol)) return;
        this.urls.add(u.href);
      } catch {}
    },
    open() { this.panel?.removeAttribute("hidden"); }
  };
  window.__siteCapture = state;

  const collectExisting = () => {
    state.add(location.href);
    performance.getEntriesByType("resource").forEach(e => state.add(e.name));
  };
  collectExisting();

  if ("PerformanceObserver" in window) {
    try {
      state.observer = new PerformanceObserver(list => {
        list.getEntries().forEach(e => state.add(e.name));
      });
      state.observer.observe({ type: "resource", buffered: true });
    } catch {}
  }

  const panel = document.createElement("section");
  panel.id = "__site_capture_panel";
  panel.style.cssText = "position:fixed;z-index:2147483647;right:14px;bottom:14px;width:min(340px,calc(100vw - 28px));padding:14px;background:#17191f;color:#f5f6fa;border:1px solid #555;border-radius:12px;box-shadow:0 8px 30px #0008;font:13px/1.45 system-ui,sans-serif";
  panel.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b>Website Capture</b><button data-action="hide" style="background:#343944;color:white;border:0;border-radius:6px;padding:4px 8px">Hide</button></div><p style="margin:8px 0">Collects browser-requested resources as you browse. Only resources the page context is allowed to fetch can be saved.</p><div data-status style="margin:8px 0;color:#b8c5d8">Watching network resources…</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button data-action="refresh">Refresh count</button><button data-action="download">Build ZIP</button><button data-action="stop">Stop watcher</button></div><style># __site_capture_panel button{cursor:pointer;background:#315caa;color:white;border:0;border-radius:7px;padding:7px 10px;font:inherit}# __site_capture_panel button:hover{filter:brightness(1.12)}</style>';
  panel.querySelector("style").textContent = panel.querySelector("style").textContent.replaceAll("# __site_capture_panel", "#__site_capture_panel");
  document.documentElement.appendChild(panel);
  state.panel = panel;
  state.status = panel.querySelector("[data-status]");

  const update = message => {
    state.status.textContent = message || (state.urls.size + " unique resource URLs discovered.");
  };
  update();

  panel.addEventListener("click", async event => {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "hide") panel.setAttribute("hidden", "");
    if (action === "refresh") {
      collectExisting();
      update();
    }
    if (action === "stop") {
      state.observer?.disconnect();
      state.observer = null;
      update("Watcher stopped. You can still build a ZIP from collected URLs.");
    }
    if (action === "download") {
      collectExisting();
      await buildZip(update);
    }
  });

  async function buildZip(setStatus) {
    if (!window.JSZip) {
      setStatus("Loading ZIP library…");
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Could not load JSZip. Check the connection or use the console loader."));
        document.head.appendChild(s);
      }).catch(e => setStatus(e.message));
      if (!window.JSZip) return;
    }

    const zip = new JSZip();
    const manifest = {
      format: "websiteclientcloner-capture-v1",
      capturedAt: new Date().toISOString(),
      page: location.href,
      note: "Original response bytes are stored when fetch access is permitted. This is a browser-visible resource capture, not a server filesystem backup.",
      resources: [],
      failed: []
    };
    const urls = [...state.urls];
    let completed = 0;
    const usedPaths = new Map();

    const safePath = urlString => {
      const u = new URL(urlString);
      const host = u.host.replace(/[^a-zA-Z0-9._-]/g, "_");
      let pathname = decodeURIComponent(u.pathname);
      if (!pathname || pathname === "/") pathname = "/index.html";
      else if (pathname.endsWith("/")) pathname += "index.html";
      pathname = pathname.replace(/^\/+/, "").split("/").map(part =>
        part === "." || part === ".." ? "_" : part.replace(/[\\:*?"<>|]/g, "_")
      ).join("/");
      let path = host + "/" + pathname;
      const prior = usedPaths.get(path);
      if (prior && prior !== u.href) {
        const q = u.search ? Array.from(new TextEncoder().encode(u.search)).reduce((a, b) => (a * 33 + b) >>> 0, 5381).toString(16) : "variant";
        path = host + "/.__url_variants__/" + q + "/" + pathname;
      }
      usedPaths.set(path, u.href);
      return path;
    };

    const queue = urls.slice();
    const concurrency = 6;
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const url = queue[cursor++];
        try {
          const response = await fetch(url, { credentials: "include", redirect: "follow" });
          if (response.type === "opaque") throw new Error("opaque response (browser security policy)");
          const body = await response.blob();
          const path = safePath(url);
          zip.file(path, body, { binary: true });
          manifest.resources.push({
            url,
            archivePath: path,
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type"),
            contentLength: response.headers.get("content-length"),
            finalUrl: response.url,
            redirected: response.redirected
          });
        } catch (error) {
          manifest.failed.push({ url, reason: String(error?.message || error) });
        } finally {
          completed++;
          if (completed % 5 === 0 || completed === urls.length) {
            setStatus("Fetching " + completed + "/" + urls.length + " resources…");
          }
        }
      }
    }

    setStatus("Fetching " + urls.length + " discovered resources…");
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    zip.file("websiteclientcloner-manifest.json", JSON.stringify(manifest, null, 2));
    setStatus("Packaging " + manifest.resources.length + " saved resources…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = (location.hostname || "website") + "-capture.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    setStatus("Done: " + manifest.resources.length + " saved, " + manifest.failed.length + " unavailable. See the manifest for details.");
  }
  console.info("[WebsiteClientCloner] Capture panel ready. Browse/interact, then choose Build ZIP.");
})();