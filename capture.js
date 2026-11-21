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
        if (/^https?:$/.test(u.protocol)) this.urls.add(u.href);
      } catch {}
    },
    open() {
      this.panel?.removeAttribute("hidden");
    }
  };
  window.__siteCapture = state;

  const collectExisting = () => {
    state.add(location.href);
    performance.getEntriesByType("resource").forEach(entry => state.add(entry.name));
  };
  collectExisting();

  if ("PerformanceObserver" in window) {
    try {
      state.observer = new PerformanceObserver(list => {
        list.getEntries().forEach(entry => state.add(entry.name));
        updateCount();
      });
      state.observer.observe({ type: "resource", buffered: true });
    } catch {}
  }

  const panel = document.createElement("section");
  panel.id = "__site_capture_panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "WebsiteClientCloner");
  panel.innerHTML = `
    <style>
      #__site_capture_panel {
        position: fixed;
        z-index: 2147483647;
        right: max(12px, env(safe-area-inset-right));
        bottom: max(12px, env(safe-area-inset-bottom));
        width: min(390px, calc(100vw - 24px));
        max-height: min(58vh, 520px);
        overflow: auto;
        overscroll-behavior: contain;
        box-sizing: border-box;
        padding: 14px;
        color: #f5f6fa;
        background: #17191f;
        border: 1px solid #505765;
        border-radius: 16px;
        box-shadow: 0 8px 34px #0009;
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        -webkit-text-size-adjust: 100%;
      }
      #__site_capture_panel * { box-sizing: border-box; }
      #__site_capture_panel .wcc-head {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        margin-bottom: 8px;
      }
      #__site_capture_panel .wcc-title { font-size: 16px; font-weight: 700; }
      #__site_capture_panel .wcc-description { margin: 6px 0 10px; color: #c4cad5; }
      #__site_capture_panel .wcc-status {
        min-height: 44px; padding: 10px 11px; margin: 10px 0;
        border-radius: 10px; background: #252a34; color: #e7edf8;
        overflow-wrap: anywhere;
      }
      #__site_capture_panel .wcc-actions {
        display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
      }
      #__site_capture_panel button {
        min-height: 46px; padding: 10px 12px; border: 0; border-radius: 10px;
        color: white; background: #315caa; font: inherit; font-weight: 600;
        touch-action: manipulation; cursor: pointer;
      }
      #__site_capture_panel button:disabled { opacity: .55; cursor: wait; }
      #__site_capture_panel button.wcc-secondary { background: #343b48; }
      #__site_capture_panel .wcc-note { margin: 10px 0 0; color: #aeb8c8; font-size: 12px; }
      @media (max-width: 480px) {
        #__site_capture_panel { right: 8px; bottom: max(8px, env(safe-area-inset-bottom)); width: calc(100vw - 16px); padding: 12px; }
        #__site_capture_panel .wcc-actions { grid-template-columns: 1fr 1fr; }
      }
    </style>
    <div class="wcc-head">
      <div class="wcc-title">WebsiteClientCloner</div>
      <button class="wcc-secondary" data-action="hide" type="button" aria-label="Hide capture panel">Hide</button>
    </div>
    <p class="wcc-description">Browse the page to collect its resource URLs, then save the accessible files into a ZIP.</p>
    <div class="wcc-status" data-status role="status" aria-live="polite">Starting resource watcher…</div>
    <div class="wcc-actions">
      <button data-action="refresh" type="button">Refresh count</button>
      <button data-action="download" type="button">Save ZIP</button>
      <button class="wcc-secondary" data-action="stop" type="button">Stop watcher</button>
      <button class="wcc-secondary" data-action="hide" type="button">Minimize</button>
    </div>
    <p class="wcc-note">Mobile tip: keep this tab open while browsing. Large captures may need substantial device memory. Browser security rules can prevent some files from being saved.</p>
  `;

  document.documentElement.appendChild(panel);
  state.panel = panel;
  state.status = panel.querySelector("[data-status]");

  function updateStatus(message) {
    if (state.status) state.status.textContent = message;
  }
  function updateCount() {
    updateStatus(state.urls.size + " unique resource URLs collected.");
  }
  updateCount();

  panel.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (action === "hide") {
      panel.setAttribute("hidden", "");
      return;
    }
    if (action === "refresh") {
      collectExisting();
      updateCount();
      return;
    }
    if (action === "stop") {
      state.observer?.disconnect();
      state.observer = null;
      updateStatus("Watcher stopped. You can still save a ZIP of the collected URLs.");
      button.disabled = true;
      return;
    }
    if (action === "download") {
      collectExisting();
      const downloadButton = panel.querySelector('[data-action="download"]');
      downloadButton.disabled = true;
      panel.querySelectorAll("button[data-action]").forEach(b => {
        if (b !== downloadButton && b.dataset.action !== "hide") b.disabled = true;
      });
      try {
        await buildZip(updateStatus);
      } catch (error) {
        updateStatus("ZIP failed: " + (error?.message || String(error)));
      } finally {
        downloadButton.disabled = false;
        panel.querySelectorAll("button[data-action]").forEach(b => {
          if (b.dataset.action !== "stop" || state.observer) b.disabled = false;
        });
      }
    }
  });

  async function ensureZipLibrary() {
    if (window.JSZip) return;
    updateStatus("Loading ZIP support…");
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load ZIP support. Check the connection or page content restrictions."));
      document.head.appendChild(script);
    });
    if (!window.JSZip) throw new Error("ZIP support did not initialize.");
  }

  async function buildZip(setStatus) {
    await ensureZipLibrary();

    const zip = new JSZip();
    const manifest = {
      format: "websiteclientcloner-capture-v1",
      capturedAt: new Date().toISOString(),
      page: location.href,
      note: "Browser-visible resources only. Bodies are fetched when ZIP creation starts and may differ from the original network response. This is not a server filesystem backup.",
      resources: [],
      failed: []
    };
    const urls = [...state.urls];
    let completed = 0;
    const usedPaths = new Map();

    const safePath = urlString => {
      const u = new URL(urlString);
      const host = u.host.replace(/[^a-zA-Z0-9._-]/g, "_");
      let pathname;
      try { pathname = decodeURIComponent(u.pathname); }
      catch { pathname = u.pathname; }
      if (!pathname || pathname === "/") pathname = "/index.html";
      else if (pathname.endsWith("/")) pathname += "index.html";
      pathname = pathname.replace(/^\/+/, "").split("/").map(part =>
        part === "." || part === ".." ? "_" : part.replace(/[\\:*?"<>|]/g, "_")
      ).join("/");
      let path = host + "/" + pathname;
      const prior = usedPaths.get(path);
      if (prior && prior !== u.href) {
        const queryHash = u.search
          ? Array.from(new TextEncoder().encode(u.search)).reduce((a, b) => (a * 33 + b) >>> 0, 5381).toString(16)
          : "variant";
        path = host + "/.__url_variants__/" + queryHash + "/" + pathname;
      }
      usedPaths.set(path, u.href);
      return path;
    };

    const queue = urls.slice();
    let cursor = 0;
    // Lower concurrency and skip CPU-heavy compression on phones/tablets.
    const isTouchDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);\n    const concurrency = isTouchDevice ? 2 : 4;

    async function worker() {
      while (cursor < queue.length) {
        const url = queue[cursor++];
        try {
          const response = await fetch(url, { credentials: "include", redirect: "follow" });
          if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);
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
          setStatus("Fetching " + completed + " of " + urls.length + " resources…");
        }
      }
    }

    setStatus("Preparing " + urls.length + " resources…");
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    zip.file("websiteclientcloner-manifest.json", JSON.stringify(manifest, null, 2));
    setStatus("Building ZIP on this device…");
    // STORE avoids extra CPU/memory cost on mobile; ZIP remains lossless.
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = (location.hostname || "website") + "-capture.zip";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    setStatus("Finished: " + manifest.resources.length + " saved, " + manifest.failed.length + " unavailable. Check the ZIP manifest for details.");
  }

  console.info("[WebsiteClientCloner] Mobile-friendly capture panel ready.");
})();