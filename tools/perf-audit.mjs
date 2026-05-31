import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appPort = 8890 + Math.floor(Math.random() * 600);
const debugPort = 9500 + Math.floor(Math.random() * 600);
const errors = [];
const viewports = [
  { name: "phone-small", width: 320, height: 568, scale: 2, mobile: true },
  { name: "phone-small-css", width: 320, height: 568, scale: 1, mobile: false },
  { name: "phone", width: 390, height: 844, scale: 2, mobile: true },
  { name: "phone-wide", width: 549, height: 900, scale: 2, mobile: true },
  { name: "tablet", width: 768, height: 1024, scale: 2, mobile: true },
  { name: "desktop", width: 1280, height: 800, scale: 1, mobile: false }
];

const server = spawn("python3", ["-m", "http.server", String(appPort), "--bind", "127.0.0.1", "--directory", root], {
  stdio: "ignore"
});

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/chesstok-perf-${Date.now()}`,
  "about:blank"
], { stdio: "ignore" });

try {
  const puzzleBytes = fs.statSync(path.join(root, "puzzles.js")).size;
  if (puzzleBytes > 1_200_000) errors.push(`puzzles.js is ${puzzleBytes} bytes; budget is 1200000`);
  const assetBytes = {
    app: fs.statSync(path.join(root, "app.js")).size,
    css: fs.statSync(path.join(root, "styles.css")).size,
    worker: fs.statSync(path.join(root, "service-worker.js")).size,
    pieces: fs.statSync(path.join(root, "pieces.svg")).size
  };
  const assetBudgets = {
    app: 72_000,
    css: 32_000,
    worker: 5_000,
    pieces: 32_000
  };
  for (const [asset, bytes] of Object.entries(assetBytes)) {
    if (bytes > assetBudgets[asset]) errors.push(`${asset} asset is ${bytes} bytes; budget is ${assetBudgets[asset]}`);
  }

  const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const pageInfo = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(pageInfo.webSocketDebuggerUrl || version.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitForHttp(`http://127.0.0.1:${appPort}/`);

  const results = [];
  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.scale,
      mobile: viewport.mobile
    });
    await cdp
      .send("Storage.clearDataForOrigin", {
        origin: `http://127.0.0.1:${appPort}`,
        storageTypes: "all"
      })
      .catch(() => {});

    await navigate(cdp, `http://127.0.0.1:${appPort}/?perf=${Date.now()}-${viewport.name}`);
    await waitReady(cdp);

    const before = await evaluate(cdp, snapshotExpression());
    const jump = await evaluate(cdp, `new Promise((resolve) => {
      const feed = document.querySelector("#feed");
      feed.scrollTop = feed.clientHeight * 500;
      feed.dispatchEvent(new Event("scroll"));
      setTimeout(() => resolve((${snapshotExpression()})), 380);
    })`);

    if (before.perf.readyMs > 5000) errors.push(`${viewport.name}: ready took ${before.perf.readyMs}ms; budget is 5000ms`);
    if (before.perf.version !== "54" || jump.perf.version !== "54") errors.push(`${viewport.name}: loaded app version is not 54`);
    if (before.reels > 4) errors.push(`${viewport.name}: initial live reels ${before.reels}; budget is 4`);
    if (jump.reels > 7) errors.push(`${viewport.name}: jump live reels ${jump.reels}; budget is 7`);
    if (jump.boards > 7) errors.push(`${viewport.name}: jump live boards ${jump.boards}; budget is 7`);
    if (jump.nodes > 2100) errors.push(`${viewport.name}: jump DOM nodes ${jump.nodes}; budget is 2100`);
    if (before.boardClipped || jump.boardClipped) errors.push(`${viewport.name}: board is clipped`);
    if (before.railClipped || jump.railClipped) errors.push(`${viewport.name}: action rail is clipped`);
    if (before.railOverlapsBoard || jump.railOverlapsBoard) errors.push(`${viewport.name}: action rail overlaps the board`);
    if (!before.clockText || !jump.clockText) errors.push(`${viewport.name}: streak clock text is missing`);
    if (!before.xpText || !jump.xpText) errors.push(`${viewport.name}: XP meter text is missing`);
    if (before.xpClipped || jump.xpClipped) errors.push(`${viewport.name}: XP meter is clipped`);
    if (before.hudClipped || jump.hudClipped) errors.push(`${viewport.name}: HUD is clipped`);
    if (viewport.width <= 640 && (before.boardCenterOffset > 1 || jump.boardCenterOffset > 1)) {
      errors.push(`${viewport.name}: board is ${Math.max(before.boardCenterOffset, jump.boardCenterOffset)}px off center`);
    }
    if (jump.active !== "500") errors.push(`${viewport.name}: jump landed on puzzle ${jump.active}; expected 500`);

    results.push({ viewport, before, jump });
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  const adaptiveLow = await adaptiveSnapshot(cdp, appPort, { streak: 0, band: 1200, flow: 18 });
  const adaptiveHigh = await adaptiveSnapshot(cdp, appPort, { streak: 9, band: 1200, flow: 88 });
  const clockExpiry = await clockExpirySnapshot(cdp, appPort);
  const reviewLine = await reviewLineSnapshot(cdp, appPort);
  const saveControl = await saveControlSnapshot(cdp, appPort);
  const savedFeed = await savedFeedSnapshot(cdp, appPort);
  const wheelSnap = await wheelSnapSnapshot(cdp, appPort);

  if (adaptiveHigh.target <= adaptiveLow.target + 320) {
    errors.push(`adaptive target only increased from ${adaptiveLow.target} to ${adaptiveHigh.target}`);
  }
  if (adaptiveHigh.upcomingAverage <= adaptiveLow.upcomingAverage + 220) {
    errors.push(`adaptive feed average only increased from ${adaptiveLow.upcomingAverage} to ${adaptiveHigh.upcomingAverage}`);
  }
  if (clockExpiry.streak !== "0") errors.push(`clock expiry left streak at ${clockExpiry.streak}`);
  if (clockExpiry.expired) errors.push("clock expiry state did not clear after restart");
  if (clockExpiry.clockSeconds < 58) errors.push(`clock did not restart after expiry: ${clockExpiry.clockText}`);
  if (reviewLine.activePly !== "1") errors.push(`solution review did not activate ply 1; got ${reviewLine.activePly || "none"}`);
  if (!reviewLine.lineVisible) errors.push("solution review line is not visible after reveal");
  if (saveControl.pressed !== "true") errors.push("save button did not become pressed");
  if (saveControl.countText !== "1") errors.push(`save count did not update: ${saveControl.countText || "empty"}`);
  if (saveControl.icon !== "\u2605") errors.push(`save icon did not fill: ${saveControl.icon || "empty"}`);
  if (!saveControl.persisted) errors.push("save did not persist to local storage");
  if (!saveControl.restored) errors.push("saved puzzle state did not restore after reload");
  if (savedFeed.mode !== "saved") errors.push(`saved library did not activate: ${savedFeed.mode || "none"}`);
  if (savedFeed.activeId !== savedFeed.savedId) errors.push("saved library did not open on the saved puzzle");
  if (savedFeed.countText !== "1") errors.push(`saved library count did not show 1: ${savedFeed.countText || "empty"}`);
  if (savedFeed.backMode !== "all") errors.push(`saved library did not return to all puzzles: ${savedFeed.backMode || "none"}`);
  if (wheelSnap.active !== "1") errors.push(`wheel gesture moved ${wheelSnap.active || "nowhere"} panels; expected 1`);

  console.log(JSON.stringify({ puzzleBytes, assetBytes, results, adaptive: { low: adaptiveLow, high: adaptiveHigh }, clockExpiry, reviewLine, saveControl, savedFeed, wheelSnap }, null, 2));
  await cdp.close();
} finally {
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Performance audit passed.");

function snapshotExpression() {
  return `(() => {
    const feed = document.querySelector("#feed");
    const board = document.querySelector(".reel.active .board-wrap")?.getBoundingClientRect();
    const rail = document.querySelector(".rail")?.getBoundingClientRect();
    const hud = document.querySelector(".hud")?.getBoundingClientRect();
    const xp = document.querySelector("#xpStat")?.getBoundingClientRect();
    const root = document.documentElement.dataset;
    const clipped = (rect) => rect ? rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1 : true;
    const overlaps = (a, b) => a && b && a.left < b.right - 3 && a.right > b.left + 3 && a.top < b.bottom - 3 && a.bottom > b.top + 3;
    return {
      ready: document.documentElement.dataset.chesstok,
      active: document.querySelector(".reel.active")?.dataset.index || "",
      perf: window.__chesstokPerf || {
        version: "",
        readyMs: Number(root.readyMs || 0),
        puzzles: Number(root.puzzles || 0),
        mountedBoards: Number(root.mountedBoards || 0),
        liveReels: Number(root.liveReels || 0),
        nodes: Number(root.nodes || 0)
      },
      reels: document.querySelectorAll(".reel").length,
      boards: document.querySelectorAll(".board").length,
      nodes: document.querySelectorAll("*").length,
      scrollTop: Math.round(feed.scrollTop),
      scrollHeight: Math.round(feed.scrollHeight),
      clockText: document.querySelector("#clockValue")?.textContent || "",
      xpText: document.querySelector("#xpValue")?.textContent || "",
      board: board ? { x: Math.round(board.left), y: Math.round(board.top), w: Math.round(board.width), h: Math.round(board.height) } : null,
      rail: rail ? { x: Math.round(rail.left), y: Math.round(rail.top), w: Math.round(rail.width), h: Math.round(rail.height) } : null,
      hud: hud ? { x: Math.round(hud.left), y: Math.round(hud.top), w: Math.round(hud.width), h: Math.round(hud.height) } : null,
      xp: xp ? { x: Math.round(xp.left), y: Math.round(xp.top), w: Math.round(xp.width), h: Math.round(xp.height) } : null,
      boardCenterOffset: board ? Math.round(Math.abs((board.left + board.width / 2) - innerWidth / 2)) : 999,
      boardClipped: clipped(board),
      railClipped: clipped(rail),
      hudClipped: clipped(hud),
      xpClipped: clipped(xp),
      railOverlapsBoard: overlaps(board, rail)
    };
  })()`;
}

async function waitReady(cdp) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.documentElement.dataset.chesstok");
    if (ready === "ready") return;
    await delay(100);
  }
  throw new Error("Timed out waiting for app");
}

