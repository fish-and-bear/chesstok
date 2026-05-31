import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const PUZZLE_BUDGET_BYTES = 1_200_000;

checkRequiredFiles();
checkSyntax("app.js");
checkSyntax("service-worker.js");
checkSyntax("worker.js");
checkSyntax("tools/build-public.mjs");
checkSyntax("tools/build-shard.mjs");
checkSyntax("tools/perf-audit.mjs");
checkJson("package.json");
checkJson("manifest.webmanifest");
checkJson("vercel.json");
checkJson("wrangler.jsonc");
await checkPuzzleShard();
checkIndex();
checkSocialAssets();
checkServiceWorker();
checkSecurityHeaders();
checkSourceHygiene();
checkDocs();

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Release check passed.");

function checkRequiredFiles() {
  for (const file of [
    "index.html",
    "app.js",
    "styles.css",
    "service-worker.js",
    "worker.js",
    "wrangler.jsonc",
    ".assetsignore",
    "manifest.webmanifest",
    "icon.svg",
    "icon-192.png",
    "icon-512.png",
    "social-card-v3.png",
    "pieces.svg",
    "puzzles.js",
    "vendor/chess.mjs",
    "LICENSE",
    "NOTICE",
    "README.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "DEPLOYMENT.md",
    "_headers",
    "vercel.json",
    "tools/build-public.mjs",
    "tools/build-shard.mjs",
    "tools/perf-audit.mjs",
    "tools/verify-release.mjs"
  ]) {
    if (!fs.existsSync(resolve(file))) fail(`Missing ${file}`);
  }
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ["--check", resolve(file)], { encoding: "utf8" });
  if (result.status !== 0) fail(`${file} has a JavaScript syntax error:\n${result.stderr.trim()}`);
}

function checkJson(file) {
  try {
    JSON.parse(read(file));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
}

async function checkPuzzleShard() {
  try {
    const size = fs.statSync(resolve("puzzles.js")).size;
    if (size > PUZZLE_BUDGET_BYTES) fail(`puzzles.js is ${size} bytes; budget is ${PUZZLE_BUDGET_BYTES}`);

    const moduleUrl = `${pathToFileURL(resolve("puzzles.js")).href}?verify=${Date.now()}`;
    const { PUZZLES } = await import(moduleUrl);
    if (!Array.isArray(PUZZLES)) {
      fail("puzzles.js does not export a PUZZLES array");
      return;
    }
    if (PUZZLES.length < 10000) fail(`Puzzle shard has ${PUZZLES.length} puzzles; expected at least 10000`);

    const ids = new Set();
    for (const [index, puzzle] of PUZZLES.entries()) {
      const normalized = normalizePuzzle(puzzle);
      if (!normalized.id || ids.has(normalized.id)) fail(`Puzzle ${index} has a missing or duplicate id`);
      ids.add(normalized.id);
      if (!normalized.fen || !normalized.moves || !Number.isFinite(normalized.rating)) fail(`Puzzle ${normalized.id || index} is missing core fields`);
      if (index > 200) break;
    }
  } catch (error) {
    fail(`Could not import puzzles.js: ${error.message}`);
  }
}

function normalizePuzzle(puzzle) {
  if (Array.isArray(puzzle)) {
    return {
      id: puzzle[0],
      fen: puzzle[1],
      moves: puzzle[2],
      rating: puzzle[3]
    };
  }

  return {
    id: puzzle?.id,
    fen: puzzle?.fen,
    moves: puzzle?.moves,
    rating: puzzle?.rating
  };
}

function checkIndex() {
  const index = read("index.html");
  const appVersion = matchVersion(index, "app.js");
  const cssVersion = matchVersion(index, "styles.css");
  if (!appVersion || !cssVersion) fail("index.html must cache-bust app.js and styles.css");
  if (appVersion !== cssVersion) fail("app.js and styles.css versions should match in index.html");

  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'"
  ]) {
    if (!index.includes(directive)) fail(`index.html CSP is missing ${directive}`);
  }

  for (const token of [
    '<meta name="description"',
    '<link rel="canonical" href="https://angelicanaguio.com/chesstok/">',
    'property="og:title"',
    'property="og:description"',
    'property="og:image" content="https://angelicanaguio.com/chesstok/social-card-v3.png"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:image" content="https://angelicanaguio.com/chesstok/social-card-v3.png"',
    '<link rel="apple-touch-icon" href="./icon-192.png">'
  ]) {
    if (!index.includes(token)) fail(`index.html is missing social/SEO token: ${token}`);
  }

  const title = index.match(/<title>([^<]+)<\/title>/)?.[1] || "";
  const description = index.match(/<meta name="description" content="([^"]+)">/)?.[1] || "";
  if (title.length < 20 || title.length > 60) fail(`SEO title length should be 20-60 characters, got ${title.length}`);
  if (description.length < 70 || description.length > 160) {
    fail(`SEO description length should be 70-160 characters, got ${description.length}`);
  }
  if (/unlock|supercharge|seamless|transform|elevate|powerful/i.test(`${title} ${description}`)) {
    fail("SEO copy contains generic marketing language");
  }
}

