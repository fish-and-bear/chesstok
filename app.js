import { Chess } from "./vendor/chess.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const PIECE_NAMES = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king"
};
const PIECE_SPRITE = "./pieces.svg";

let PUZZLES = [];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const PUZZLE_IDS = new Set();
const STORAGE_KEY = "move-rush-state-v2";
const STORAGE_DB = "move-rush-db";
const STORAGE_STORE = "snapshots";
const STORAGE_ID = "primary";
const STORAGE_VERSION = 3;
const SAVE_DEBOUNCE = 180;
const MOVE_DELAY = 420;
const RUSH_DELAY = 260;
const SWIPE_DISTANCE = 42;
const SWIPE_VELOCITY = 0.42;
const WHEEL_STEP = 34;
const SNAP_LOCK_MS = 430;
const SNAP_CLASS_MS = 520;
const BAD_SQUARE_MS = 360;
const BOARD_TAP_LOCK_MS = 260;
const VIRTUAL_RADIUS = 3;
const STATE_CACHE_RADIUS = 8;
const QUESTS = [
  { type: "clean", target: 3, label: "Clean 3" },
  { type: "solve", target: 5, label: "Solve 5" },
  { type: "streak", target: 4, label: "Streak 4" },
  { type: "clean", target: 5, label: "Clean 5" },
  { type: "solve", target: 8, label: "Solve 8" }
];

const feed = document.querySelector("#feed");
const toast = document.querySelector("#toast");
const title = document.querySelector("#puzzleTitle");
const streakValue = document.querySelector("#streakValue");
const solvedValue = document.querySelector("#solvedValue");
const dock = document.querySelector("#dock");
const lineList = document.querySelector("#lineList");
const skipButton = document.querySelector("#skipButton");
const revealButton = document.querySelector("#revealButton");
const saveButton = document.querySelector("#saveButton");
const resetButton = document.querySelector("#resetButton");
const flowFill = document.querySelector("#flowFill");
const comboToast = document.querySelector("#comboToast");

document.documentElement.dataset.moveRush = "loading";

const session = {
  active: 0,
  selected: null,
  streak: 0,
  solved: 0,
  xp: 0,
  bestStreak: 0,
  cleanRun: 0,
  questIndex: 0,
  questProgress: 0,
  band: 1200,
  flow: 28,
  lastPuzzleId: "",
  favorites: new Set(),
  solvedIds: new Set(),
  mutedUntilGesture: true,
  puzzles: [],
  feedStage: null,
  feedSpacer: null,
  panelHeight: 0,
  panels: [],
  mounted: new Set(),
  cached: new Set(),
  states: []
};

const storageClientId = makeStorageClientId();
let storageDbPromise = null;
let saveTimer = 0;
let saveQueue = Promise.resolve();
let lastAppliedAt = 0;
let syncChannel = null;
let snapLockedUntil = 0;
let snapClassTimer = 0;
let boardTapLockedUntil = 0;
let wheelDelta = 0;
let wheelTimer = 0;
let touchStartY = 0;
let touchStartX = 0;
let touchStartAt = 0;
let pointerStartY = 0;
let pointerStartX = 0;
let pointerStartAt = 0;
let scrollSettleTimer = 0;
let lastScrollTop = 0;
let lastScrollDirection = 0;
let resizeTimer = 0;

async function readSavedState() {
  const localSnapshot = readLocalSnapshot();
  const dbSnapshot = await readDbSnapshot();
  const saved = chooseNewestSnapshot(localSnapshot, dbSnapshot);
  const normalized = normalizeSnapshot(saved ? { ...saved, updatedAt: saved.updatedAt || Date.now() } : {});
  lastAppliedAt = normalized.updatedAt;

  if (saved) {
    writeLocalSnapshot(normalized);
    queueDbWrite(normalized);
  }

  return normalized;
}

function applySavedState(saved) {
  const normalized = normalizeSnapshot(saved);
  session.streak = normalized.streak;
  session.solved = normalized.solved;
  session.xp = normalized.xp;
  session.bestStreak = normalized.bestStreak;
  session.cleanRun = normalized.cleanRun;
  session.questIndex = normalized.questIndex;
  session.questProgress = normalized.questProgress;
  session.band = normalized.band;
  session.flow = normalized.flow;
  session.lastPuzzleId = normalized.lastPuzzleId;
  session.favorites = new Set(normalized.favorites);
  session.solvedIds = new Set(normalized.solvedIds);
  lastAppliedAt = Math.max(lastAppliedAt, normalized.updatedAt);
}

function saveState({ immediate = false, broadcast = true } = {}) {
  const snapshot = createSnapshot();
  writeLocalSnapshot(snapshot);

  if (immediate) {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = 0;
    queueDbWrite(snapshot, broadcast);
    return;
  }

  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    queueDbWrite(snapshot, broadcast);
  }, SAVE_DEBOUNCE);
}

