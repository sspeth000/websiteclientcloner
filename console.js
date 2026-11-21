(() => {
  const script = document.createElement("script");
  script.src = "https://raw.githubusercontent.com/sspeth000/websiteclientcloner/main/capture.js";
  script.onload = () => console.info("[WebsiteClientCloner] Capture engine loaded.");
  script.onerror = () => console.error("[WebsiteClientCloner] Failed to load capture.js from raw.githubusercontent.com. Check the Network panel for the exact request error.");
  (document.head || document.documentElement).appendChild(script);
})();