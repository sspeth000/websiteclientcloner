# WebsiteClientCloner

A browser-side website resource capture prototype. It records HTTP(S) resource URLs observed by the current page, then attempts to fetch the response bodies into a ZIP while preserving origin and URL-path hierarchy.

## Files

- `capture.js` - original mobile-oriented capture panel and engine.
- `bookmarklet.txt` - original bookmarklet loader.
- `console.js` - original console loader.
- `pc-console.js` - standalone PC-focused console capture engine.
- `pc-console-loader.js` - small loader for the PC console engine.

## PC console edition

The PC edition is designed for desktop Chromium-based browsers and other browsers that support the required web APIs. It runs without a capture panel and exposes a small console API.

### Use

1. Open a website you own or are authorized to capture.
2. Open Developer Tools and select the Console.
3. Paste the complete contents of `pc-console-loader.js` into the console and run it.
4. Browse the site and interact with the pages you want to include.
5. Run `WCC.status()` to inspect capture progress.
6. Run `WCC.stop()` to stop observing new resources.
7. Run `await WCC.exportZip()` to fetch accessible resources and download the ZIP.

### Console commands

- `WCC.start()` - begin observing resource loads.
- `WCC.stop()` - stop observing new resource loads.
- `WCC.status()` - print capture statistics and current configuration.
- `WCC.list()` - return the observed resource list.
- `WCC.failures()` - return resources that could not be fetched.
- `await WCC.exportZip()` - fetch observed resources and build the ZIP.
- `WCC.abort()` - abort active fetch work.
- `WCC.clear()` - clear collected capture data.

Configuration can be changed through `WCC.config` before export:

- `concurrency` - parallel fetch workers (default 8).
- `maxResourceBytes` - per-resource size limit (default 50 MiB).
- `maxTotalBytes` - total saved response size limit (default 500 MiB).
- `maxResources` - maximum observed resource count (default 5,000).
- `includeSameOriginOnly` - when true, ignore cross-origin URLs.

The PC edition uses a fast, uncompressed ZIP format to reduce CPU overhead. It keeps resource bytes unchanged and includes `websiteclientcloner-manifest.json` with original URLs, archive paths, response metadata, and fetch failures.

## Original mobile-oriented edition

The original capture panel is designed for touch screens and mobile Safari: large tap targets, safe-area spacing, a compact layout, reduced fetch concurrency on phones/tablets, and ZIP generation without CPU-heavy compression. On iPad/iPhone, Safari may handle the generated ZIP through its normal download flow. Keep the page open while the capture is running. Very large captures can still exceed available device memory because the ZIP is assembled in the page.

## Original use

1. Open the page you are authorized to capture.
2. Run the bookmarklet, or paste the contents of `console.js` into that page's developer console.
3. Browse and interact with the page so its additional resources are observed.
4. Choose **Build ZIP** in the capture panel.
5. Inspect `websiteclientcloner-manifest.json` in the ZIP for saved URLs and resources the browser refused to fetch.

The archive uses the resource's hostname followed by its URL path. The manifest maps each original URL to its archive path. Query-string collisions are stored under `.__url_variants__` so distinct URLs do not silently overwrite each other.

## Important limitations

This is a prototype, not a full browser/network recorder:

- It can only save response bodies that page JavaScript is permitted to fetch. Cross-origin resources without suitable CORS permission, opaque responses, and browser-internal resources may be unavailable.
- It observes resources requested while capture is running. Browse/interact first, then build the ZIP. It does not enumerate a server's private folders, discover unrequested files, or preserve empty directories that were never exposed.
- The Resource Timing API has a finite buffer. The PC edition raises the buffer limit and observes new resource entries, but an extremely busy page can still exceed it.
- It does not capture every request header, cookie, service-worker state, WebSocket conversation, browser cache entry, or server-side behavior.
- A ZIP is an archive, not a running copy of the original site. Dynamic APIs, authentication, and live backend behavior may still require the original service.
- The PC edition uses browser fetch permissions only. It does not bypass authentication, CORS, or other access controls.
- ZIP32 has per-entry and archive size limits. Keep exports below 4 GiB and use smaller captures when needed.
- Use it only for sites and content you have permission to capture.

Captured response bodies are stored without content rewriting. ZIP storage is lossless.
