const s = document.createElement("script");
s.src = "https://raw.githubusercontent.com/sspeth000/websiteclientcloner/main/capture.js";
s.onload = () => console.info("[WebsiteClientCloner] Capture loader started.");
s.onerror = () => console.error("[WebsiteClientCloner] Could not load capture.js.");
document.documentElement.appendChild(s);