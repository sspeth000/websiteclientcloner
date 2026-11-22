(() => {
  const script = document.createElement("script");
  script.src = "https://raw.githubusercontent.com/sspeth000/websiteclientcloner/main/pc-console.js";
  script.onload = () => console.info("[WCC-PC] PC console edition loaded.");
  script.onerror = () => console.error("[WCC-PC] Could not load pc-console.js. Check the Network panel and the page's Content Security Policy.");
  (document.head || document.documentElement).appendChild(script);
})();