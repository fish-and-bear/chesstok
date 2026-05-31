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
const ASSET_VERSION = "49";
const PIECE_SPRITE = `./pieces.svg?v=${ASSET_VERSION}`;
const PUZZLE_MODULE = `./puzzles.js?v=${ASSET_VERSION}`;

let PUZZLES = [];
let RATING_SORTED_PUZZLES = [];
let MIN_PUZZLE_RATING = 300;
let MAX_PUZZLE_RATING = 3200;
let MAX_PUZZLE_POPULARITY = 100;

const PERF_MODE = new URLSearchParams(window.location.search).has("perf");
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const PUZZLE_IDS = new Set();
const LEGACY_SLUG = ["move", "rush"].join("-");
const STORAGE_KEY = "chesstok-state-v1";
const LEGACY_STORAGE_KEYS = [`${LEGACY_SLUG}-state-v2`];
const STORAGE_DB = "chesstok-db";
const LEGACY_STORAGE_DBS = [`${LEGACY_SLUG}-db`];
const STORAGE_STORE = "snapshots";
const STORAGE_ID = "primary";
const STORAGE_VERSION = 3;
const SYNC_CHANNEL = "chesstok-state";
const LEGACY_SYNC_CHANNELS = [`${LEGACY_SLUG}-state`];
const SAVE_DEBOUNCE = 180;
const STREAK_CLOCK_MS = 60_000;
const CLOCK_TICK_MS = 250;
const MOVE_DELAY = 420;
const RUSH_DELAY = 260;
const WHEEL_STEP = 34;
const WHEEL_GESTURE_END_MS = 180;
const SCROLL_GESTURE_END_MS = 900;
const SNAP_LOCK_MS = 430;
const SNAP_CLASS_MS = 520;
const BAD_SQUARE_MS = 360;
const BOARD_PAN_LOCK_MS = 340;
const BOARD_PAN_DISTANCE = 10;
const VIRTUAL_RADIUS = 3;
const STATE_CACHE_RADIUS = 8;
const ADAPTIVE_LOOKAHEAD = 18;
const ADAPTIVE_TARGET_OFFSETS = [0, 45, -35, 95, -65, 145, -95, 190, -125, 235, -160, 280, -195, 330, -230, 380, -270, 430];
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
const ratingValue = document.querySelector("#ratingValue");
const streakValue = document.querySelector("#streakValue");
const solvedValue = document.querySelector("#solvedValue");
const xpStat = document.querySelector("#xpStat");
const levelValue = document.querySelector("#levelValue");
const xpValue = document.querySelector("#xpValue");
const xpFill = document.querySelector("#xpFill");
const dock = document.querySelector("#dock");
const lineList = document.querySelector("#lineList");
const skipButton = document.querySelector("#skipButton");
const revealButton = document.querySelector("#revealButton");
const saveButton = document.querySelector("#saveButton");
const resetButton = document.querySelector("#resetButton");
const flowFill = document.querySelector("#flowFill");
const clockValue = document.querySelector("#clockValue");
const comboToast = document.querySelector("#comboToast");
const saveIcon = saveButton.querySelector("span");
const saveCount = document.querySelector("#saveCount");
const saveLabel = document.querySelector("#saveLabel");

document.documentElement.dataset.chesstok = "loading";
const bootStartedAt = performance.now();

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
  clockRemainingMs: STREAK_CLOCK_MS,
  lastPuzzleId: "",
  favorites: new Set(),
  solvedIds: new Set(),
  mutedUntilGesture: true,
  puzzles: [],
  feedStage: null,
  feedSpacer: null,
  puzzleIndexById: new Map(),
  panelHeight: 0,
  panels: [],
  mounted: new Set(),
  cached: new Set(),
  states: []
};

const storageClientId = makeStorageClientId();
const storageDbPromises = new Map();
let saveTimer = 0;
let saveQueue = Promise.resolve();
let lastAppliedAt = 0;
let syncChannels = [];
let snapLockedUntil = 0;
let snapClassTimer = 0;
let boardTapLockedUntil = 0;
let boardPointerStartX = 0;
let boardPointerStartY = 0;
let boardPointerStartAt = 0;
let wheelDelta = 0;
let wheelTimer = 0;
let wheelGestureConsumed = false;
let scrollGestureStartIndex = null;
let scrollGestureTimer = 0;
let scrollSettleTimer = 0;
let lastScrollTop = 0;
let lastScrollDirection = 0;
let resizeTimer = 0;
let lastTitleText = "";
let lastRatingText = "";
let lastStreakText = "";
let lastSolvedText = "";
let lastXpKey = "";
let lastXpTotal = -1;
let lastLineKey = "";
let lastAdaptKey = "";
let lastClockText = "";
let clockInterval = 0;
let clockResetTimer = 0;
let clockLastTick = 0;
let clockExpired = false;
let xpBumpTimer = 0;
let savePopTimer = 0;

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
  session.clockRemainingMs = normalized.clockRemainingMs;
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
  syncStreakClock({ allowExpire: false });
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
    clockRemainingMs: session.clockRemainingMs,
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
  const clockRemainingMs = safeInteger(value.clockRemainingMs, STREAK_CLOCK_MS, 0, STREAK_CLOCK_MS);
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
    clockRemainingMs,
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
  return [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]
    .map((key) => readStoredJson(key))
    .reduce((newest, snapshot) => chooseNewestSnapshot(newest, snapshot), null);
}

function readStoredJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
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
  const snapshots = await Promise.all([
    readDbSnapshotFrom(STORAGE_DB),
    ...LEGACY_STORAGE_DBS.map((name) => readDbSnapshotFrom(name, { legacy: true }))
  ]);
  return snapshots.reduce((newest, snapshot) => chooseNewestSnapshot(newest, snapshot), null);
}

async function readDbSnapshotFrom(name, { legacy = false } = {}) {
  try {
    if (legacy && !(await databaseExists(name))) return null;
    const db = await openStorageDb(name);
    if (!db) return null;
    return await idbRequest(db.transaction(STORAGE_STORE, "readonly").objectStore(STORAGE_STORE).get(STORAGE_ID));
  } catch {
    return null;
  }
}