function createSnapshot() {
  return normalizeSnapshot({
    schemaVersion: STORAGE_VERSION,
    updatedAt: Date.now(),
    sourceId: storageClientId,
    streak: session.streak,
    solved: session.solved,
    xp: session.xp,
    bestStreak: session.bestStreak,
    cleanRun: session.cleanRun,
    questIndex: session.questIndex,
    questProgress: session.questProgress,
    band: session.band,
    flow: session.flow,
    lastPuzzleId: session.lastPuzzleId,
    favorites: [...session.favorites],
    solvedIds: [...session.solvedIds]
  });
}

function normalizeSnapshot(value) {
  const favorites = normalizeIdList(value.favorites, 5000);
  const solvedIds = normalizeIdList(value.solvedIds, 50000);
  const solved = solvedIds.length;
  const streak = Math.min(safeInteger(value.streak, 0, 0, 1000000), solved);
  const bestStreak = Math.min(safeInteger(value.bestStreak, 0, 0, 1000000), solved);
  const cleanRun = Math.min(safeInteger(value.cleanRun, 0, 0, 1000000), streak);
  const xpLimit = solved ? 1000 + solved * 260 : 0;
  const questProgress = Math.min(safeInteger(value.questProgress, 0, 0, 1000000), solved);
  const lastPuzzleId = typeof value.lastPuzzleId === "string" && PUZZLE_IDS.has(value.lastPuzzleId) ? value.lastPuzzleId : "";

  return {
    id: STORAGE_ID,
    schemaVersion: STORAGE_VERSION,
    updatedAt: safeNumber(value.updatedAt, 0),
    sourceId: typeof value.sourceId === "string" ? value.sourceId : "",
    streak,
    solved,
    xp: safeInteger(value.xp, 0, 0, xpLimit),
    bestStreak: Math.max(bestStreak, streak),
    cleanRun,
    questIndex: safeInteger(value.questIndex, 0, 0, QUESTS.length - 1),
    questProgress,
    band: safeInteger(value.band, 1200, 300, 3200),
    flow: safeInteger(value.flow, 28, 0, 100),
    lastPuzzleId,
    favorites,
    solvedIds
  };
}

function normalizeIdList(ids, limit) {
  return Array.isArray(ids)
    ? [...new Set(ids.filter((id) => typeof id === "string" && PUZZLE_IDS.has(id)))].slice(0, limit)
    : [];
}

function safeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function chooseNewestSnapshot(localSnapshot, dbSnapshot) {
  if (!localSnapshot) return dbSnapshot;
  if (!dbSnapshot) return localSnapshot;
  return safeNumber(dbSnapshot.updatedAt, 0) >= safeNumber(localSnapshot.updatedAt, 0) ? dbSnapshot : localSnapshot;
}

function readLocalSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function writeLocalSnapshot(snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {}
}

async function readDbSnapshot() {
  try {
    const db = await openStorageDb();
    if (!db) return null;
    return await idbRequest(db.transaction(STORAGE_STORE, "readonly").objectStore(STORAGE_STORE).get(STORAGE_ID));
  } catch {
    return null;
  }
}

function queueDbWrite(snapshot, broadcast = true) {
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      await writeDbSnapshot(snapshot);
      if (broadcast) broadcastSnapshot(snapshot);
    });
}

async function writeDbSnapshot(snapshot) {
  try {
    const db = await openStorageDb();
    if (!db) return;
    const transaction = db.transaction(STORAGE_STORE, "readwrite");
    transaction.objectStore(STORAGE_STORE).put(snapshot);
    await transactionDone(transaction);
  } catch {}
}

function openStorageDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (storageDbPromise) return storageDbPromise;

  storageDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DB, STORAGE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORAGE_STORE)) db.createObjectStore(STORAGE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(null);
  });

  return storageDbPromise;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function setupPersistence() {
  requestPersistentStorage();

  window.addEventListener("pagehide", () => saveState({ immediate: true, broadcast: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState({ immediate: true, broadcast: false });
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      applyExternalSnapshot(JSON.parse(event.newValue));
    } catch {}
  });

  if ("BroadcastChannel" in window) {
    syncChannel = new BroadcastChannel("move-rush-state");
    syncChannel.addEventListener("message", (event) => applyExternalSnapshot(event.data));
  }
}

function applyExternalSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot || {});
  if (normalized.sourceId === storageClientId) return;
  if (normalized.updatedAt <= lastAppliedAt) return;
  applySavedState(normalized);
  updateDock();
}

function broadcastSnapshot(snapshot) {
  syncChannel?.postMessage(snapshot);
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {}
}

function makeStorageClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneGame(game) {
  return new Chess(game.fen());
}

function applyUci(game, uci) {
  const move = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4)
  };
  if (uci.length > 4) move.promotion = uci.slice(4, 5);
  return game.move(move);
}

