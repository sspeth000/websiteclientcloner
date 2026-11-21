# WebsiteClientCloner

A browser-side website resource capture prototype. It records HTTP(S) resource URLs observed by the current page, then attempts to fetch the response bodies into a ZIP while preserving origin and URL-path hierarchy.

## Files

- `capture.js` - injects the capture panel and runs the capture.
- `bookmarklet.txt` - bookmarklet loader. Save its complete contents as a browser bookmark URL.
- `console.js` - loader snippet for the browser developer console.

## Use

1. Open the page you are authorized to capture.
2. Run the bookmarklet, or paste the contents of `console.js` into that page's developer console.
3. Browse and interact with the page so its additional resources are observed.
4. Choose **Build ZIP** in the capture panel.
5. Inspect `websiteclientcloner-manifest.json` in the ZIP for saved URLs and resources the browser refused to fetch.

The archive uses the resource's hostname followed by its URL path. The manifest maps each original URL to its archive path. Query-string collisions are stored under `.__url_variants__` so distinct URLs do not silently overwrite each other.

## Important limitations

This is a prototype, not a full browser/network recorder:

- It can only save response bodies that page JavaScript is permitted to fetch. Cross-origin resources without suitable CORS permission, opaque responses, and browser-internal resources may be unavailable.
- It observes resources requested while the capture is running. Browse/interact first, then build the ZIP. It does not enumerate a server's private folders, discover unrequested files, or preserve empty directories that were never exposed.
- It does not capture every request header, cookie, service-worker state, WebSocket conversation, browser cache entry, or server-side behavior.
- A ZIP is an archive, not a running copy of the original site. Dynamic APIs, authentication, and live backend behavior may still require the original service.
- Use it only for sites and content you have permission to capture. It does not bypass authentication, CORS, or other access controls.

Captured response bodies are stored without content rewriting. ZIP compression is lossless.