async function adaptiveSnapshot(cdp, appPort, profile) {
  await cdp
    .send("Storage.clearDataForOrigin", {
      origin: `http://127.0.0.1:${appPort}`,
      storageTypes: "all"
    })
    .catch(() => {});

  const params = new URLSearchParams({
    perf: `adaptive-${profile.streak}`,
    streak: String(profile.streak),
    band: String(profile.band),
    flow: String(profile.flow)
  });
  await navigate(cdp, `http://127.0.0.1:${appPort}/?${params}`);
  await waitReady(cdp);
  return evaluate(cdp, "window.__chesstokPerf.adaptive");
}

async function clockExpirySnapshot(cdp, appPort) {
  await cdp
    .send("Storage.clearDataForOrigin", {
      origin: `http://127.0.0.1:${appPort}`,
      storageTypes: "all"
    })
    .catch(() => {});

  const params = new URLSearchParams({
    perf: "clock-expiry",
    streak: "5",
    band: "1200",
    flow: "80",
    clock: "1"
  });
  await navigate(cdp, `http://127.0.0.1:${appPort}/?${params}`);
  await waitReady(cdp);
  await delay(1800);
  return evaluate(
    cdp,
    `(() => {
      const clockText = document.querySelector("#clockValue")?.textContent || "";
      return {
        streak: document.querySelector("#streakValue")?.textContent || "",
        clockText,
        clockSeconds: Number(clockText.replace(/\\D/g, "")) || 0,
        expired: document.body.classList.contains("clock-expired")
      };
    })()`
  );
}