function moveToUci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function preparePuzzle(puzzle, index) {
  const moves = puzzle.moves.split(/\s+/);
  const game = new Chess(puzzle.fen);
  const firstMove = applyUci(game, moves[0]);
  if (!firstMove) throw new Error(`Bad first move for ${puzzle.id}`);

  const preview = cloneGame(game);
  const solution = [];
  for (const uci of moves.slice(1)) {
    const move = applyUci(preview, uci);
    if (!move) throw new Error(`Bad solution move ${uci} for ${puzzle.id}`);
    solution.push({
      uci,
      san: move.san,
      color: move.color,
      side: move.color === "w" ? "White" : "Black"
    });
  }

  return {
    puzzle,
    index,
    game,
    startFen: game.fen(),
    moves,
    cursor: 1,
    selected: null,
    solved: false,
    revealed: false,
    wrong: 0,
    userHits: 0,
    badSquares: [],
    activatedAt: 0,
    lastSquares: [firstMove.from, firstMove.to],
    solution,
    panel: null,
    board: null
  };
}

function buildFeed() {
  session.puzzles = [...PUZZLES].sort((a, b) => {
    const distanceA = Math.abs(a.rating - session.band);
    const distanceB = Math.abs(b.rating - session.band);
    return distanceA - distanceB || b.popularity - a.popularity;
  });

  session.states = new Array(session.puzzles.length).fill(null);
  session.panels = [];
  session.mounted.clear();
  session.cached.clear();
  const savedIndex = session.lastPuzzleId ? session.puzzles.findIndex((puzzle) => puzzle.id === session.lastPuzzleId) : -1;
  const startIndex = savedIndex >= 0 ? savedIndex : 0;

  const stage = document.createElement("div");
  stage.className = "feed-stage";

  const spacer = document.createElement("div");
  spacer.className = "feed-spacer";
  spacer.setAttribute("aria-hidden", "true");

  stage.append(spacer);
  feed.replaceChildren(stage);
  session.feedStage = stage;
  session.feedSpacer = spacer;
  updateFeedMetrics();

  session.active = startIndex;
  session.lastPuzzleId = session.puzzles[startIndex]?.id || "";
  renderNearby(startIndex);
  session.panels[startIndex]?.classList.add("active");
  const firstState = ensureState(startIndex);
  if (firstState) firstState.activatedAt = performance.now();
  if (startIndex > 0) {
    window.requestAnimationFrame(() => scrollToPanel(startIndex, "auto"));
  }
}

function ensureState(index) {
  if (index < 0 || index >= session.puzzles.length) return null;
  let state = session.states[index];
  if (!state) {
    state = preparePuzzle(session.puzzles[index], index);
    if (session.solvedIds.has(state.puzzle.id)) applyStoredSolvedState(state);
    state.panel = session.panels[index];
    session.states[index] = state;
    session.cached.add(index);
  }
  state.panel = ensurePanel(index);
  mountBoard(state);
  return state;
}

function mountBoard(state) {
  state.panel = ensurePanel(state.index);
  if (state.board) return;

  const boardWrap = document.createElement("div");
  boardWrap.className = "board-wrap";

  const board = document.createElement("div");
  board.className = "board";
  board.setAttribute("role", "grid");
  board.setAttribute("aria-label", "Chess board");
  board.addEventListener("click", (event) => {
    if (performance.now() < boardTapLockedUntil) return;
    const square = event.target.closest("[data-square]");
    if (!square) return;
    beginAudio();
    handleSquareTap(state, square.dataset.square);
  });

  const pulse = document.createElement("div");
  pulse.className = "pulse";
  pulse.setAttribute("aria-hidden", "true");

  const floaters = document.createElement("div");
  floaters.className = "floaters";
  floaters.setAttribute("aria-hidden", "true");

  const advance = document.createElement("div");
  advance.className = "advance";
  advance.setAttribute("aria-hidden", "true");

  const feedback = document.createElement("div");
  feedback.className = "feedback";
  feedback.textContent = "";

  boardWrap.append(board, pulse, floaters, advance, feedback);
  state.panel.replaceChildren(boardWrap);
  state.board = board;
  session.mounted.add(state.index);
  syncPanelStateClasses(state);
  renderBoard(state);
}

function unmountBoard(index) {
  const state = session.states[index];
  if (!state?.board) return;
  state.panel?.replaceChildren();
  state.panel?.remove();
  if (session.panels[index] === state.panel) delete session.panels[index];
  state.board = null;
  state.panel = null;
  session.mounted.delete(index);
}

function renderNearby(center) {
  center = clampIndex(center);
  const keep = new Set();
  for (let index = center - VIRTUAL_RADIUS; index <= center + VIRTUAL_RADIUS; index += 1) {
    if (index < 0 || index >= session.puzzles.length) continue;
    keep.add(index);
    ensureState(index);
  }

  for (const index of [...session.mounted]) {
    if (!keep.has(index)) unmountBoard(index);
  }

  for (const index of keep) {
    session.panels[index]?.classList.toggle("active", index === session.active);
  }

  pruneStateCache(center);
}

function ensurePanel(index) {
  if (index < 0 || index >= session.puzzles.length) return null;

  let panel = session.panels[index];
  if (!panel) {
    panel = document.createElement("article");
    panel.className = "reel";
    panel.dataset.index = index;
    panel.dataset.puzzleId = session.puzzles[index].id;
    panel.setAttribute("aria-label", `${session.puzzles[index].rating} rated puzzle`);
    session.panels[index] = panel;
    session.feedStage?.append(panel);
  }

  positionPanel(index);
  panel.classList.toggle("active", index === session.active);
  return panel;
}

