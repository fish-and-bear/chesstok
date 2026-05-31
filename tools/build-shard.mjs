import fs from "node:fs";
import readline from "node:readline";
import { TextDecoder } from "node:util";

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  console.error("Usage: node build-shard.mjs lichess_db_puzzle.csv [--limit 5000] [--out puzzles.js] [--format compact|full]");
  process.exit(1);
}

const limit = Number(args.limit || 5000);
const out = args.out || "puzzles.js";
const format = args.format || "compact";
const minRating = Number(args["min-rating"] || 0);
const maxRating = Number(args["max-rating"] || 4000);
const minPopularity = Number(args["min-popularity"] || -100);
const maxDeviation = Number(args["max-deviation"] || 500);
const skipThemes = new Set((args["skip-themes"] || "veryLong").split(",").filter(Boolean));
const rows = [];

let headerSeen = false;
await readLines(args.input, (line) => {
  if (!headerSeen) {
    headerSeen = true;
    return rows.length < limit;
  }
  if (!line.trim()) return rows.length < limit;

  const row = parseLichessRow(line);
  if (!row) return rows.length < limit;
  if (row.rating < minRating || row.rating > maxRating) return rows.length < limit;
  if (row.popularity < minPopularity) return rows.length < limit;
  if (row.ratingDeviation > maxDeviation) return rows.length < limit;
  if (row.themes.some((theme) => skipThemes.has(theme))) return rows.length < limit;

  rows.push(row);
  return rows.length < limit;
});
rows.length = Math.min(rows.length, limit);

rows.sort((a, b) => b.popularity - a.popularity || b.plays - a.plays || a.rating - b.rating);

const body =
  format === "full"
    ? `export const PUZZLES = ${JSON.stringify(rows, null, 2)};\n`
    : `export const PUZZLE_FIELDS = ["id","fen","moves","rating","popularity"];\nexport const PUZZLES = ${JSON.stringify(rows.map(toCompactRow))};\n`;
fs.writeFileSync(out, body);
console.log(`Wrote ${rows.length} puzzles to ${out}`);

function parseArgs(parts) {
  const parsed = {};
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part.startsWith("--") && !parsed.input) {
      parsed.input = part;
      continue;
    }
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = parts[i + 1];
      parsed[key] = next && !next.startsWith("--") ? next : "true";
      if (parsed[key] === next) i += 1;
    }
  }
  return parsed;
}

async function readLines(input, onLine) {
  if (input.endsWith(".zst")) {
    await readZstdLines(input, onLine);
    return;
  }

  const stream = fs.createReadStream(input, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!onLine(line)) {
      rl.close();
      stream.destroy();
      break;
    }
  }
}

async function readZstdLines(input, onLine) {
  let fzstd;
  try {
    fzstd = await import("fzstd");
  } catch {
    console.error("Reading .zst files requires the fzstd package. Run `pnpm add fzstd` first.");
    process.exit(1);
  }

  const textDecoder = new TextDecoder();
  const compressed = fs.createReadStream(input);
  let carry = "";
  let keepGoing = true;

  function consume(text) {
    if (!keepGoing) return;
    carry += text;
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() || "";

    for (const line of lines) {
      keepGoing = onLine(line);
      if (!keepGoing) {
        compressed.destroy();
        break;
      }
    }
  }

  const decompressor = new fzstd.Decompress((chunk, isLast) => {
    if (!keepGoing) return;
    consume(textDecoder.decode(chunk, { stream: !isLast }));
  });

  await new Promise((resolve, reject) => {
    compressed.on("data", (chunk) => {
      if (!keepGoing) return;
      try {
        decompressor.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } catch (error) {
        reject(error);
      }
    });
    compressed.on("end", () => {
      try {
        decompressor.push(new Uint8Array(0), true);
        if (carry && keepGoing) onLine(carry);
        resolve();
      } catch (error) {
        if (rows.length > 0) resolve();
        else reject(error);
      }
    });
    compressed.on("close", resolve);
    compressed.on("error", reject);
  });
}

function parseLichessRow(line) {
  const columns = line.split(",");
  if (columns.length < 9) return null;
  const [
    id,
    fen,
    moves,
    rating,
    ratingDeviation,
    popularity,
    plays,
    themes,
    gameUrl,
    openingTags = ""
  ] = columns;

  const game = gameUrl.replace("https://lichess.org/", "");
  const opening = openingTags ? openingTags.split(" ")[0].replaceAll("_", " ") : null;

  return {
    id,
    game,
    fen,
    moves,
    rating: Number(rating),
    popularity: Number(popularity),
    plays: Number(plays),
    themes: themes.split(" ").filter(Boolean),
    opening,
    ratingDeviation: Number(ratingDeviation)
  };
}

function toCompactRow(row) {
  return [row.id, row.fen, row.moves, row.rating, row.popularity];
}
