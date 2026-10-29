// Tamper-evident activity log. Each entry stores the SHA-256 of the entry
// before it, so editing or deleting a line in the middle breaks the chain.
// The latest 1,000 entries are kept.
import fs from "node:fs";
import crypto from "node:crypto";
import { dataPath } from "./store.js";

const MAX_ENTRIES = 1000;
const GENESIS = "0".repeat(64);

const file = () => dataPath("audit.jsonl");

function readAll() {
  if (!fs.existsSync(file())) return [];
  return fs
    .readFileSync(file(), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { corrupt: true, raw: line };
      }
    });
}

function hashOf(entry) {
  const { hash, ...body } = entry;
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

// The last hash and entry count are cached, so recording an action is one
// small append instead of re-reading the whole log.
let tail = null;
function getTail() {
  if (!tail) {
    const entries = readAll();
    tail = { hash: entries.at(-1)?.hash ?? GENESIS, count: entries.length };
  }
  return tail;
}

export function record({ taskId = null, action, tool = null, decision = null, detail = "" }) {
  const t = getTail();
  const entry = { at: new Date().toISOString(), taskId, action, tool, decision, detail: String(detail).slice(0, 500), prevHash: t.hash };
  entry.hash = hashOf(entry);
  fs.appendFileSync(file(), JSON.stringify(entry) + "\n");
  t.hash = entry.hash;
  t.count += 1;
  // Trim in batches rather than rewriting the file on every action.
  if (t.count > MAX_ENTRIES + 100) {
    const kept = readAll().slice(-MAX_ENTRIES);
    fs.writeFileSync(file(), kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
    t.count = kept.length;
  }
  return entry;
}

export function list(limit = 200) {
  return readAll().slice(-limit).reverse();
}

// Check every entry's own hash and its link to the entry before it. The
// oldest kept entry is the anchor, since older entries were trimmed away.
export function verify() {
  const entries = readAll();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.corrupt) return { ok: false, count: entries.length, brokenAt: i, reason: "An entry isn't valid JSON." };
    if (hashOf(e) !== e.hash) return { ok: false, count: entries.length, brokenAt: i, reason: `Entry from ${e.at} was edited after it was written.` };
    if (i > 0 && e.prevHash !== entries[i - 1].hash) return { ok: false, count: entries.length, brokenAt: i, reason: `The chain is broken before the entry from ${e.at}; an entry was removed or reordered.` };
  }
  return { ok: true, count: entries.length };
}
