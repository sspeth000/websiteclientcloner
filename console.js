const script = document.createElement("script");
script.src = "https://github.com/sspeth000/websiteclientcloner/raw/refs/heads/main/capture.js";
script.onload = () => console.info("[WebsiteClientCloner] Capture loader started.");
script.onerror = () => console.error("[WebsiteClientCloner] GitHub did not deliver capture.js. Check the browser's Console and Network panels for the actual CSP, redirect, or network error.");
(document.head || document.documentElement).appendChild(script);
