import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appPort = 8890 + Math.floor(Math.random() * 600);
const debugPort = 9500 + Math.floor(Math.random() * 600);
const errors = [];

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

  const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const pageInfo = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(pageInfo.webSocketDebuggerUrl || version.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  await waitForHttp(`http://127.0.0.1:${appPort}/`);
  await navigate(cdp, `http://127.0.0.1:${appPort}/?perf=${Date.now()}`);
  await waitReady(cdp);

  const before = await evaluate(cdp, snapshotExpression());
  const jump = await evaluate(cdp, `new Promise((resolve) => {
    const feed = document.querySelector("#feed");
    feed.scrollTop = feed.clientHeight * 500;
    feed.dispatchEvent(new Event("scroll"));
    setTimeout(() => resolve((${snapshotExpression()})), 380);
  })`);

  if (before.perf.readyMs > 5000) errors.push(`ready took ${before.perf.readyMs}ms; budget is 5000ms`);
  if (before.reels > 4) errors.push(`initial live reels ${before.reels}; budget is 4`);
  if (jump.reels > 7) errors.push(`jump live reels ${jump.reels}; budget is 7`);
  if (jump.boards > 7) errors.push(`jump live boards ${jump.boards}; budget is 7`);
  if (jump.nodes > 2100) errors.push(`jump DOM nodes ${jump.nodes}; budget is 2100`);
  if (before.boardClipped || jump.boardClipped) errors.push("board is clipped in the mobile viewport");
  if (jump.active !== "500") errors.push(`jump landed on puzzle ${jump.active}; expected 500`);

  console.log(JSON.stringify({ puzzleBytes, before, jump }, null, 2));
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
    const root = document.documentElement.dataset;
    return {
      ready: document.documentElement.dataset.moveRush,
      active: document.querySelector(".reel.active")?.dataset.index || "",
      perf: window.__chesstokPerf || {
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
      boardClipped: board ? board.left < 0 || board.right > innerWidth || board.top < 0 || board.bottom > innerHeight : true
    };
  })()`;
}

async function waitReady(cdp) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.documentElement.dataset.moveRush");
    if (ready === "ready") return;
    await delay(100);
  }
  throw new Error("Timed out waiting for app");
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