async function reviewLineSnapshot(cdp, appPort) {
  await cdp
    .send("Storage.clearDataForOrigin", {
      origin: `http://127.0.0.1:${appPort}`,
      storageTypes: "all"
    })
    .catch(() => {});

  await navigate(cdp, `http://127.0.0.1:${appPort}/?perf=review-line`);
  await waitReady(cdp);
  return evaluate(
    cdp,
    `new Promise((resolve) => {
      document.querySelector("#revealButton")?.click();
      setTimeout(() => {
        document.querySelector(".line-list [data-ply='1']")?.click();
        setTimeout(() => {
          const active = document.querySelector(".line-list [aria-current='step']");
          const board = document.querySelector(".reel.active .board-wrap")?.getBoundingClientRect();
          resolve({
            activePly: active?.dataset.ply || "",
            lineVisible: document.querySelector("#lineList")?.classList.contains("visible") || false,
            feedback: document.querySelector(".reel.active .feedback")?.textContent || "",
            boardCenterOffset: board ? Math.round(Math.abs((board.left + board.width / 2) - innerWidth / 2)) : 999
          });
        }, 140);
      }, 140);
    })`
  );
}

async function saveControlSnapshot(cdp, appPort) {
  await cdp
    .send("Storage.clearDataForOrigin", {
      origin: `http://127.0.0.1:${appPort}`,
      storageTypes: "all"
    })
    .catch(() => {});

  const url = `http://127.0.0.1:${appPort}/?perf=save-control`;
  await navigate(cdp, url);
  await waitReady(cdp);
  await evaluate(cdp, `document.querySelector("#saveButton")?.click()`);
  await delay(260);
  const saved = await evaluate(
    cdp,
    `(() => {
      const button = document.querySelector("#saveButton");
      const activeId = document.querySelector(".reel.active")?.dataset.puzzleId || "";
      const snapshot = JSON.parse(localStorage.getItem("chesstok-state-v1") || "{}");
      return {
        activeId,
        pressed: button?.getAttribute("aria-pressed") || "",
        label: button?.getAttribute("aria-label") || "",
        icon: document.querySelector("#saveButton span")?.textContent || "",
        countText: document.querySelector("#saveCount")?.textContent || "",
        labelText: document.querySelector("#saveLabel")?.textContent || "",
        persisted: Array.isArray(snapshot.favorites) && snapshot.favorites.includes(activeId)
      };
    })()`
  );

  await navigate(cdp, `${url}&reload=1`);
  await waitReady(cdp);
  const restored = await evaluate(
    cdp,
    `(() => ({
      pressed: document.querySelector("#saveButton")?.getAttribute("aria-pressed") || "",
      countText: document.querySelector("#saveCount")?.textContent || "",
      icon: document.querySelector("#saveButton span")?.textContent || ""
    }))()`
  );

  return {
    ...saved,
    restored: restored.pressed === "true" && restored.countText === "1" && restored.icon === "\u2605"
  };
}

