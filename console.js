(() => {
  const sources = [
    "https://cdn.jsdelivr.net/gh/sspeth000/websiteclientcloner@main/capture.js",
    "https://raw.githubusercontent.com/sspeth000/websiteclientcloner/main/capture.js"
  ];
  let index = 0;
  const loadNext = () => {
    if (index >= sources.length) {
      console.error("[WebsiteClientCloner] Both script hosts failed. The page may block injected scripts with Content Security Policy, or the network may be blocking the hosts.");
      return;
    }
    const script = document.createElement("script");
    script.src = sources[index++];
    script.onload = () => console.info("[WebsiteClientCloner] Capture loader started from", script.src);
    script.onerror = () => {
      console.warn("[WebsiteClientCloner] Could not load:", script.src);
      loadNext();
    };
    (document.head || document.documentElement).appendChild(script);
  };
  loadNext();
})();