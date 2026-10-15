// Builds an installable debug APK at android/app/build/outputs/apk/debug/app-debug.apk.
// The phone cannot use the Vite proxy, so the backend address is compiled in from
// VITE_API_BASE_URL (environment variable or frontend/.env.android).
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const androidDir = join(frontendDir, "android");
const windows = process.platform === "win32";

const apiBaseUrl = loadEnv("android", frontendDir, "VITE_").VITE_API_BASE_URL?.trim();
if (!apiBaseUrl || !/^https?:\/\/[^/]/.test(apiBaseUrl)) {
  console.error(
    "Set VITE_API_BASE_URL to the backend address the phone can reach, for example\n" +
      "  VITE_API_BASE_URL=http://192.168.1.20:8000\n" +
      "in frontend/.env.android, or as an environment variable for this command.",
  );
  process.exit(1);
}

const localProperties = join(androidDir, "local.properties");
if (!existsSync(localProperties)) {
  const sdk = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    windows ? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk") : null,
    join(homedir(), "Library", "Android", "sdk"),
    join(homedir(), "Android", "Sdk"),
  ].find((dir) => dir && existsSync(join(dir, "platform-tools")));
  if (sdk) writeFileSync(localProperties, `sdk.dir=${sdk.replaceAll("\\", "/")}\n`);
}

function run(command, args, cwd = frontendDir) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: windows });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["tsc"]);
run("npx", ["vite", "build", "--mode", "android", "--outDir", "dist-android"]);
run("npx", ["cap", "sync", "android"]);
// `sh gradlew` still works when a Windows checkout dropped the executable bit.
run(windows ? "gradlew.bat" : "sh", windows ? ["assembleDebug"] : ["gradlew", "assembleDebug"], androidDir);

console.log(`\nAPK: ${join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk")}`);
console.log(`Backend: ${apiBaseUrl}`);