async function databaseExists(name) {
  try {
    if (!indexedDB.databases) return false;
    return (await indexedDB.databases()).some((database) => database.name === name);
  } catch {
    return false;
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

function openStorageDb(name = STORAGE_DB) {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (storageDbPromises.has(name)) return storageDbPromises.get(name);

  const promise = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, STORAGE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORAGE_STORE)) db.createObjectStore(STORAGE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(null);
  });
  storageDbPromises.set(name, promise);

  return promise;
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

  window.addEventListener("pagehide", () => {
    syncStreakClock({ allowExpire: false });
    saveState({ immediate: true, broadcast: false });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      syncStreakClock({ allowExpire: false });
      saveState({ immediate: true, broadcast: false });
      return;
    }
    clockLastTick = performance.now();
  });

  window.addEventListener("storage", (event) => {
    if (![STORAGE_KEY, ...LEGACY_STORAGE_KEYS].includes(event.key) || !event.newValue) return;
    try {
      applyExternalSnapshot(JSON.parse(event.newValue));
    } catch {}
  });

  if ("BroadcastChannel" in window) {
    syncChannels = [SYNC_CHANNEL, ...LEGACY_SYNC_CHANNELS].map((name) => {
      const channel = new BroadcastChannel(name);
      channel.addEventListener("message", (event) => applyExternalSnapshot(event.data));
      return channel;
    });
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
  for (const channel of syncChannels) channel.postMessage(snapshot);
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

function legalMovesByFrom(game) {
  const movesByFrom = new Map();
  for (const move of game.moves({ verbose: true })) {
    const moves = movesByFrom.get(move.from);
    if (moves) moves.push(move);
    else movesByFrom.set(move.from, [move]);
  }
  return movesByFrom;
}

function movesFrom(movesByFrom, square) {
  return movesByFrom.get(square) || [];
}

function checkedKingSquare(game) {
  if (!game.isCheck()) return "";
  const color = game.turn();
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece?.type === "k" && piece.color === color) return piece.square;
    }
  }
  return "";
}

function isUserTurn(state) {
  return state.cursor % 2 === 1;
}

function canInteractWithBoard(state) {
  return !state.solved && state.reviewPly === null && isUserTurn(state) && !state.panel?.classList.contains("replying");
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

  const orientation = game.turn();

  return {
    puzzle,
    index,
    game,
    startFen: game.fen(),
    orientation,
    moves,
    cursor: 1,
    selected: null,
    solved: false,
    revealed: false,
    wrong: 0,
    userHits: 0,
    badSquares: [],
    activatedAt: 0,
    lastSquares: [],
    reviewPly: null,
    advanceTimer: 0,
    solution,
    panel: null,
    board: null,
    pulse: null,
    floaters: null,
    feedback: null,
    squareNodes: null,
    squareOrder: [],
    boardOrientation: ""
  };
}

function buildFeed() {
  const ranked = rankPuzzlesForTarget(adaptiveTargetRating());
  const unsolved = ranked.filter((puzzle) => !session.solvedIds.has(puzzle.id));
  const savedRank = session.lastPuzzleId ? ranked.findIndex((puzzle) => puzzle.id === session.lastPuzzleId) : -1;

  session.puzzles = unsolved.length ? unsolved : ranked;
  rebuildPuzzleIndex();

  session.states = new Array(session.puzzles.length).fill(null);
  session.panels = [];
  session.mounted.clear();
  session.cached.clear();
  lastAdaptKey = "";
  const savedIndex = findStartIndexAfterRefresh(savedRank, ranked);
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
  adaptUpcomingPuzzles(true);
  renderNearby(startIndex);
  session.panels[startIndex]?.classList.add("active");
  const firstState = ensureState(startIndex);
  if (firstState) firstState.activatedAt = performance.now();
  if (startIndex > 0) {
    window.requestAnimationFrame(() => scrollToPanel(startIndex, "auto"));
  }
}

function findStartIndexAfterRefresh(savedRank, ranked) {
  if (!session.lastPuzzleId) return -1;

  const exactIndex = session.puzzles.findIndex((puzzle) => puzzle.id === session.lastPuzzleId);
  if (exactIndex >= 0) return exactIndex;
  if (savedRank < 0) return -1;

  const nextPuzzle =
    findUnsolvedFromFullRank(ranked, savedRank + 1, 1) ||
    findUnsolvedFromFullRank(ranked, savedRank - 1, -1) ||
    null;
  return nextPuzzle ? session.puzzles.findIndex((puzzle) => puzzle.id === nextPuzzle.id) : -1;
}

function findUnsolvedFromFullRank(puzzles, start, step) {
  for (let index = start; index >= 0 && index < puzzles.length; index += step) {
    const puzzle = puzzles[index];
    if (puzzle && !session.solvedIds.has(puzzle.id)) return puzzle;
  }
  return null;
}

function startStreakClock() {
  clockLastTick = performance.now();
  if (clockInterval) window.clearInterval(clockInterval);
  clockInterval = window.setInterval(syncStreakClock, CLOCK_TICK_MS);
  updateClockDisplay();
}

function syncStreakClock({ allowExpire = true } = {}) {
  if (clockExpired || document.visibilityState === "hidden") return;
  const now = performance.now();
  const elapsed = clockLastTick ? now - clockLastTick : 0;
  clockLastTick = now;
  if (elapsed <= 0) {
    updateClockDisplay();
    return;
  }

  session.clockRemainingMs = Math.max(0, session.clockRemainingMs - elapsed);
  if (session.clockRemainingMs <= 0 && allowExpire) {
    expireStreakClock();
    return;
  }
  updateClockDisplay();
}

function resetStreakClock() {
  if (clockResetTimer) window.clearTimeout(clockResetTimer);
  clockResetTimer = 0;
  clockExpired = false;
  session.clockRemainingMs = STREAK_CLOCK_MS;
  clockLastTick = performance.now();
  document.body.classList.remove("clock-expired");
  updateClockDisplay();
}

