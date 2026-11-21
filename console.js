const script = document.createElement("script");
script.src = "https://raw.githubusercontent.com/sspeth000/websiteclientcloner/main/capture.js";
script.onload = () => console.info("[WebsiteClientCloner] Capture loader started.");
script.onerror = () => console.error("[WebsiteClientCloner] Failed to load capture.js from GitHub. Check the URL or the page's Content Security Policy.");
(document.head || document.documentElement).appendChild(script);
