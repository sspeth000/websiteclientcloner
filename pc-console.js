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
    _abortController: null
  };

  Object.defineProperty(window, "WCC", {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false
  });

  start();
  log.info("PC console edition " + VERSION + " ready.");
  log.info("Commands: WCC.status(), WCC.stop(), WCC.exportZip(), WCC.abort(), WCC.clear()");
})();