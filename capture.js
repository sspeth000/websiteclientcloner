(() => {
  "use strict";

  if (window.__siteCapture?.active) {
    window.__siteCapture.open();
    return;
  }

  const state = {
    active: false,
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
      if (this.panel) this.panel.hidden = false;
    }
  };

  function make(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function setStyles(node, styles) {
    Object.assign(node.style, styles);
    return node;
  }

  function updateStatus(message) {
    if (state.status) state.status.textContent = message;
  }

  function updateCount() {
    updateStatus(state.urls.size + " unique resource URLs collected.");
  }

  try {
    const panel = make("section");
    panel.id = "__site_capture_panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "WebsiteClientCloner");

    setStyles(panel, {
      position: "fixed",
      zIndex: "2147483647",
      right: "max(8px, env(safe-area-inset-right))",
      bottom: "max(8px, env(safe-area-inset-bottom))",
      width: "min(390px, calc(100vw - 16px))",
      maxHeight: "min(58vh, 520px)",
      overflow: "auto",
      overscrollBehavior: "contain",
      boxSizing: "border-box",
      padding: "12px",
      color: "#f5f6fa",
      background: "#17191f",
      border: "1px solid #505765",
      borderRadius: "16px",
      boxShadow: "0 8px 34px #0009",
      font: "14px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
      WebkitTextSizeAdjust: "100%"
    });

    const header = setStyles(make("div"), {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
      marginBottom: "8px"
    });
    const title = setStyles(make("div", "WebsiteClientCloner"), {
      fontSize: "16px",
      fontWeight: "700"
    });

    function makeButton(label, action, secondary) {
      const button = make("button", label);
      button.type = "button";
      button.dataset.action = action;
      button.setAttribute("aria-label", label);
      setStyles(button, {
        minHeight: "46px",
        padding: "10px 12px",
        border: "0",
        borderRadius: "10px",
        color: "#fff",
        background: secondary ? "#343b48" : "#315caa",
        font: "inherit",
        fontWeight: "600",
        touchAction: "manipulation",
        cursor: "pointer"
      });
      return button;
    }

    const hideTop = makeButton("Hide", "hide", true);
    header.append(title, hideTop);

    const description = setStyles(
      make("p", "Browse the page to collect its resource URLs, then save accessible files into a ZIP."),
      { margin: "6px 0 10px", color: "#c4cad5" }
    );

    const status = setStyles(make("div", "Starting resource watcher…"), {
      minHeight: "44px",
      padding: "10px 11px",
      margin: "10px 0",
      borderRadius: "10px",
      background: "#252a34",
      color: "#e7edf8",
      overflowWrap: "anywhere"
    });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const actions = setStyles(make("div"), {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: "8px"
    });
    const refreshButton = makeButton("Refresh count", "refresh", false);
    const downloadButton = makeButton("Save ZIP", "download", false);
    const stopButton = makeButton("Stop watcher", "stop", true);
    const minimizeButton = makeButton("Minimize", "hide", true);
    actions.append(refreshButton, downloadButton, stopButton, minimizeButton);

    const note = setStyles(
      make("p", "Mobile tip: keep this tab open while browsing. Large captures can use substantial device memory. Browser security rules may prevent some files from being saved."),
      { margin: "10px 0 0", color: "#aeb8c8", fontSize: "12px" }
    );

    panel.append(header, description, status, actions, note);
    (document.body || document.documentElement).appendChild(panel);

    state.panel = panel;
    state.status = status;
    state.active = true;
    window.__siteCapture = state;

    function collectExisting() {
      state.add(location.href);
      performance.getEntriesByType("resource").forEach(entry => state.add(entry.name));
    }

    collectExisting();
    updateCount();

    if ("PerformanceObserver" in window) {
      try {
        state.observer = new PerformanceObserver(list => {
          list.getEntries().forEach(entry => state.add(entry.name));
          updateCount();
        });
        state.observer.observe({ type: "resource", buffered: true });
      } catch (error) {
        console.warn("[WebsiteClientCloner] Resource observer unavailable:", error);
      }
    }

    panel.addEventListener("click", async event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;

      if (action === "hide") {
        panel.hidden = true;
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
        updateStatus("Watcher stopped. You can still save a ZIP of collected URLs.");
        stopButton.disabled = true;
        return;
      }
      if (action === "download") {
        collectExisting();
        downloadButton.disabled = true;
        refreshButton.disabled = true;
        stopButton.disabled = true;
        minimizeButton.disabled = true;
        try {
          await buildZip(updateStatus);
        } catch (error) {
          updateStatus("ZIP failed: " + (error?.message || String(error)));
          console.error("[WebsiteClientCloner] ZIP failed:", error);
        } finally {
          downloadButton.disabled = false;
          refreshButton.disabled = false;
          minimizeButton.disabled = false;
          stopButton.disabled = !state.observer;
        }
      }
    });

    console.info("[WebsiteClientCloner] Capture engine initialized.");
  } catch (error) {
    state.active = false;
    state.observer?.disconnect();
    console.error("[WebsiteClientCloner] Initialization failed:", error);
    alert("WebsiteClientCloner could not initialize: " + (error?.message || String(error)));
    return;
  }

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
    const isTouchDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const concurrency = isTouchDevice ? 2 : 4;

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