function checkSocialAssets() {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const file of ["icon-192.png", "icon-512.png", "social-card-v3.png"]) {
    const buffer = fs.readFileSync(resolve(file));
    if (!buffer.subarray(0, 4).equals(pngSignature)) fail(`${file} is not a PNG`);
  }
  if (fs.statSync(resolve("social-card-v3.png")).size > 500_000) fail("social-card-v3.png should stay under 500KB");
  if (!read("manifest.webmanifest").includes("icon-192.png")) fail("manifest should include icon-192.png");
  if (!read("manifest.webmanifest").includes("icon-512.png")) fail("manifest should include icon-512.png");
}

function checkServiceWorker() {
  const index = read("index.html");
  const sw = read("service-worker.js");
  const appVersion = matchVersion(index, "app.js");
  const cssVersion = matchVersion(index, "styles.css");
  if (!sw.includes(`app.js?v=${appVersion}`)) fail("service worker cache does not match app.js version");
  if (!sw.includes(`styles.css?v=${cssVersion}`)) fail("service worker cache does not match styles.css version");
  if (!sw.includes("icon-192.png") || !sw.includes("icon-512.png")) fail("service worker should cache PNG app icons");
  if (!sw.includes("ASSET_URLS")) fail("service worker should only cache known assets");
  if (!sw.includes("navigationPreload")) fail("service worker should enable navigation preload");
  if (!sw.includes("response.ok") || !sw.includes('response.type === "basic"')) {
    fail("service worker should only store successful same-origin asset responses");
  }

  const worker = read("worker.js");
  if (!worker.includes('const PREFIX = "/chesstok"')) fail("worker.js should serve the app from /chesstok");
  if (!worker.includes("chesstok.pages.dev")) fail("worker.js should proxy the Cloudflare Pages project");

  const assetMatches = [...sw.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  for (const asset of assetMatches.filter((item) => item.startsWith("./"))) {
    const clean = asset.replace(/^\.\//, "").replace(/\?.*$/, "") || "index.html";
    if (clean !== "." && !fs.existsSync(resolve(clean))) fail(`service-worker.js references missing asset ${asset}`);
  }
}

function checkSecurityHeaders() {
  const headers = read("_headers");
  const worker = read("worker.js");
  const vercel = read("vercel.json");
  const required = [
    "Content-Security-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "X-Permitted-Cross-Domain-Policies",
    "X-DNS-Prefetch-Control",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Origin-Agent-Cluster",
    "Strict-Transport-Security",
    "Permissions-Policy"
  ];

  for (const header of required) {
    if (!headers.includes(header)) fail(`_headers is missing ${header}`);
    if (!worker.includes(header)) fail(`worker.js is missing ${header}`);
    if (!vercel.includes(header)) fail(`vercel.json is missing ${header}`);
  }
}

function checkSourceHygiene() {
  const app = read("app.js");
  const index = read("index.html");
  const styles = read("styles.css");

  for (const blocked of ["innerHTML", "outerHTML", "insertAdjacentHTML", "eval(", "new Function"]) {
    if (app.includes(blocked)) fail(`app.js should not use ${blocked}`);
  }

  for (const stale of [
    "rankLabel",
    "questLabel",
    "progressLabel",
    "intentLabel",
    "move-rush-v8",
    "?v=8",
    "move-rush-v13",
    "?v=13",
    "move-rush-v14",
    "?v=14",
    "move-rush-v15",
    "?v=15",
    "move-rush-v16",
    "?v=16",
    "move-rush-v17",
    "?v=17",
    "move-rush-v18",
    "?v=18",
    "move-rush-v19",
    "?v=19",
    "move-rush-v20",
    "?v=20",
    "move-rush-v21",
    "?v=21",
    "move-rush-v22",
    "?v=22"
  ]) {
    if (`${app}\n${index}\n${styles}\n${read("service-worker.js")}\n${read("_headers")}`.includes(stale)) {
      fail(`Found stale UI/build token ${stale}`);
    }
  }

  if (!read("vendor/chess.mjs").includes("Copyright (c) 2025, Jeff Hlywa")) fail("vendor/chess.mjs license notice is missing");
}

function checkDocs() {
  const notice = read("NOTICE");
  const readme = read("README.md");
  const pkg = JSON.parse(read("package.json"));
  if (!notice.includes("CC0") || !notice.includes("database.lichess.org")) fail("NOTICE must attribute the Lichess CC0 puzzle source");
  if (!notice.includes("BSD-2-Clause")) fail("NOTICE must mention the chess.js BSD-2-Clause license");
  if (!pkg.scripts?.build?.includes("build-public")) fail("package.json should expose npm run build");
  if (!pkg.scripts?.perf?.includes("perf-audit")) fail("package.json should expose npm run perf");
  if (!readme.includes("npm run check")) fail("README should document the release check");
  if (!readme.includes("npm run perf")) fail("README should document the performance audit");
  if (!readme.includes("server-side scoring")) fail("README should state the client-side anti-cheat limit");
}

function matchVersion(text, asset) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`${escaped}\\?v=(\\d+)`))?.[1] || "";
}

function read(file) {
  return fs.readFileSync(resolve(file), "utf8");
}

function resolve(file) {
  return path.join(root, file);
}

function fail(message) {
  errors.push(message);
}