function positionPanel(index) {
  const panel = session.panels[index];
  if (!panel) return;
  panel.style.setProperty("--panel-top", `${index * pageHeight()}px`);
}

function updateFeedMetrics() {
  const page = Math.max(1, Math.round(feed.clientHeight || window.innerHeight || 1));
  session.panelHeight = page;
  feed.style.setProperty("--feed-page", `${page}px`);
  if (session.feedSpacer) session.feedSpacer.style.height = `${Math.max(page, session.puzzles.length * page)}px`;
  for (const index of session.mounted) positionPanel(index);
}

function pageHeight() {
  return Math.max(1, session.panelHeight || feed.clientHeight || window.innerHeight || 1);
}

function scrollTopForIndex(index) {
  return clampIndex(index) * pageHeight();
}

function scrollToPanel(index, behavior = "smooth") {
  feed.scrollTo({ top: scrollTopForIndex(index), behavior });
}

function clampIndex(index) {
  if (!session.puzzles.length) return 0;
  return Math.max(0, Math.min(Math.round(index), session.puzzles.length - 1));
}

function pruneStateCache(center) {
  for (const index of [...session.cached]) {
    if (Math.abs(index - center) <= STATE_CACHE_RADIUS) continue;
    if (session.states[index]?.board) continue;
    session.states[index] = null;
    session.cached.delete(index);
  }
}

function applyStoredSolvedState(state) {
  while (state.cursor < state.moves.length) {
    const move = applyUci(state.game, state.moves[state.cursor]);
    if (!move) break;
    state.lastSquares = [move.from, move.to];
    state.cursor += 1;
  }
  state.selected = null;
  state.badSquares = [];
  state.solved = true;
  state.revealed = true;
}

function syncPanelStateClasses(state) {
  if (!state.panel) return;
  state.panel.classList.toggle("solved", state.solved);
  state.panel.classList.toggle("revealed", state.revealed);
}

function orientationFor(state) {
  return state.game.turn();
}

function squareOrder(orientation) {
  const files = orientation === "b" ? [...FILES].reverse() : FILES;
  const ranks = orientation === "b" ? [...RANKS].reverse() : RANKS;
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
}

function renderBoard(state) {
  if (!state.board) return;

  const orientation = orientationFor(state);
  const squares = squareOrder(orientation);
  const orderedFiles = orientation === "b" ? [...FILES].reverse() : FILES;
  const orderedRanks = orientation === "b" ? [...RANKS].reverse() : RANKS;
  const leftFile = orderedFiles[0];
  const bottomRank = orderedRanks[orderedRanks.length - 1];
  const activeColor = state.game.turn();
  const targets = selectedTargets(state);

  state.board.replaceChildren(
    ...squares.map((square) => {
      const piece = state.game.get(square);
      const isLight = (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 1;
      const target = targets.get(square);
      const button = document.createElement("button");
      button.className = "square";
      button.classList.add(isLight ? "light" : "dark");
      button.classList.toggle("selected", state.selected === square);
      button.classList.toggle("last", state.lastSquares.includes(square));
      button.classList.toggle("bad", state.badSquares.includes(square));
      button.classList.toggle("can-move", Boolean(piece && piece.color === activeColor));
      button.classList.toggle("target", Boolean(target));
      button.classList.toggle("capture", Boolean(target?.captured));
      button.type = "button";
      button.setAttribute("role", "gridcell");
      button.dataset.square = square;
      button.setAttribute(
        "aria-label",
        piece ? `${piece.color === "w" ? "White" : "Black"} ${PIECE_NAMES[piece.type]} on ${square}` : square
      );

      if (target) {
        const marker = document.createElement("span");
        marker.className = target.captured ? "move-target capture-target" : "move-target dot-target";
        marker.setAttribute("aria-hidden", "true");
        button.append(marker);
      }

      if (piece) {
        const pieceLabel = document.createElement("span");
        pieceLabel.className = "piece";
        pieceLabel.append(createPieceSvg(piece));
        button.append(pieceLabel);
      }

      const fileCoord = document.createElement("span");
      fileCoord.className = "coord file";
      fileCoord.textContent = square[1] === bottomRank ? square[0] : "";

      const rankCoord = document.createElement("span");
      rankCoord.className = "coord rank";
      rankCoord.textContent = square[0] === leftFile ? square[1] : "";

      button.append(fileCoord, rankCoord);
      return button;
    })
  );
}

function createPieceSvg(piece) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("piece-svg", piece.color === "w" ? "white-piece" : "black-piece");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");

  const use = document.createElementNS(SVG_NS, "use");
  const pieceId = `${piece.color}${piece.type}`;
  use.setAttribute("href", `${PIECE_SPRITE}#${pieceId}`);
  use.setAttributeNS("http://www.w3.org/1999/xlink", "href", `${PIECE_SPRITE}#${pieceId}`);
  svg.append(use);

  return svg;
}

