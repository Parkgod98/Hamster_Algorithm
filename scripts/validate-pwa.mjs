import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(`PWA validation failed: ${message}`);
};

const manifest = read("src/app/manifest.ts");
const layout = read("src/app/layout.tsx");
const sw = read("public/sw.js");

assert(manifest.includes('start_url: "/dashboard"'), "manifest start_url must open the dashboard");
assert(manifest.includes('display: "standalone"'), "manifest display must be standalone");
assert(manifest.includes('scope: "/"'), "manifest scope must cover the application");
assert(manifest.includes("/icon-192.png") && manifest.includes("/icon-512.png"), "manifest PNG icons are required");
assert(layout.includes("appleWebApp") && layout.includes("/apple-touch-icon.png"), "iOS web app metadata and Apple touch icon are required");
assert(fs.existsSync(path.join(root, "public/icon-192.png")), "192px icon is missing");
assert(fs.existsSync(path.join(root, "public/icon-512.png")), "512px icon is missing");
assert(fs.existsSync(path.join(root, "public/apple-touch-icon.png")), "Apple touch icon is missing");
assert(sw.includes('url.pathname.startsWith("/api/")'), "service worker must explicitly bypass API caching");
assert(sw.includes('request.mode === "navigate"'), "service worker must keep navigation network-first");
assert(sw.includes('addEventListener("push"'), "service worker must handle Web Push events");
assert(sw.includes('addEventListener("notificationclick"'), "service worker must handle notification clicks");
assert(sw.includes("showNotification"), "service worker must display push notifications");
assert(!sw.includes("cache.addAll(['/','/dashboard'])"), "authenticated application shell must not be precached");

console.log("PWA validation passed.");