function expireStreakClock() {
  if (clockExpired) return;
  clockExpired = true;
  const meaningfulStreak = session.streak > 1 || session.cleanRun > 1;
  session.clockRemainingMs = 0;
  session.streak = 0;
  session.cleanRun = 0;
  session.flow = Math.max(0, session.flow - (meaningfulStreak ? 22 : 10));
  adaptUpcomingPuzzles();
  document.body.classList.add("clock-expired");
  updateDock();
  updateClockDisplay();
  if (meaningfulStreak) {
    flash("Streak reset");
    tick("wrong");
  }
  saveState();
  clockResetTimer = window.setTimeout(() => {
    resetStreakClock();
    saveState();
  }, 650);
}

function updateClockDisplay() {
  const remaining = Math.max(0, Math.min(STREAK_CLOCK_MS, session.clockRemainingMs));
  const ratio = remaining / STREAK_CLOCK_MS;
  flowFill.style.transform = `scaleX(${ratio})`;
  const nextClockText = `${Math.ceil(remaining / 1000)}s`;
  if (lastClockText !== nextClockText) {
    clockValue.textContent = nextClockText;
    lastClockText = nextClockText;
  }
  document.body.classList.toggle("clock-mid", remaining > 15_000 && remaining <= 30_000);
  document.body.classList.toggle("clock-low", remaining > 0 && remaining <= 15_000);
  clockValue.setAttribute("aria-label", `${nextClockText} left to keep streak`);
}

function rankPuzzlesForTarget(target) {
  return [...PUZZLES].sort((a, b) => adaptivePuzzleScore(a, target) - adaptivePuzzleScore(b, target));
}

function adaptivePuzzleScore(puzzle, target) {
  return Math.abs(puzzle.rating - target) * 10 - puzzle.popularity;
}

function adaptiveTargetRating() {
  const tierLift = [0, 0, 115, 240, 390, 540][streakTier(session.streak)];
  const resetEase = session.streak === 0 ? -150 : 0;
  const flowLift = Math.round((session.flow - 45) * 1.7);
  return clampRating(session.band + tierLift + resetEase + flowLift);
}

function streakTier(streak) {
  if (streak >= 12) return 5;
  if (streak >= 8) return 4;
  if (streak >= 5) return 3;
  if (streak >= 3) return 2;
  return streak > 0 ? 1 : 0;
}

function clampRating(rating) {
  return Math.max(MIN_PUZZLE_RATING, Math.min(MAX_PUZZLE_RATING, Math.round(rating)));
}

function adaptUpcomingPuzzles(force = false) {
  if (!session.puzzles.length) return;
  const start = session.active + 1;
  if (start >= session.puzzles.length) return;

  const target = adaptiveTargetRating();
  const adaptKey = `${session.active}:${streakTier(session.streak)}:${Math.round(target / 25)}:${session.solvedIds.size}`;
  if (!force && adaptKey === lastAdaptKey) return;
  lastAdaptKey = adaptKey;

  const end = Math.min(session.puzzles.length, start + ADAPTIVE_LOOKAHEAD);
  const reserved = new Set();
  for (let index = 0; index < start; index += 1) {
    const puzzle = session.puzzles[index];
    if (puzzle) reserved.add(puzzle.id);
  }

  for (let slot = start; slot < end; slot += 1) {
    const slotTarget = clampRating(target + ADAPTIVE_TARGET_OFFSETS[(slot - start) % ADAPTIVE_TARGET_OFFSETS.length]);
    const candidate = findAdaptiveCandidate(slotTarget, start, reserved);
    if (!candidate) break;
    const candidateIndex = session.puzzleIndexById.get(candidate.id);
    if (!Number.isInteger(candidateIndex) || candidateIndex < start) continue;
    swapPuzzleSlots(slot, candidateIndex);
    reserved.add(candidate.id);
  }
}

function findAdaptiveCandidate(target, minIndex, reserved) {
  const center = lowerBoundPuzzleRating(target);
  let lower = center - 1;
  let upper = center;
  let bestPuzzle = null;
  let bestScore = Infinity;

  const canUse = (puzzle) => {
    if (!puzzle || reserved.has(puzzle.id)) return false;
    const index = session.puzzleIndexById.get(puzzle.id);
    if (!Number.isInteger(index) || index < minIndex) return false;
    return session.solvedIds.size >= PUZZLE_IDS.size || !session.solvedIds.has(puzzle.id);
  };

  const inspect = (puzzle) => {
    if (!canUse(puzzle)) return;
    const score = adaptivePuzzleScore(puzzle, target);
    if (score < bestScore) {
      bestScore = score;
      bestPuzzle = puzzle;
    }
  };

  while (lower >= 0 || upper < RATING_SORTED_PUZZLES.length) {
    if (upper < RATING_SORTED_PUZZLES.length) inspect(RATING_SORTED_PUZZLES[upper++]);
    if (lower >= 0) inspect(RATING_SORTED_PUZZLES[lower--]);

    if (!bestPuzzle) continue;

    const nextUpperDistance =
      upper < RATING_SORTED_PUZZLES.length ? Math.abs(RATING_SORTED_PUZZLES[upper].rating - target) : Infinity;
    const nextLowerDistance =
      lower >= 0 ? Math.abs(RATING_SORTED_PUZZLES[lower].rating - target) : Infinity;
    const bestPossibleNextScore = Math.min(nextUpperDistance, nextLowerDistance) * 10 - MAX_PUZZLE_POPULARITY;
    if (bestPossibleNextScore > bestScore) break;
  }

  return bestPuzzle;
}

function lowerBoundPuzzleRating(rating) {
  let low = 0;
  let high = RATING_SORTED_PUZZLES.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (RATING_SORTED_PUZZLES[mid].rating < rating) low = mid + 1;
    else high = mid;
  }
  return low;
}

function swapPuzzleSlots(a, b) {
  if (a === b) {
    resetPuzzleSlot(a);
    return;
  }

  const first = session.puzzles[a];
  const second = session.puzzles[b];
  session.puzzles[a] = second;
  session.puzzles[b] = first;
  if (second) session.puzzleIndexById.set(second.id, a);
  if (first) session.puzzleIndexById.set(first.id, b);
  resetPuzzleSlot(a);
  resetPuzzleSlot(b);
}

