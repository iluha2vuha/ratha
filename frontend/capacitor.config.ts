import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ratha.planner",
  appName: "Ratha",
  webDir: "dist-android",
  backgroundColor: "#fff9f1",
  plugins: {
    SystemBars: {
      // The app opens in its light theme; keep status bar icons dark on the cream background.
      style: "LIGHT",
    },
  },
};

export default config;