function selectedTargets(state) {
  if (!state.selected) return new Map();
  const targets = new Map();
  for (const move of state.game.moves({ square: state.selected, verbose: true })) {
    targets.set(move.to, move);
  }
  return targets;
}

function handleSquareTap(state, square) {
  if (state.solved) return;

  const piece = state.game.get(square);
  const turn = state.game.turn();
  if (!state.selected) {
    if (piece && piece.color === turn) {
      state.selected = square;
      renderBoard(state);
      markFeedback(state, "");
      pulsePanel(state, "select");
      updateDock();
      tick("tap");
    }
    return;
  }

  if (state.selected === square) {
    state.selected = null;
    renderBoard(state);
    updateDock();
    return;
  }

  if (piece && piece.color === turn) {
    state.selected = square;
    renderBoard(state);
    markFeedback(state, "");
    pulsePanel(state, "select");
    updateDock();
    tick("tap");
    return;
  }

  const expected = state.moves[state.cursor];
  const candidate = `${state.selected}${square}`;
  const promotionCandidate = `${candidate}q`;
  const legal = state.game
    .moves({ square: state.selected, verbose: true })
    .find((move) => moveToUci(move) === candidate || moveToUci(move) === promotionCandidate);

  if (!legal) {
    miss(state, "", [state.selected, square]);
    return;
  }

  const userUci = moveToUci(legal);
  if (userUci !== expected && !(legal.promotion && promotionCandidate === expected)) {
    miss(state, "", [state.selected, square]);
    return;
  }

  playExpectedMove(state, "user");
}

function playExpectedMove(state, actor) {
  const move = applyUci(state.game, state.moves[state.cursor]);
  state.lastSquares = [move.from, move.to];
  state.selected = null;
  state.badSquares = [];
  state.cursor += 1;
  if (actor === "user") state.userHits += 1;
  state.panel.classList.toggle("replying", actor === "user" && state.cursor < state.moves.length);
  renderBoard(state);
  markFeedback(state, actor === "user" ? "Nice" : "");
  if (actor === "user") {
    session.flow = Math.min(100, session.flow + 18 + Math.min(session.streak, 5) * 3);
    floatCue(state, `+${10 + session.streak * 2}`);
    pulsePanel(state, "hit");
  }
  tick(actor === "user" ? "correct" : "reply");
  updateDock();

  if (state.cursor >= state.moves.length) {
    solve(state);
    return;
  }

  if (actor !== "user") return;

  window.setTimeout(() => {
    if (session.active === state.index && state.cursor < state.moves.length && !state.solved) {
      state.panel.classList.remove("replying");
      playExpectedMove(state, "reply");
    }
  }, isRush() ? RUSH_DELAY : MOVE_DELAY);
}

function miss(state, text, squares = []) {
  state.wrong += 1;
  state.badSquares = squares.filter(Boolean);
  state.selected = null;
  session.streak = 0;
  session.cleanRun = 0;
  session.flow = Math.max(0, session.flow - 24);
  state.panel.classList.remove("shake");
  void state.panel.offsetWidth;
  state.panel.classList.add("shake");
  renderBoard(state);
  markFeedback(state, text);
  floatCue(state, "Nope", "bad");
  tick("wrong");
  updateDock();
  saveState();
  const badKey = state.badSquares.join("|");
  window.setTimeout(() => {
    if (state.badSquares.join("|") !== badKey) return;
    if (!state.badSquares.length) return;
    state.badSquares = [];
    renderBoard(state);
  }, BAD_SQUARE_MS);
}

function solve(state) {
  const clean = state.wrong === 0 && !state.revealed;
  const usedAnswer = state.revealed;
  const alreadyCounted = session.solvedIds.has(state.puzzle.id);
  state.solved = true;
  state.revealed = true;
  state.panel.classList.remove("replying");
  state.panel.classList.add("solved");

  if (usedAnswer) {
    session.streak = 0;
    session.cleanRun = 0;
    session.flow = Math.max(0, session.flow - 8);
    markFeedback(state, "Practice");
    updateDock();
    saveState();
    window.setTimeout(() => {
      if (session.active === state.index) goToNext();
    }, isRush() ? 520 : 780);
    return;
  }

  if (alreadyCounted) {
    session.flow = Math.min(100, session.flow + 10);
    markFeedback(state, "Solved");
    burst(state);
    updateDock();
    saveState();
    window.setTimeout(() => {
      if (session.active === state.index) goToNext();
    }, isRush() ? 520 : 780);
    return;
  }

  session.solvedIds.add(state.puzzle.id);
  session.streak = state.wrong === 0 ? session.streak + 1 : 0;
  session.solved += 1;
  session.bestStreak = Math.max(session.bestStreak, session.streak);
  session.cleanRun = clean ? session.cleanRun + 1 : 0;
  session.flow = Math.min(100, session.flow + 26);
  session.band = Math.round(session.band * 0.82 + state.puzzle.rating * 0.18 + Math.min(session.streak, 8) * 10);
  const xp = awardSolveXp(state, clean, usedAnswer);
  const questBonus = updateQuest(clean);
  markFeedback(state, clean ? `+${xp + questBonus} XP` : `+${xp} XP`);
  comboFlash(session.streak, xp + questBonus);
  floatCue(state, `+${xp + questBonus}`, questBonus ? "bonus" : "good");
  burst(state);
  updateDock();
  saveState();

  window.setTimeout(() => {
    if (session.active === state.index) goToNext();
  }, isRush() ? 520 : 780);
}