function resetPuzzleSlot(index) {
  if (index === session.active) return;
  unmountBoard(index);
  session.panels[index]?.remove();
  delete session.panels[index];
  session.states[index] = null;
  session.cached.delete(index);
  session.mounted.delete(index);
}

function rebuildPuzzleIndex() {
  session.puzzleIndexById = new Map();
  session.puzzles.forEach((puzzle, index) => {
    if (puzzle) session.puzzleIndexById.set(puzzle.id, index);
  });
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
  board.addEventListener("pointerdown", handleBoardPointerStart, { passive: true });
  board.addEventListener("pointermove", handleBoardPointerMove, { passive: true });
  board.addEventListener("pointerup", clearBoardPointer, { passive: true });
  board.addEventListener("pointercancel", clearBoardPointer, { passive: true });
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
  state.pulse = pulse;
  state.floaters = floaters;
  state.feedback = feedback;
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
  state.pulse = null;
  state.floaters = null;
  state.feedback = null;
  state.squareNodes = null;
  state.squareOrder = [];
  state.boardOrientation = "";
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
    const panel = session.panels[index];
    const active = index === session.active;
    panel?.classList.toggle("active", active);
    panel?.setAttribute("aria-current", active ? "true" : "false");
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
  const active = index === session.active;
  panel.classList.toggle("active", active);
  panel.setAttribute("aria-current", active ? "true" : "false");
  return panel;
}

function positionPanel(index) {
  const panel = session.panels[index];
  if (!panel) return;
  panel.style.setProperty("--panel-top", `${index * pageHeight()}px`);
}

function updateFeedMetrics() {
  const page = Math.max(1, Math.round(window.visualViewport?.height || feed.clientHeight || window.innerHeight || 1));
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
  state.reviewPly = null;
}

function syncPanelStateClasses(state) {
  if (!state.panel) return;
  state.panel.classList.toggle("solved", state.solved);
  state.panel.classList.toggle("revealed", state.revealed);
}

function orientationFor(state) {
  return state.orientation;
}

function squareOrder(orientation) {
  const files = orientation === "b" ? [...FILES].reverse() : FILES;
  const ranks = orientation === "b" ? [...RANKS].reverse() : RANKS;
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
}

function renderBoard(state) {
  if (!state.board) return;

  const orientation = orientationFor(state);
  if (state.boardOrientation !== orientation || !state.squareNodes) buildBoardGrid(state, orientation);

  const review = reviewSnapshot(state);
  const boardGame = review?.game || state.game;
  const activeColor = boardGame.turn();
  const interactive = canInteractWithBoard(state);
  const legalMoves = interactive ? legalMovesByFrom(boardGame) : new Map();
  const targets = interactive ? selectedTargets(state, legalMoves) : new Map();
  const checkSquare = checkedKingSquare(boardGame);
  const badSquares = new Set(state.badSquares);
  const lastSquares = new Set(review?.lastSquares || state.lastSquares);

  for (const square of state.squareOrder) {
    const nodes = state.squareNodes.get(square);
    const piece = boardGame.get(square);
    const target = targets.get(square);
    const classes = ["square", nodes.isLight ? "light" : "dark"];

    if (state.selected === square) classes.push("selected");
    if (square === checkSquare) classes.push("in-check");
    if (lastSquares.has(square)) classes.push("last-move");
    if (badSquares.has(square)) classes.push("bad");
    if (interactive && piece && piece.color === activeColor && movesFrom(legalMoves, square).length) classes.push("can-move");
    if (target) classes.push("target");
    if (target?.captured) classes.push("capture");

    nodes.button.className = classes.join(" ");
    nodes.button.setAttribute(
      "aria-label",
      piece
        ? `${piece.color === "w" ? "White" : "Black"} ${PIECE_NAMES[piece.type]} on ${square}${square === checkSquare ? ", in check" : ""}`
        : square
    );

    nodes.marker.hidden = !target;
    if (target) nodes.marker.className = target.captured ? "move-target capture-target" : "move-target dot-target";

    updatePieceNode(nodes, piece);
  }
}

