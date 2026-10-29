// Undo journal. Changes that stay on this machine (reminders, memory, filled
// files, archived mail) can be reversed for 30 minutes. Sent messages and
// anything a website has already received cannot.
import { readJson, writeJson, newId } from "./store.js";
import * as audit from "./audit.js";

const WINDOW_MS = 30 * 60 * 1000;
const FILE = "undo.json";
const handlers = new Map();

// Each tool module registers how to reverse its own changes.
export function registerUndo(type, fn) {
  handlers.set(type, fn);
}

export function push({ taskId, label, type, data }) {
  const all = readJson(FILE, []).filter((u) => Date.now() - u.at < WINDOW_MS && !u.done);
  const entry = { id: newId("undo"), at: Date.now(), taskId, label, type, data, done: false };
  all.push(entry);
  writeJson(FILE, all);
  return entry.id;
}

export function list() {
  return readJson(FILE, [])
    .filter((u) => !u.done && Date.now() - u.at < WINDOW_MS)
    .map(({ id, at, label, taskId }) => ({ id, at, label, taskId, expiresAt: at + WINDOW_MS }))
    .reverse();
}

export async function run(id) {
  const all = readJson(FILE, []);
  const entry = all.find((u) => u.id === id);
  if (!entry || entry.done) throw new Error("That change was already undone.");
  if (Date.now() - entry.at >= WINDOW_MS) throw new Error("The 30-minute undo window for that change has passed.");
  const handler = handlers.get(entry.type);
  if (!handler) throw new Error(`Can't undo ${entry.type}.`);
  await handler(entry.data);
  entry.done = true;
  writeJson(FILE, all);
  audit.record({ taskId: entry.taskId, action: "undo", detail: entry.label });
  return entry.label;
}