function markFeedback(state, text) {
  const feedback = state.panel.querySelector(".feedback");
  if (!feedback) return;
  feedback.textContent = text;
  feedback.classList.remove("pop");
  void feedback.offsetWidth;
  feedback.classList.add("pop");
}

function burst(state) {
  const pulse = state.panel.querySelector(".pulse");
  if (!pulse) return;
  pulse.replaceChildren();
  for (let i = 0; i < 14; i += 1) {
    const spark = document.createElement("span");
    spark.style.setProperty("--x", `${Math.cos(i) * (42 + i * 4)}px`);
    spark.style.setProperty("--y", `${Math.sin(i * 1.7) * (36 + i * 3)}px`);
    spark.style.setProperty("--d", `${i * 24}ms`);
    pulse.append(spark);
  }
}

function floatCue(state, text, tone = "good") {
  const layer = state.panel.querySelector(".floaters");
  if (!layer) return;
  const cue = document.createElement("span");
  cue.className = `float-cue ${tone}`;
  cue.textContent = text;
  cue.style.setProperty("--shift", `${Math.round(Math.random() * 50 - 25)}px`);
  layer.append(cue);
  window.setTimeout(() => cue.remove(), 780);
}

function awardSolveXp(state, clean, usedAnswer) {
  const seconds = state.activatedAt ? (performance.now() - state.activatedAt) / 1000 : 30;
  const base = 10 + Math.round(Math.min(24, state.puzzle.rating / 140));
  const speed = Math.max(0, Math.round(18 - seconds * 0.9));
  const streak = Math.min(42, session.streak * 4);
  const cleanBonus = clean ? 14 : 0;
  const revealedPenalty = usedAnswer ? 0.45 : 1;
  const xp = Math.max(4, Math.round((base + speed + streak + cleanBonus) * revealedPenalty));
  session.xp += xp;
  return xp;
}

function updateQuest(clean) {
  const quest = currentQuest();
  if (quest.type === "solve") {
    session.questProgress += 1;
  }

  const progress = questProgress(quest, clean);
  if (progress < quest.target) return 0;

  const bonus = 40 + quest.target * 8;
  session.xp += bonus;
  session.questIndex = (session.questIndex + 1) % QUESTS.length;
  session.questProgress = 0;
  flash(`Bonus +${bonus}`);
  tick("bonus");
  return bonus;
}

function currentQuest() {
  return QUESTS[session.questIndex % QUESTS.length];
}

function questProgress(quest) {
  if (quest.type === "clean") return Math.min(quest.target, session.cleanRun);
  if (quest.type === "streak") return Math.min(quest.target, session.streak);
  return Math.min(quest.target, session.questProgress);
}

function isRush() {
  return session.streak >= 3 || session.flow >= 78;
}

function comboFlash(streak, xp) {
  comboToast.textContent = streak >= 3 ? `Streak ${streak} +${xp}` : `+${xp} XP`;
  comboToast.classList.toggle("rush-toast", isRush());
  comboToast.classList.remove("visible");
  void comboToast.offsetWidth;
  comboToast.classList.add("visible");
  window.setTimeout(() => comboToast.classList.remove("visible"), 820);
}

function pulsePanel(state, name) {
  state.panel.classList.remove(name);
  void state.panel.offsetWidth;
  state.panel.classList.add(name);
  window.setTimeout(() => state.panel.classList.remove(name), 420);
}

let audioContext = null;

function beginAudio() {
  if (!session.mutedUntilGesture) return;
  session.mutedUntilGesture = false;
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audioContext = new AudioCtor();
    audioContext.resume?.().catch(() => {});
  } catch {
    audioContext = null;
  }
}

