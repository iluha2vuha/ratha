import { Capacitor } from "@capacitor/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, readTheme } from "./theme";
import "./index.css";

applyTheme(readTheme());

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