async function savedFeedSnapshot(cdp, appPort) {
  await cdp
    .send("Storage.clearDataForOrigin", {
      origin: `http://127.0.0.1:${appPort}`,
      storageTypes: "all"
    })
    .catch(() => {});

  const url = `http://127.0.0.1:${appPort}/?perf=saved-feed`;
  await navigate(cdp, url);
  await waitReady(cdp);
  await evaluate(cdp, `document.querySelector("#saveButton")?.click()`);
  await delay(160);
  await evaluate(cdp, `document.querySelector("#savedFilterButton")?.click()`);
  await delay(260);
  const saved = await evaluate(
    cdp,
    `(() => {
      const button = document.querySelector("#savedFilterButton");
      return {
        mode: button?.getAttribute("aria-pressed") === "true" ? "saved" : "all",
        savedId: JSON.parse(localStorage.getItem("chesstok-state-v1") || "{}").favorites?.[0] || "",
        activeId: document.querySelector(".reel.active")?.dataset.puzzleId || "",
        activePressed: button?.getAttribute("aria-pressed") || "",
        countText: document.querySelector("#savedFilterCount")?.textContent || "",
        liveReels: document.querySelectorAll(".reel").length
      };
    })()`
  );

  await evaluate(cdp, `document.querySelector("#savedFilterButton")?.click()`);
  await delay(260);
  const backMode = await evaluate(cdp, `document.querySelector("#savedFilterButton")?.getAttribute("aria-pressed") === "true" ? "saved" : "all"`);
  return { ...saved, backMode };
}

async function wheelSnapSnapshot(cdp, appPort) {
  await cdp
    .send("Storage.clearDataForOrigin", {
      origin: `http://127.0.0.1:${appPort}`,
      storageTypes: "all"
    })
    .catch(() => {});

  await navigate(cdp, `http://127.0.0.1:${appPort}/?perf=wheel-once`);
  await waitReady(cdp);
  return evaluate(
    cdp,
    `new Promise((resolve) => {
      const feed = document.querySelector("#feed");
      let count = 0;
      const burst = setInterval(() => {
        feed.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
          deltaMode: 0
        }));
        count += 1;
        if (count >= 12) {
          clearInterval(burst);
          setTimeout(() => resolve({
            active: document.querySelector(".reel.active")?.dataset.index || "",
            scrollTop: Math.round(feed.scrollTop)
          }), 620);
        }
      }, 70);
    })`
  );
}

async function waitForHttp(url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForJson(url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let id = 0;
    const callbacks = new Map();
    const listeners = new Map();

    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const callId = ++id;
          socket.send(JSON.stringify({ id: callId, method, params }));
          return new Promise((res, rej) => callbacks.set(callId, { res, rej }));
        },
        once(method) {
          return new Promise((res) => listeners.set(method, res));
        },
        close() {
          socket.close();
        }
      });
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && callbacks.has(message.id)) {
        const callback = callbacks.get(message.id);
        callbacks.delete(message.id);
        if (message.error) callback.rej(new Error(message.error.message));
        else callback.res(message.result);
      } else if (message.method && listeners.has(message.method)) {
        const listener = listeners.get(message.method);
        listeners.delete(message.method);
        listener(message.params);
      }
    });

    socket.addEventListener("error", reject);
  });
}

async function navigate(cdp, url) {
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluation failed");
  return result.result.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