function buildBoardGrid(state, orientation) {
  const nodesBySquare = new Map();
  const fragment = document.createDocumentFragment();
  const squares = squareOrder(orientation);

  for (const square of squares) {
    const button = document.createElement("button");
    const marker = document.createElement("span");
    const pieceLabel = document.createElement("span");

    button.type = "button";
    button.className = "square";
    button.setAttribute("role", "gridcell");
    button.dataset.square = square;

    marker.className = "move-target";
    marker.hidden = true;
    marker.setAttribute("aria-hidden", "true");

    pieceLabel.className = "piece";
    pieceLabel.hidden = true;

    button.append(marker, pieceLabel);
    fragment.append(button);
    nodesBySquare.set(square, {
      button,
      marker,
      pieceLabel,
      pieceId: "",
      isLight: (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 1
    });
  }

  state.board.replaceChildren(fragment);
  state.squareNodes = nodesBySquare;
  state.squareOrder = squares;
  state.boardOrientation = orientation;
}

function updatePieceNode(nodes, piece) {
  const pieceId = piece ? `${piece.color}${piece.type}` : "";
  if (nodes.pieceId === pieceId) return;

  nodes.pieceId = pieceId;
  nodes.pieceLabel.hidden = !piece;
  nodes.pieceLabel.replaceChildren(...(piece ? [createPieceSvg(piece)] : []));
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

function selectedTargets(state, legalMoves = legalMovesByFrom(state.game)) {
  if (!state.selected) return new Map();
  const targets = new Map();
  for (const move of movesFrom(legalMoves, state.selected)) {
    targets.set(move.to, move);
  }
  return targets;
}

function reviewSnapshot(state) {
  if (!Number.isInteger(state.reviewPly)) return null;
  const ply = clampReviewPly(state, state.reviewPly);
  const game = new Chess(state.startFen);
  let lastSquares = [];
  for (let index = 1; index <= ply; index += 1) {
    const move = applyUci(game, state.moves[index]);
    if (!move) break;
    lastSquares = [move.from, move.to];
  }
  return { game, lastSquares };
}

function clampReviewPly(state, ply) {
  return Math.max(0, Math.min(Math.round(Number(ply) || 0), state.solution.length));
}

function clearReview(state, { render = true } = {}) {
  if (state.reviewPly === null) return;
  state.reviewPly = null;
  if (render) {
    renderBoard(state);
    syncReviewLine(state, state.revealed || state.solved);
  }
}

function reviewLine(state, ply) {
  if (!state || (!state.revealed && !state.solved)) return;
  clearAutoAdvance(state);
  state.reviewPly = clampReviewPly(state, ply);
  state.selected = null;
  state.badSquares = [];
  state.panel?.classList.remove("select", "shake", "replying");
  renderBoard(state);
  markFeedback(state, state.reviewPly ? `Move ${state.reviewPly}/${state.solution.length}` : "Start");
  syncReviewLine(state, true);
}

function handleSquareTap(state, square) {
  if (state.reviewPly !== null) {
    clearReview(state);
    if (state.solved) return;
  }
  if (!canInteractWithBoard(state)) return;

  const piece = state.game.get(square);
  const turn = state.game.turn();
  const legalMoves = legalMovesByFrom(state.game);
  if (!state.selected) {
    if (piece && piece.color === turn && movesFrom(legalMoves, square).length) {
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
    if (movesFrom(legalMoves, square).length) {
      state.selected = square;
      renderBoard(state);
      markFeedback(state, "");
      pulsePanel(state, "select");
      updateDock();
      tick("tap");
    }
    return;
  }

  const expected = state.moves[state.cursor];
  const candidate = `${state.selected}${square}`;
  const promotionCandidate = `${candidate}q`;
  const legal = movesFrom(legalMoves, state.selected).find(
    (move) => moveToUci(move) === candidate || moveToUci(move) === promotionCandidate
  );

  if (!legal) return;

  const userUci = moveToUci(legal);
  if (userUci !== expected && !(legal.promotion && promotionCandidate === expected)) {
    miss(state, "", [state.selected, square]);
    return;
  }

  playExpectedMove(state, "user");
}

function playExpectedMove(state, actor) {
  clearReview(state, { render: false });
  const move = applyUci(state.game, state.moves[state.cursor]);
  state.lastSquares = [move.from, move.to];
  state.selected = null;
  state.badSquares = [];
  state.cursor += 1;
  if (actor === "user") state.userHits += 1;
  state.panel.classList.toggle("replying", actor === "user" && state.cursor < state.moves.length);
  renderBoard(state);
  markFeedback(state, "");
  if (actor === "user") {
    session.flow = Math.min(100, session.flow + 18 + Math.min(session.streak, 5) * 3);
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
  adaptUpcomingPuzzles();
  state.panel.classList.remove("shake");
  void state.panel.offsetWidth;
  state.panel.classList.add("shake");
  renderBoard(state);
  markFeedback(state, text);
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
    adaptUpcomingPuzzles();
    markFeedback(state, "Practice");
    updateDock();
    saveState();
    scheduleAutoAdvance(state);
    return;
  }

  if (alreadyCounted) {
    session.flow = Math.min(100, session.flow + 10);
    adaptUpcomingPuzzles();
    markFeedback(state, "Solved");
    updateDock();
    saveState();
    scheduleAutoAdvance(state);
    return;
  }

  session.solvedIds.add(state.puzzle.id);
  session.streak = state.wrong === 0 ? session.streak + 1 : 0;
  session.solved += 1;
  session.bestStreak = Math.max(session.bestStreak, session.streak);
  session.cleanRun = clean ? session.cleanRun + 1 : 0;
  session.flow = Math.min(100, session.flow + 26);
  session.band = Math.round(session.band * 0.82 + state.puzzle.rating * 0.18 + Math.min(session.streak, 8) * 10);
  resetStreakClock();
  adaptUpcomingPuzzles();
  const xp = awardSolveXp(state, clean, usedAnswer);
  const questBonus = updateQuest(clean);
  markFeedback(state, clean ? `+${xp + questBonus} XP` : `+${xp} XP`);
  comboFlash(session.streak, xp + questBonus);
  floatCue(state, `+${xp + questBonus}`, questBonus ? "bonus" : "good");
  updateDock();
  saveState();
  scheduleAutoAdvance(state);
}

function scheduleAutoAdvance(state) {
  clearAutoAdvance(state);
  state.advanceTimer = window.setTimeout(() => {
    state.advanceTimer = 0;
    if (session.active === state.index && state.reviewPly === null) goToNext();
  }, isRush() ? 900 : 1400);
}

function clearAutoAdvance(state) {
  if (!state?.advanceTimer) return;
  window.clearTimeout(state.advanceTimer);
  state.advanceTimer = 0;
}

function markFeedback(state, text) {
  const feedback = state.feedback;
  if (!feedback) return;
  feedback.textContent = text;
  feedback.classList.remove("pop");
  if (!text) return;
  void feedback.offsetWidth;
  feedback.classList.add("pop");
}

function floatCue(state, text, tone = "good") {
  const layer = state.floaters;
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
  if (streak < 3) return;
  comboToast.textContent = `Streak ${streak} +${xp}`;
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

function beginAudio() {
  session.mutedUntilGesture = false;
}

function tick(kind) {
  if (navigator.vibrate) {
    const pattern = kind === "wrong" ? [16, 16, 16] : kind === "bonus" ? [10, 18, 10] : kind === "correct" ? 10 : kind === "tap" ? 4 : 0;
    if (pattern) navigator.vibrate(pattern);
  }
}

function updateDock() {
  const state = ensureState(session.active);
  if (!state) return;
  const puzzle = state.puzzle;
  const side = state.game.turn() === "w" ? "White" : "Black";
  const inCheck = !state.solved && state.game.isCheck();
  const nextTitle = state.solved ? "Solved" : inCheck ? `${side} in check` : `${side} to move`;
  const nextRating = `${puzzle.rating} · ${difficultyForRating(puzzle.rating)}`;
  const nextStreak = String(session.streak);
  const nextSolved = String(session.solved);
  const favorite = session.favorites.has(puzzle.id);

  title.classList.toggle("in-check", inCheck);
  if (lastTitleText !== nextTitle) {
    title.textContent = nextTitle;
    lastTitleText = nextTitle;
  }
  if (lastRatingText !== nextRating) {
    ratingValue.textContent = nextRating;
    lastRatingText = nextRating;
  }
  if (lastStreakText !== nextStreak) {
    streakValue.textContent = nextStreak;
    lastStreakText = nextStreak;
  }
  if (lastSolvedText !== nextSolved) {
    solvedValue.textContent = nextSolved;
    lastSolvedText = nextSolved;
  }
  updateXpMeter();
  updateClockDisplay();
  document.body.classList.toggle("rush-mode", isRush());
  updateSaveControl(favorite);
  revealButton.disabled = state.solved;
  revealButton.setAttribute("aria-disabled", state.solved ? "true" : "false");

  const showLine = state.revealed || state.solved;
  const lineKey = showLine ? `${puzzle.id}:${state.solution.length}` : "";
  dock.classList.toggle("has-line", showLine);
  lineList.classList.toggle("visible", showLine);
  if (lineKey !== lastLineKey) {
    lineList.replaceChildren(...(showLine ? state.solution.map((move, index) => createLineItem(move, index + 1)) : []));
    lastLineKey = lineKey;
  }
  syncReviewLine(state, showLine);
}

function difficultyForRating(rating) {
  if (rating < 1000) return "easy";
  if (rating < 1400) return "medium";
  if (rating < 1800) return "hard";
  return "expert";
}

function updateXpMeter() {
  if (!xpStat || !levelValue || !xpValue || !xpFill) return;
  const progress = xpProgress(session.xp);
  const levelText = `Lv ${progress.level}`;
  const xpText = `${formatCompactNumber(progress.current)}/${formatCompactNumber(progress.needed)} XP`;
  const xpKey = `${levelText}|${xpText}|${Math.round(progress.ratio * 1000)}`;

  if (lastXpKey !== xpKey) {
    levelValue.textContent = levelText;
    xpValue.textContent = xpText;
    xpFill.style.transform = `scaleX(${progress.ratio.toFixed(4)})`;
    xpStat.setAttribute(
      "aria-label",
      `Level ${progress.level}, ${progress.current} of ${progress.needed} XP, ${progress.total} total XP`
    );
    lastXpKey = xpKey;
  }

  if (lastXpTotal >= 0 && progress.total > lastXpTotal) pulseXpMeter();
  lastXpTotal = progress.total;
}

function xpProgress(totalXp) {
  const total = safeInteger(totalXp, 0, 0, 10_000_000);
  let level = 1;
  let floor = 0;
  let needed = levelXpRequirement(level);

  while (level < 999 && total >= floor + needed) {
    floor += needed;
    level += 1;
    needed = levelXpRequirement(level);
  }

  const current = Math.max(0, total - floor);
  return {
    level,
    current,
    needed,
    ratio: needed ? Math.min(1, current / needed) : 1,
    total
  };
}

function levelXpRequirement(level) {
  return 120 + (level - 1) * 45;
}

function formatCompactNumber(value) {
  if (value < 1000) return String(value);
  if (value < 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(value / 1000)}k`;
}

function pulseXpMeter() {
  if (!xpStat) return;
  if (xpBumpTimer) window.clearTimeout(xpBumpTimer);
  xpStat.classList.remove("gain");
  void xpStat.offsetWidth;
  xpStat.classList.add("gain");
  xpBumpTimer = window.setTimeout(() => {
    xpStat.classList.remove("gain");
    xpBumpTimer = 0;
  }, 520);
}

function updateSaveControl(favorite = false) {
  const count = session.favorites.size;
  const countText = count > 99 ? "99+" : count ? String(count) : "";
  const label = favorite ? "Saved" : "Save";
  const detail = count === 1 ? "1 saved puzzle" : `${count} saved puzzles`;

  saveButton.classList.toggle("active", favorite);
  saveButton.classList.toggle("has-saves", count > 0);
  saveButton.setAttribute("aria-pressed", favorite ? "true" : "false");
  saveButton.setAttribute("aria-label", `${label} puzzle, ${detail}`);
  saveButton.title = favorite ? "Saved" : "Save";

  if (saveIcon) saveIcon.textContent = favorite ? "\u2605" : "\u2606";
  if (saveCount) saveCount.textContent = countText;
  if (saveLabel) saveLabel.textContent = label;
}

function pulseSaveButton() {
  if (savePopTimer) window.clearTimeout(savePopTimer);
  saveButton.classList.remove("just-saved");
  void saveButton.offsetWidth;
  saveButton.classList.add("just-saved");
  savePopTimer = window.setTimeout(() => {
    saveButton.classList.remove("just-saved");
    savePopTimer = 0;
  }, 360);
}

function syncReviewLine(state, showLine) {
  if (!showLine) return;
  const activePly = activeReviewPly(state);
  for (const button of lineList.querySelectorAll("[data-ply]")) {
    const active = Number(button.dataset.ply) === activePly;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
}

function activeReviewPly(state) {
  if (Number.isInteger(state.reviewPly)) return clampReviewPly(state, state.reviewPly);
  return clampReviewPly(state, state.cursor - 1);
}

function createLineItem(move, number) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  const moveNumber = document.createElement("span");
  const moveSan = document.createElement("b");
  button.type = "button";
  button.dataset.ply = String(number);
  button.setAttribute("aria-label", `Review move ${number}: ${move.san}`);
  moveNumber.textContent = number;
  moveSan.textContent = move.san;
  button.append(moveNumber, moveSan);
  item.append(button);
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
    clearAutoAdvance(previousState);
    renderBoard(previousState);
  }
  session.panels[previousIndex]?.classList.remove("active");
  session.panels[previousIndex]?.setAttribute("aria-current", "false");
  session.active = index;
  session.lastPuzzleId = session.puzzles[session.active]?.id || "";
  session.selected = null;
  adaptUpcomingPuzzles();
  renderNearby(session.active);
  const state = ensureState(session.active);
  if (state) {
    state.selected = null;
    state.badSquares = [];
    if (!state.activatedAt) state.activatedAt = performance.now();
    renderBoard(state);
  }
  session.panels[session.active]?.classList.add("active");
  session.panels[session.active]?.setAttribute("aria-current", "true");
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
  clearAutoAdvance(state);
  if (state.solved) return;
  if (!state.revealed && !state.solved) {
    session.streak = 0;
    session.cleanRun = 0;
  }
  state.revealed = true;
  state.selected = null;
  state.badSquares = [];
  session.flow = Math.max(0, session.flow - 10);
  adaptUpcomingPuzzles();
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
  clearAutoAdvance(old);
  const fresh = preparePuzzle(old.puzzle, old.index);
  fresh.panel = old.panel;
  fresh.board = old.board;
  fresh.pulse = old.pulse;
  fresh.floaters = old.floaters;
  fresh.feedback = old.feedback;
  fresh.activatedAt = performance.now();
  session.states[session.active] = fresh;
  old.panel.classList.remove("solved", "revealed", "shake", "select", "hit", "replying");
  old.pulse?.replaceChildren();
  old.floaters?.replaceChildren();
  markFeedback(fresh, "");
  renderBoard(fresh);
  updateDock();
}

function showFatalError(error) {
  console.error(error);
  stopStreakClock();
  document.documentElement.dataset.chesstok = "error";
  document.body.classList.remove("clock-mid", "clock-low", "clock-expired", "rush-mode", "is-snapping");
  feed.replaceChildren(createFatalErrorPanel());
  title.textContent = "Could not load";
  ratingValue.textContent = "check connection";
  streakValue.textContent = String(session.streak);
  solvedValue.textContent = String(session.solved);
  lineList.replaceChildren();
  dock.classList.remove("has-line");
  flowFill.style.transform = "scaleX(0)";
  clockValue.textContent = "";
}

function createFatalErrorPanel() {
  const panel = document.createElement("section");
  const heading = document.createElement("h2");
  const text = document.createElement("p");
  const button = document.createElement("button");

  panel.className = "boot-fail";
  panel.setAttribute("role", "alert");
  heading.textContent = "Puzzles did not load";
  text.textContent = "Reload once. If you are offline, reopen after the app finishes caching.";
  button.type = "button";
  button.textContent = "Reload";
  button.addEventListener("click", () => window.location.reload());

  panel.append(heading, text, button);
  return panel;
}

function skipActive() {
  const state = ensureState(session.active);
  if (!state) return;
  clearAutoAdvance(state);
  clearReview(state, { render: false });
  state.selected = null;
  state.badSquares = [];
  state.panel.classList.remove("select", "shake", "replying");
  renderBoard(state);
  session.flow = Math.max(0, session.flow - 6);
  adaptUpcomingPuzzles();
  markFeedback(state, "Skipped");
  updateDock();
  saveState();
  goToNext();
}

function handleBoardPointerStart(event) {
  if (event.pointerType === "mouse") return;
  boardPointerStartX = event.clientX;
  boardPointerStartY = event.clientY;
  boardPointerStartAt = performance.now();
}

function handleBoardPointerMove(event) {
  if (!boardPointerStartAt || event.pointerType === "mouse") return;
  const deltaX = Math.abs(event.clientX - boardPointerStartX);
  const deltaY = Math.abs(event.clientY - boardPointerStartY);
  if (deltaY < BOARD_PAN_DISTANCE || deltaY <= deltaX) return;
  boardTapLockedUntil = performance.now() + BOARD_PAN_LOCK_MS;
}

function clearBoardPointer() {
  boardPointerStartX = 0;
  boardPointerStartY = 0;
  boardPointerStartAt = 0;
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
    flash(`Saved ${session.favorites.size}`);
  }
  tick("tap");
  pulseSaveButton();
  updateDock();
  saveState({ immediate: true });
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
  const scheduleMetricsUpdate = () => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      updateFeedMetrics();
      renderNearby(session.active);
      snapToIndex(session.active, "auto");
    }, 120);
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
  feed.addEventListener("scrollend", snapToNearestPanel, { passive: true });
  feed.addEventListener("pointerdown", markScrollGestureStart, { passive: true });
  feed.addEventListener("touchstart", markScrollGestureStart, { passive: true });

  window.addEventListener("resize", scheduleMetricsUpdate, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleMetricsUpdate, { passive: true });
}

function markScrollGestureStart() {
  scrollGestureStartIndex = session.active;
  if (scrollGestureTimer) window.clearTimeout(scrollGestureTimer);
  scrollGestureTimer = window.setTimeout(() => {
    scrollGestureStartIndex = null;
    scrollGestureTimer = 0;
  }, SCROLL_GESTURE_END_MS);
}

function snapToNearestPanel() {
  const page = feed.scrollTop / pageHeight();
  const base = Math.floor(page);
  const progress = page - base;
  let next = clampIndex(page);
  if (lastScrollDirection > 0 && progress > 0.14) next = base + 1;
  if (lastScrollDirection < 0 && progress < 0.86) next = base;
  if (scrollGestureStartIndex !== null) {
    next = Math.max(scrollGestureStartIndex - 1, Math.min(scrollGestureStartIndex + 1, next));
  }
  next = clampIndex(next);
  const targetTop = scrollTopForIndex(next);
  if (Math.abs(feed.scrollTop - targetTop) <= 2) return;
  snapToIndex(next, "smooth");
}

function bindSwipeNavigation() {
  feed.addEventListener("wheel", handleWheel, { passive: false });
}

function handleWheel(event) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();

  if (wheelTimer) window.clearTimeout(wheelTimer);
  wheelTimer = window.setTimeout(() => {
    wheelDelta = 0;
    wheelGestureConsumed = false;
  }, WHEEL_GESTURE_END_MS);

  const now = performance.now();
  if (wheelGestureConsumed) return;
  if (now < snapLockedUntil) {
    wheelGestureConsumed = true;
    return;
  }

  wheelDelta += event.deltaY;
  if (Math.abs(wheelDelta) < WHEEL_STEP) return;
  const direction = wheelDelta > 0 ? 1 : -1;
  wheelDelta = 0;
  wheelGestureConsumed = true;
  snapToRelative(direction);
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
  lineList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ply]");
    if (!button) return;
    beginAudio();
    reviewLine(ensureState(session.active), Number(button.dataset.ply));
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
  try {
    await loadPuzzles();

    try {
      applySavedState(await readSavedState());
    } catch {}
    if (PERF_MODE) applyPerfOverrides();

    buildFeed();
    watchPanels();
    bindSwipeNavigation();
    bindActions();
    startStreakClock();
    updateDock();
    if (!PERF_MODE) setupPersistence();
    registerServiceWorker();
    document.documentElement.dataset.chesstok = "ready";
    publishPerfSnapshot();
  } catch (error) {
    showFatalError(error);
  }
}

async function loadPuzzles() {
  const module = await import(PUZZLE_MODULE);
  if (!Array.isArray(module.PUZZLES)) throw new Error("Puzzle module did not export PUZZLES");

  const ids = new Set();
  PUZZLES = [];
  PUZZLE_IDS.clear();

  for (const row of module.PUZZLES) {
    const puzzle = normalizePuzzle(row);
    if (!puzzle || ids.has(puzzle.id)) continue;
    ids.add(puzzle.id);
    PUZZLES.push(puzzle);
    PUZZLE_IDS.add(puzzle.id);
  }

  if (!PUZZLES.length) throw new Error("Puzzle shard is empty");

  RATING_SORTED_PUZZLES = [...PUZZLES].sort((a, b) => a.rating - b.rating || b.popularity - a.popularity);
  MIN_PUZZLE_RATING = RATING_SORTED_PUZZLES[0]?.rating || MIN_PUZZLE_RATING;
  MAX_PUZZLE_RATING = RATING_SORTED_PUZZLES[RATING_SORTED_PUZZLES.length - 1]?.rating || MAX_PUZZLE_RATING;
  MAX_PUZZLE_POPULARITY = Math.max(1, ...PUZZLES.map((puzzle) => puzzle.popularity));
}

function normalizePuzzle(puzzle) {
  if (Array.isArray(puzzle)) {
    return normalizePuzzleFields({
      id: puzzle[0],
      fen: puzzle[1],
      moves: puzzle[2],
      rating: puzzle[3],
      popularity: puzzle[4]
    });
  }

  if (!puzzle || typeof puzzle !== "object") return null;
  return normalizePuzzleFields({
    id: puzzle.id,
    fen: puzzle.fen,
    moves: puzzle.moves,
    rating: puzzle.rating,
    popularity: puzzle.popularity
  });
}

function normalizePuzzleFields(puzzle) {
  const id = typeof puzzle.id === "string" ? puzzle.id : "";
  const fen = typeof puzzle.fen === "string" ? puzzle.fen : "";
  const moves = typeof puzzle.moves === "string" ? puzzle.moves.trim() : "";
  const rating = safeInteger(puzzle.rating, 0, MIN_PUZZLE_RATING, MAX_PUZZLE_RATING);
  const popularity = safeInteger(puzzle.popularity, 0, 0, 10_000);

  if (!id || !fen || moves.split(/\s+/).length < 2 || rating <= 0) return null;
  return { id, fen, moves, rating, popularity };
}

function publishPerfSnapshot() {
  const upcomingRatings = session.puzzles.slice(session.active + 1, session.active + 13).map((puzzle) => puzzle.rating);
  const snapshot = Object.freeze({
    version: ASSET_VERSION,
    readyMs: Math.round(performance.now() - bootStartedAt),
    puzzles: session.puzzles.length,
    mountedBoards: session.mounted.size,
    liveReels: document.querySelectorAll(".reel").length,
    nodes: document.querySelectorAll("*").length,
    clockRemainingMs: Math.round(session.clockRemainingMs),
    adaptive: {
      target: adaptiveTargetRating(),
      streak: session.streak,
      band: session.band,
      flow: session.flow,
      upcomingAverage: average(upcomingRatings),
      upcomingRatings
    }
  });

  document.documentElement.dataset.readyMs = String(snapshot.readyMs);
  document.documentElement.dataset.puzzles = String(snapshot.puzzles);
  document.documentElement.dataset.mountedBoards = String(snapshot.mountedBoards);
  document.documentElement.dataset.liveReels = String(snapshot.liveReels);
  document.documentElement.dataset.nodes = String(snapshot.nodes);

  try {
    window.__chesstokPerf = snapshot;
  } catch {}
}

function applyPerfOverrides() {
  const params = new URLSearchParams(window.location.search);
  session.streak = perfIntegerParam(params, "streak", session.streak, 0, 1000);
  session.bestStreak = Math.max(session.bestStreak, session.streak);
  session.cleanRun = Math.min(session.streak, perfIntegerParam(params, "clean", session.cleanRun, 0, 1000));
  session.band = perfIntegerParam(params, "band", session.band, MIN_PUZZLE_RATING, MAX_PUZZLE_RATING);
  session.flow = perfIntegerParam(params, "flow", session.flow, 0, 100);
  session.xp = perfIntegerParam(params, "xp", session.xp, 0, 10_000_000);
  session.clockRemainingMs =
    perfIntegerParam(params, "clock", session.clockRemainingMs / 1000, 0, STREAK_CLOCK_MS / 1000) * 1000;
}

function perfIntegerParam(params, key, fallback, min, max) {
  return params.has(key) ? safeInteger(params.get(key), fallback, min, max) : fallback;
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

function stopStreakClock() {
  if (clockInterval) window.clearInterval(clockInterval);
  if (clockResetTimer) window.clearTimeout(clockResetTimer);
  if (xpBumpTimer) window.clearTimeout(xpBumpTimer);
  if (savePopTimer) window.clearTimeout(savePopTimer);
  if (wheelTimer) window.clearTimeout(wheelTimer);
  if (scrollGestureTimer) window.clearTimeout(scrollGestureTimer);
  clockInterval = 0;
  clockResetTimer = 0;
  xpBumpTimer = 0;
  savePopTimer = 0;
  wheelTimer = 0;
  wheelGestureConsumed = false;
  scrollGestureStartIndex = null;
  scrollGestureTimer = 0;
}
