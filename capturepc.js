(() => {
  "use strict";

  if (window.WCC && window.WCC.version) {
    console.info("[WCC-PC] Already loaded. Use WCC.status() or WCC.stop().");
    return;
  }

  const VERSION = "2.0.0-pc";
  const config = {
    concurrency: 8,
    maxResourceBytes: 50 * 1024 * 1024,
    maxTotalBytes: 500 * 1024 * 1024,
    maxResources: 5000,
    includeSameOriginOnly: false
  };

  const resources = new Map();
  const saved = new Map();
  const failures = [];
  let observer = null;
  let running = false;
  let stopped = false;
  let totalBytes = 0;
  let completed = 0;
  let lastReport = 0;

  const log = {
    info: (...a) => console.info("[WCC-PC]", ...a),
    warn: (...a) => console.warn("[WCC-PC]", ...a),
    error: (...a) => console.error("[WCC-PC]", ...a)
  };

  function addResource(rawUrl, initiatorType) {
    try {
      const u = new URL(rawUrl, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      if (config.includeSameOriginOnly && u.origin !== location.origin) return;
      if (u.href === location.href) return;
      if (!resources.has(u.href) && resources.size < config.maxResources) {
        resources.set(u.href, {
          url: u.href,
          initiatorType: initiatorType || "unknown",
          discoveredAt: new Date().toISOString()
        });
      }
    } catch (_) {}
  }

  function scanExisting() {
    performance.getEntriesByType("resource").forEach((entry) => {
      addResource(entry.name, entry.initiatorType);
    });
  }

  function start() {
    if (running) return api;
    stopped = false;
    running = true;
    try { performance.setResourceTimingBufferSize(10000); } catch (_) {}
    scanExisting();
    if ("PerformanceObserver" in window) {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => addResource(entry.name, entry.initiatorType));
      });
      try {
        observer.observe({ type: "resource", buffered: true });
      } catch (e) {
        log.warn("Buffered PerformanceObserver unavailable; using current entries only.", e);
      }
    }
    log.info("Capture started on " + location.origin);
    log.info("Browse the site and interact with pages; then run WCC.exportZip().");
    log.info("Current observed resources: " + resources.size);
    return api;
  }

  function stop() {
    stopped = true;
    running = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    log.info("Observation stopped. Resources recorded: " + resources.size);
    return api;
  }

  function status() {
    const result = {
      version: VERSION,
      page: location.href,
      observing: running,
      observed: resources.size,
      saved: saved.size,
      failed: failures.length,
      downloadedBytes: totalBytes,
      config: { ...config }
    };
    console.table(result);
    return result;
  }

  function clear() {
    stop();
    resources.clear();
    saved.clear();
    failures.length = 0;
    totalBytes = 0;
    completed = 0;
    log.info("Capture data cleared.");
    return api;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function u16(view, offset, value) { view.setUint16(offset, value, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function safePath(url, seenPaths) {
    const u = new URL(url);
    let path = u.pathname || "/";
    path = path.split("/").map((part) => part.replace(/[\u0000-\u001f<>:"|?*\\]/g, "_")).join("/");
    if (path.endsWith("/")) path += "index.html";
    path = path.replace(/^\/+/, "");
    let base = u.host + "/" + path;
    if (u.search) {
      const dot = path.lastIndexOf(".");
      const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
      const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
      let hash = 2166136261;
      const key = u.search + u.hash;
      for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      base = u.host + "/.__url_variants__/" + stem + "." + (hash >>> 0).toString(16) + ext;
    }
    let candidate = base;
    let n = 2;
    while (seenPaths.has(candidate)) {
      const dot = base.lastIndexOf(".");
      candidate = dot > base.lastIndexOf("/") ? base.slice(0, dot) + "_" + n++ + base.slice(dot) : base + "_" + n++;
    }
    seenPaths.add(candidate);
    return candidate;
  }

  async function fetchOne(item, signal) {
    if (stopped || signal.aborted) return;
    if (saved.has(item.url)) return;
    try {
      const u = new URL(item.url);
      const response = await fetch(item.url, {
        method: "GET",
        mode: "cors",
        credentials: u.origin === location.origin ? "same-origin" : "omit",
        redirect: "follow",
        signal,
        cache: "default"
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      if (response.type === "opaque") throw new Error("Opaque response blocked by browser security");
      const blob = await response.blob();
      if (blob.size > config.maxResourceBytes) throw new Error("Resource exceeds per-file limit (" + blob.size + " bytes)");
      if (totalBytes + blob.size > config.maxTotalBytes) throw new Error("Total capture size limit reached");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      saved.set(item.url, {
        url: item.url,
        bytes,
        size: bytes.byteLength,
        type: response.headers.get("content-type") || blob.type || "application/octet-stream",
        status: response.status,
        initiatorType: item.initiatorType,
        path: null
      });
      totalBytes += bytes.byteLength;
    } catch (error) {
      failures.push({
        url: item.url,
        initiatorType: item.initiatorType,
        reason: String(error && error.message || error)
      });
    } finally {
      completed++;
      if (completed - lastReport >= 25) {
        lastReport = completed;
        log.info("Fetch progress: " + completed + "/" + resources.size + " | saved " + saved.size + " | " + (totalBytes / 1048576).toFixed(1) + " MiB");
      }
    }
  }

  async function fetchAll() {
    if (running) {
      log.warn("Stop observation before exporting to freeze the resource list. Calling WCC.stop() now.");
      stop();
    }
    const queue = Array.from(resources.values()).filter((r) => !saved.has(r.url));
    if (!queue.length) {
      log.info("No new resources to fetch.");
      return;
    }
    stopped = false;
    completed = 0;
    lastReport = 0;
    const controller = new AbortController();
    api._abortController = controller;
    let cursor = 0;
    const worker = async () => {
      while (!stopped && !controller.signal.aborted) {
        const index = cursor++;
        if (index >= queue.length) return;
        await fetchOne(queue[index], controller.signal);
      }
    };
    log.info("Fetching " + queue.length + " observed resources with concurrency " + config.concurrency + ".");
    await Promise.all(Array.from({ length: Math.min(config.concurrency, queue.length) }, worker));
    api._abortController = null;
    log.info("Fetch phase finished. Saved " + saved.size + ", failed " + failures.length + ", size " + (totalBytes / 1048576).toFixed(1) + " MiB.");
  }

  function makeZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const encoder = new TextEncoder();
    const now = dosDateTime(new Date());

    for (const file of files) {
      const nameBytes = encoder.encode(file.path);
      const data = file.bytes;
      if (data.byteLength > 0xffffffff || offset > 0xffffffff) {
        throw new Error("ZIP32 size limit reached. Split the capture into smaller archives.");
      }
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034b50);
      u16(lv, 4, 20);
      u16(lv, 6, 0x0800);
      u16(lv, 8, 0);
      u16(lv, 10, now.time);
      u16(lv, 12, now.date);
      u32(lv, 14, crc);
      u32(lv, 18, data.byteLength);
      u32(lv, 22, data.byteLength);
      u16(lv, 26, nameBytes.length);
      u16(lv, 28, 0);
      local.set(nameBytes, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014b50);
      u16(cv, 4, 20);
      u16(cv, 6, 20);
      u16(cv, 8, 0x0800);
      u16(cv, 10, 0);
      u16(cv, 12, now.time);
      u16(cv, 14, now.date);
      u32(cv, 16, crc);
      u32(cv, 20, data.byteLength);
      u32(cv, 24, data.byteLength);
      u16(cv, 28, nameBytes.length);
      u16(cv, 30, 0);
      u16(cv, 32, 0);
      u16(cv, 34, 0);
      u16(cv, 36, 0);
      u32(cv, 38, 0);
      u32(cv, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length + data.byteLength;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    u32(ev, 0, 0x06054b50);
    u16(ev, 4, 0);
    u16(ev, 6, 0);
    u16(ev, 8, files.length);
    u16(ev, 10, files.length);
    u32(ev, 12, centralSize);
    u32(ev, 16, offset);
    u16(ev, 20, 0);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  async function exportZip() {
    await fetchAll();
    const paths = new Set();
    const files = [];
    const manifest = {
      tool: "WebsiteClientCloner PC",
      version: VERSION,
      sourcePage: location.href,
      createdAt: new Date().toISOString(),
      note: "This archive contains only resources observed by the page and fetchable under the browser's security rules. It is not a complete runnable copy of the site.",
      saved: [],
      failed: failures
    };

    for (const item of saved.values()) {
      item.path = safePath(item.url, paths);
      files.push({ path: item.path, bytes: item.bytes });
      manifest.saved.push({
        url: item.url,
        path: item.path,
        bytes: item.size,
        contentType: item.type,
        status: item.status,
        initiatorType: item.initiatorType
      });
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    files.push({ path: "websiteclientcloner-manifest.json", bytes: manifestBytes });
    const zip = makeZip(files);
    const blobUrl = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "websiteclientcloner-pc-" + new Date().toISOString().replace(/[:.]/g, "-") + ".zip";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    log.info("ZIP download started: " + files.length + " files, " + (zip.size / 1048576).toFixed(1) + " MiB.");
    return { files: files.length, bytes: zip.size, failures: failures.length };
  }

  const api = {
    version: VERSION,
    config,
    start,
    stop,
    status,
    clear,
    exportZip,
    list: () => Array.from(resources.values()),
    failures: () => failures.slice(),
    abort: () => {
      stopped = true;
      if (api._abortController) api._abortController.abort();
      log.warn("Active fetch work aborted.");
    },
    _abortController: null,
    show: () => { createPanel(); if (panelHost) panelHost.style.display = "block"; refreshPanel(); },
    hide: () => { if (panelHost) panelHost.style.display = "none"; }
  };


  let panelHost = null;
  let panelRoot = null;

  function createPanel() {
    if (panelHost && panelHost.isConnected) return;
    panelHost = document.createElement("div");
    panelHost.id = "wcc-pc-overlay";
    panelHost.style.cssText = "all:initial;position:fixed;right:22px;bottom:22px;z-index:2147483647;";
    panelRoot = panelHost.attachShadow({mode:"open"});
    panelRoot.innerHTML = '<style>*{box-sizing:border-box}.panel{width:320px;color:#e8edf5;background:#111827;border:1px solid #344256;border-radius:13px;box-shadow:0 14px 45px #0008;font:13px/1.45 system-ui,sans-serif;overflow:hidden}.top{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#172235;border-bottom:1px solid #2a394d;cursor:move;user-select:none}.brand{font-weight:700;letter-spacing:.2px}.version{color:#8fa2bb;font-size:10px;margin-left:7px}.minimize{border:0;background:transparent;color:#b8c6d8;font-size:18px;cursor:pointer}.body{padding:13px 14px 14px}.status{display:flex;align-items:center;gap:8px;color:#a9b8ca;font-size:12px;margin-bottom:12px}.lamp{width:8px;height:8px;border-radius:50%;background:#64748b}.status.live .lamp{background:#34d399;box-shadow:0 0 9px #34d39988}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px}.stat{background:#1b293b;border:1px solid #2b3b50;border-radius:9px;padding:9px 8px}.stat strong{display:block;font-size:19px;color:#f8fafc}.stat span{display:block;color:#91a4bb;font-size:10px}.meter{height:5px;background:#26364b;border-radius:9px;overflow:hidden;margin:7px 0}.meter span{display:block;height:100%;width:0;background:linear-gradient(90deg,#38bdf8,#34d399);transition:width .2s}.hint{min-height:18px;color:#91a4bb;font-size:11px;margin:9px 0 12px;overflow-wrap:anywhere}.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}button.action{border:1px solid #3a4b61;border-radius:8px;padding:9px 10px;background:#23344a;color:#e8edf5;font:600 12px system-ui,sans-serif;cursor:pointer}button.action:hover{background:#30465f}button.primary{background:#087eaa;border-color:#0ea5d5;color:white}button.action:disabled{opacity:.45;cursor:not-allowed}.foot{display:flex;justify-content:space-between;margin-top:11px;color:#71849c;font-size:10px}.hide{border:0;padding:0;color:#7dd3fc;background:transparent;cursor:pointer;font:inherit}.collapsed .body{display:none}@media(max-width:420px){.panel{width:min(320px,calc(100vw - 24px))}}</style><section class="panel"><header class="top"><div class="brand">● WebsiteClientCloner <span class="version">PC</span></div><button class="minimize" title="Minimize">−</button></header><div class="body"><div class="status"><i class="lamp"></i><span class="state">Ready to capture</span></div><div class="stats"><div class="stat"><strong class="observed">0</strong><span>Observed</span></div><div class="stat"><strong class="saved">0</strong><span>Saved</span></div><div class="stat"><strong class="failed">0</strong><span>Unavailable</span></div></div><div class="meter"><span></span></div><div class="hint">Browse this site while capture is active, then build your ZIP.</div><div class="actions"><button class="action start">Start capture</button><button class="action stop">Stop capture</button><button class="action primary export">Build ZIP</button><button class="action clear">Clear data</button></div><div class="foot"><span class="size">0 B saved</span><button class="hide">Hide panel</button></div></div></section>';

    const $ = (selector) => panelRoot.querySelector(selector);
    const panel = $(".panel");
    $(".start").addEventListener("click", () => { start(); refreshPanel(); });
    $(".stop").addEventListener("click", () => { stop(); refreshPanel(); });
    $(".export").addEventListener("click", async () => {
      $(".export").disabled = true;
      $(".hint").textContent = "Fetching resources and building ZIP…";
      try { await exportZip(); }
      catch (error) { log.error("ZIP export failed:", error); $(".hint").textContent = "Export failed: " + (error.message || error); }
      finally { $(".export").disabled = false; refreshPanel(); }
    });
    $(".clear").addEventListener("click", () => {
      if (confirm("Clear all observed URLs and captured data?")) { clear(); refreshPanel(); }
    });
    $(".minimize").addEventListener("click", () => panel.classList.toggle("collapsed"));
    $(".top").addEventListener("dblclick", () => panel.classList.toggle("collapsed"));
    $(".hide").addEventListener("click", () => { panelHost.style.display = "none"; });

    let drag = null;
    $(".top").addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panelHost.getBoundingClientRect();
      drag = {x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      $(".top").setPointerCapture(event.pointerId);
    });
    $(".top").addEventListener("pointermove", (event) => {
      if (!drag) return;
      panelHost.style.left = Math.max(0,Math.min(innerWidth-panelHost.offsetWidth,drag.left+event.clientX-drag.x))+"px";
      panelHost.style.top = Math.max(0,Math.min(innerHeight-48,drag.top+event.clientY-drag.y))+"px";
      panelHost.style.right = "auto";
      panelHost.style.bottom = "auto";
    });
    $(".top").addEventListener("pointerup", () => {drag=null;});
    $(".top").addEventListener("pointercancel", () => {drag=null;});
    (document.documentElement || document.body).appendChild(panelHost);
    refreshPanel();
    setInterval(refreshPanel,700);
  }

  function refreshPanel() {
    if (!panelRoot || !panelHost || !panelHost.isConnected) return;
    const $ = (selector) => panelRoot.querySelector(selector);
    const observed=resources.size, savedCount=saved.size, failedCount=failures.length;
    $(".observed").textContent=observed.toLocaleString();
    $(".saved").textContent=savedCount.toLocaleString();
    $(".failed").textContent=failedCount.toLocaleString();
    $(".size").textContent=formatBytes(totalBytes)+" saved";
    const fetching=!!api._abortController;
    $(".state").textContent=fetching?"Building archive…":running?"Capture is running":"Capture is paused";
    $(".status").classList.toggle("live",running||fetching);
    $(".meter span").style.width=(fetching&&observed?Math.min(100,completed/observed*100):observed?Math.min(100,savedCount/observed*100):0)+"%";
    $(".start").disabled=running||fetching;
    $(".stop").disabled=!running||fetching;
    $(".export").disabled=fetching||observed===0;
    $(".clear").disabled=fetching;
    if(fetching) $(".hint").textContent="Processed "+completed+" of "+observed+" resources…";
    else if(!observed) $(".hint").textContent="Browse this site while capture is active, then build your ZIP.";
    else $(".hint").textContent=savedCount+" saved, "+failedCount+" unavailable. Select Build ZIP to export.";
  }

  function formatBytes(bytes) {
    if(!bytes) return "0 B";
    const units=["B","KB","MB","GB"];
    const index=Math.min(units.length-1,Math.floor(Math.log(bytes)/Math.log(1024)));
    return (bytes/Math.pow(1024,index)).toFixed(index?1:0)+" "+units[index];
  }

  Object.defineProperty(window, "WCC", {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false
  });

  createPanel();
  start();
  log.info("PC console edition " + VERSION + " ready.");
  log.info("Commands: WCC.status(), WCC.stop(), WCC.exportZip(), WCC.abort(), WCC.clear()");
})();
