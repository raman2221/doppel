// Small JSON stores in Electron's userData folder. Writes go to a temp file
// first and are renamed into place, so a crash never leaves half a file.
import fs from "node:fs";
import path from "node:path";

let baseDir = null;

export function initStore(dir) {
  baseDir = dir;
  fs.mkdirSync(baseDir, { recursive: true });
}

export const dataPath = (...parts) => path.join(baseDir, ...parts);

export function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

export function writeJson(name, value) {
  const file = dataPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---- settings ----------------------------------------------------------------

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Most capable (default)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Faster, about half the cost" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest and cheapest" },
];

export const APPROVAL_MODES = ["ask_every_time", "ask_before_ships", "dont_ask"];

const DEFAULT_SETTINGS = {
  model: "claude-opus-5-5",
  effort: "medium",
  approvalMode: "ask_before_ships",
  sendPreviewSeconds: 5,
  email: { address: "", imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 },
  browser: { channel: "chrome" },
  shortcut: "CommandOrControl+Shift+Space",
};

export function getSettings() {
  const saved = readJson("settings.json", {});
  return { ...DEFAULT_SETTINGS, ...saved, email: { ...DEFAULT_SETTINGS.email, ...saved.email }, browser: { ...DEFAULT_SETTINGS.browser, ...saved.browser } };
}

export function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch, email: { ...current.email, ...patch.email }, browser: { ...current.browser, ...patch.browser } };
  if (!MODELS.some((m) => m.id === next.model)) next.model = DEFAULT_SETTINGS.model;
  if (!APPROVAL_MODES.includes(next.approvalMode)) next.approvalMode = DEFAULT_SETTINGS.approvalMode;
  if (!["low", "medium", "high"].includes(next.effort)) next.effort = DEFAULT_SETTINGS.effort;
  next.sendPreviewSeconds = Math.min(Math.max(Number(next.sendPreviewSeconds) || 5, 3), 30);
  writeJson("settings.json", next);
  return next;
}
