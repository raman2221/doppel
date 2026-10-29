// API keys and the email app password, encrypted with the OS keychain
// (DPAPI on Windows, Keychain on macOS) through Electron's safeStorage.
// They are decrypted once at startup into memory, never go to the renderer,
// and never appear in a prompt.
import { safeStorage } from "electron";
import { readJson, writeJson } from "./store.js";

const FILE = "secrets.json";
const NAMES = ["anthropicKey", "emailPassword"];
const cache = new Map();

export async function loadSecrets() {
  const stored = readJson(FILE, {});
  for (const name of NAMES) {
    if (!stored[name]) continue;
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(stored[name], "base64"));
      cache.set(name, result);
      if (shouldReEncrypt) await setSecret(name, result);
    } catch {
      // Encrypted on another machine or by another user: treat as unset.
    }
  }
}

export async function setSecret(name, value) {
  if (!NAMES.includes(name)) throw new Error(`Unknown secret ${name}.`);
  const all = readJson(FILE, {});
  const clean = String(value ?? "").trim();
  if (!clean) {
    delete all[name];
    cache.delete(name);
  } else {
    all[name] = (await safeStorage.encryptStringAsync(clean)).toString("base64");
    cache.set(name, clean);
  }
  writeJson(FILE, all);
}

export const getSecret = (name) => cache.get(name) ?? null;

export function secretStatus() {
  return Object.fromEntries(NAMES.map((n) => [n, cache.has(n)]));
}

// Remove any secret value from text before it is shown, logged, or sent to Claude.
export function redact(text) {
  let out = String(text ?? "");
  for (const value of cache.values()) {
    if (value.length >= 6) out = out.split(value).join("[redacted]");
  }
  return out.replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, "[redacted]");
}