function tick(kind) {
  if (navigator.vibrate) {
    const pattern = kind === "wrong" ? [30, 20, 30] : kind === "bonus" ? [18, 24, 18] : kind === "correct" ? 18 : 8;
    navigator.vibrate(pattern);
  }

  if (!audioContext) return;
  const tones = {
    tap: [210, 0.018, 0.018],
    reply: [260, 0.025, 0.025],
    correct: [620, 0.055, 0.045],
    bonus: [760, 0.08, 0.05],
    wrong: [110, 0.07, 0.05]
  };
  try {
    const [frequency, duration, volume] = tones[kind] || tones.tap;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "triangle";
    gain.gain.value = volume;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {}
}

function updateDock() {
  const state = ensureState(session.active);
  if (!state) return;
  const puzzle = state.puzzle;
  const side = state.game.turn() === "w" ? "White" : "Black";

  title.textContent = state.solved ? "Solved" : `${side} to move`;
  streakValue.textContent = session.streak;
  solvedValue.textContent = session.solved;
  flowFill.style.transform = `scaleX(${Math.max(0.04, session.flow / 100)})`;
  document.body.classList.toggle("rush-mode", isRush());
  saveButton.classList.toggle("active", session.favorites.has(puzzle.id));
  saveButton.setAttribute("aria-pressed", session.favorites.has(puzzle.id) ? "true" : "false");
  saveButton.querySelector("span").textContent = session.favorites.has(puzzle.id) ? "\u2605" : "\u2606";
  revealButton.disabled = state.solved;
  revealButton.setAttribute("aria-disabled", state.solved ? "true" : "false");

  const showLine = state.revealed || state.solved;
  dock.classList.toggle("has-line", showLine);
  lineList.classList.toggle("visible", showLine);
  lineList.replaceChildren(...(showLine ? state.solution.map((move, index) => createLineItem(move.san, index + 1)) : []));
}

function createLineItem(san, number) {
  const item = document.createElement("li");
  const moveNumber = document.createElement("span");
  const moveSan = document.createElement("b");
  moveNumber.textContent = number;
  moveSan.textContent = san;
  item.append(moveNumber, moveSan);
  return item;
}

function setActive(index) {
  index = clampIndex(index);
  if (index === session.active) return;
  const previousIndex = session.active;
  const previousState = session.states[previousIndex];
  if (previousState) {
    previousState.selected = null;
    previousState.badSquares = [];
    previousState.panel?.classList.remove("select", "shake", "replying");
    renderBoard(previousState);
  }
  session.panels[previousIndex]?.classList.remove("active");
  session.active = index;
  session.lastPuzzleId = session.puzzles[session.active]?.id || "";
  session.selected = null;
  renderNearby(session.active);
  const state = ensureState(session.active);
  if (state) {
    state.selected = null;
    state.badSquares = [];
    if (!state.activatedAt) state.activatedAt = performance.now();
    renderBoard(state);
  }
  session.panels[session.active]?.classList.add("active");
  updateDock();
  saveState({ broadcast: false });
}

function goToNext() {
  snapToRelative(1);
}

function goToPrevious() {
  snapToRelative(-1);
}

function snapToRelative(direction) {
  if (!direction || !session.puzzles.length) return;
  const next = direction > 0 ? (session.active + 1) % session.puzzles.length : Math.max(0, session.active - 1);
  snapToIndex(next, "smooth");
}

function snapToIndex(index, behavior = "smooth") {
  index = clampIndex(index);
  updateFeedMetrics();
  renderNearby(index);
  snapLockedUntil = performance.now() + SNAP_LOCK_MS;
  document.body.classList.add("is-snapping");
  if (snapClassTimer) window.clearTimeout(snapClassTimer);
  snapClassTimer = window.setTimeout(() => document.body.classList.remove("is-snapping"), SNAP_CLASS_MS);
  scrollToPanel(index, behavior);
}

function revealActive() {
  const state = ensureState(session.active);
  if (!state) return;
  if (state.solved) return;
  if (!state.revealed && !state.solved) {
    session.streak = 0;
    session.cleanRun = 0;
  }
  state.revealed = true;
  state.selected = null;
  state.badSquares = [];
  session.flow = Math.max(0, session.flow - 10);
  state.panel.classList.remove("replying");
  state.panel.classList.add("revealed");
  renderBoard(state);
  markFeedback(state, "Answer shown");
  tick("reply");
  updateDock();
  saveState();
}

function resetActive() {
  const old = ensureState(session.active);
  if (!old) return;
  const fresh = preparePuzzle(old.puzzle, old.index);
  fresh.panel = old.panel;
  fresh.board = old.board;
  fresh.activatedAt = performance.now();
  session.states[session.active] = fresh;
  old.panel.classList.remove("solved", "revealed", "shake", "select", "hit", "replying");
  old.panel.querySelector(".pulse")?.replaceChildren();
  old.panel.querySelector(".floaters")?.replaceChildren();
  markFeedback(fresh, "");
  renderBoard(fresh);
  updateDock();
}

function skipActive() {
  const state = ensureState(session.active);
  if (!state) return;
  state.selected = null;
  state.badSquares = [];
  state.panel.classList.remove("select", "shake", "replying");
  renderBoard(state);
  session.flow = Math.max(0, session.flow - 6);
  markFeedback(state, "Skipped");
  updateDock();
  saveState();
  goToNext();
}

function toggleFavorite() {
  const state = ensureState(session.active);
  if (!state) return;
  const id = state.puzzle.id;
  if (session.favorites.has(id)) {
    session.favorites.delete(id);
    flash("Removed");
  } else {
    session.favorites.add(id);
    flash("Saved");
  }
  tick("tap");
  updateDock();
  saveState();
}

function flash(text) {
  toast.textContent = text;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 900);
}

