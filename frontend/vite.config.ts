import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), basicSsl()],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
