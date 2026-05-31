import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const item of [
  "index.html",
  "app.js",
  "styles.css",
  "service-worker.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "social-card-v4.png",
  "pieces.svg",
  "puzzles.js",
  "_headers"
]) {
  copy(item);
}

copy("vendor", { recursive: true });

console.log("Built dist/");

function copy(relativePath, options = {}) {
  fs.cpSync(path.join(root, relativePath), path.join(dist, relativePath), {
    recursive: Boolean(options.recursive)
  });
}