function watchPanels() {
  let frame = 0;
  const syncActive = () => {
    frame = 0;
    const next = clampIndex(feed.scrollTop / pageHeight());
    if (next !== session.active) setActive(next);
  };

  feed.addEventListener(
    "scroll",
    () => {
      const scrollTop = feed.scrollTop;
      if (Math.abs(scrollTop - lastScrollTop) > 1) lastScrollDirection = scrollTop > lastScrollTop ? 1 : -1;
      lastScrollTop = scrollTop;
      if (!frame) frame = window.requestAnimationFrame(syncActive);
      if (scrollSettleTimer) window.clearTimeout(scrollSettleTimer);
      scrollSettleTimer = window.setTimeout(snapToNearestPanel, 130);
    },
    { passive: true }
  );

  window.addEventListener(
    "resize",
    () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        updateFeedMetrics();
        renderNearby(session.active);
        snapToIndex(session.active, "auto");
      }, 120);
    },
    { passive: true }
  );
}

function snapToNearestPanel() {
  const page = feed.scrollTop / pageHeight();
  const base = Math.floor(page);
  const progress = page - base;
  let next = clampIndex(page);
  if (lastScrollDirection > 0 && progress > 0.14) next = base + 1;
  if (lastScrollDirection < 0 && progress < 0.86) next = base;
  next = clampIndex(next);
  const targetTop = scrollTopForIndex(next);
  if (Math.abs(feed.scrollTop - targetTop) <= 2) return;
  snapToIndex(next, "smooth");
}

function bindSwipeNavigation() {
  feed.addEventListener("wheel", handleWheel, { passive: false });
  feed.addEventListener("pointerdown", handlePointerStart, { passive: true });
  feed.addEventListener("pointerup", handlePointerEnd, { passive: true });
  feed.addEventListener("pointercancel", clearPointerSwipe, { passive: true });
  feed.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartAt = performance.now();
    },
    { passive: true }
  );
  feed.addEventListener("touchend", handleTouchEnd, { passive: true });
  feed.addEventListener(
    "touchcancel",
    () => {
      touchStartX = 0;
      touchStartY = 0;
      touchStartAt = 0;
    },
    { passive: true }
  );
}

function handlePointerStart(event) {
  if (event.pointerType === "mouse") return;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pointerStartAt = performance.now();
}

function handlePointerEnd(event) {
  if (!pointerStartAt || event.pointerType === "mouse") return;
  finishSwipe(pointerStartX, pointerStartY, event.clientX, event.clientY, pointerStartAt);
  clearPointerSwipe();
}

function clearPointerSwipe() {
  pointerStartX = 0;
  pointerStartY = 0;
  pointerStartAt = 0;
}

function handleWheel(event) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();

  const now = performance.now();
  if (now < snapLockedUntil) return;

  wheelDelta += event.deltaY;
  if (wheelTimer) window.clearTimeout(wheelTimer);
  wheelTimer = window.setTimeout(() => {
    wheelDelta = 0;
  }, 90);

  if (Math.abs(wheelDelta) < WHEEL_STEP) return;
  const direction = wheelDelta > 0 ? 1 : -1;
  wheelDelta = 0;
  snapToRelative(direction);
}

function handleTouchEnd(event) {
  const touch = event.changedTouches[0];
  if (!touch || !touchStartAt) return;

  finishSwipe(touchStartX, touchStartY, touch.clientX, touch.clientY, touchStartAt);
  touchStartAt = 0;
}

function finishSwipe(startX, startY, endX, endY, startedAt) {
  const deltaY = startY - endY;
  const deltaX = startX - endX;
  const elapsed = Math.max(1, performance.now() - startedAt);
  const velocity = Math.abs(deltaY) / elapsed;
  if (Math.abs(deltaY) <= Math.abs(deltaX) || performance.now() < snapLockedUntil) return;
  if (Math.abs(deltaY) > SWIPE_DISTANCE || velocity > SWIPE_VELOCITY) {
    boardTapLockedUntil = performance.now() + BOARD_TAP_LOCK_MS;
    snapToRelative(deltaY > 0 ? 1 : -1);
    return;
  }

  snapToIndex(clampIndex(feed.scrollTop / pageHeight()), "smooth");
}

function bindActions() {
  skipButton.addEventListener("click", () => {
    beginAudio();
    skipActive();
  });
  revealButton.addEventListener("click", () => {
    beginAudio();
    revealActive();
  });
  saveButton.addEventListener("click", () => {
    beginAudio();
    toggleFavorite();
  });
  resetButton.addEventListener("click", () => {
    beginAudio();
    resetActive();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === " ") {
      event.preventDefault();
      skipActive();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      goToPrevious();
      return;
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      revealActive();
      return;
    }
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      toggleFavorite();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetActive();
    }
  });
}

boot();

async function boot() {
  await loadPuzzles();

  try {
    applySavedState(await readSavedState());
  } catch {}

  buildFeed();
  watchPanels();
  bindSwipeNavigation();
  bindActions();
  updateDock();
  setupPersistence();
  registerServiceWorker();
  document.documentElement.dataset.moveRush = "ready";
}

async function loadPuzzles() {
  const module = await import("./puzzles.js");
  PUZZLES = Array.isArray(module.PUZZLES) ? module.PUZZLES : [];
  PUZZLE_IDS.clear();
  for (const puzzle of PUZZLES) {
    if (typeof puzzle.id === "string") PUZZLE_IDS.add(puzzle.id);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}
