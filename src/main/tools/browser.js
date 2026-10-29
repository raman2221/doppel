// Browser errands in a real Chrome window with its own Doppel profile, so
// sign-ins persist between tasks. Doppel reads the page as a numbered list of
// fields and buttons, acts on one element at a time, and re-reads the page
// after every action to confirm what happened.
import { dataPath, getSettings } from "../store.js";
import { isSensitiveLabel, isSensitiveAutocomplete, containsSensitiveValue, SENSITIVE_REFUSAL } from "./sensitive.js";

const PAYMENT_WORDS = /\b(pay|payment|place (your )?order|buy|purchase|checkout|check out|complete (purchase|order)|subscribe|confirm (and )?pay|donate|tip)\b/i;
const SHIP_WORDS = /\b(submit|send|post|publish|book|reserve|confirm|apply|register|sign up|create account|delete|remove|cancel (my )?(account|subscription|order)|save changes|continue to)\b/i;
const MAX_ELEMENTS = 150;

let context = null;
let page = null;
let idleTimer = null;

// A browser window holds a few hundred MB, which matters on an 8 GB laptop,
// so it closes itself after a few idle minutes. Sign-ins survive in the profile.
const IDLE_CLOSE_MS = 3 * 60 * 1000;

function keepAlive() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_CLOSE_MS);
}

async function ensurePage() {
  keepAlive();
  if (page && !page.isClosed()) return page;
  const { browser } = getSettings();
  const { chromium } = await import("playwright-core"); // loaded on the first errand
  const launch = (channel) =>
    chromium.launchPersistentContext(dataPath("browser-profile"), {
      channel,
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-features=Translate,MediaRouter,OptimizationHints",
        "--renderer-process-limit=3", // fewer tab processes on low-memory machines
        "--mute-audio",
      ],
    });
  const fallback = process.platform === "win32" ? "msedge" : null; // Edge ships with every copy of Windows
  try {
    context = await launch(browser.channel);
  } catch (err) {
    if (!fallback || fallback === browser.channel) {
      throw new Error(`Couldn't open ${browser.channel === "msedge" ? "Microsoft Edge" : "Google Chrome"}. Install it (or pick the other browser in Settings), then try again.`);
    }
    context = await launch(fallback);
  }
  context.on("close", () => {
    context = null;
    page = null;
    clearTimeout(idleTimer);
  });
  page = context.pages()[0] ?? (await context.newPage());
  return page;
}

export async function closeBrowser() {
  clearTimeout(idleTimer);
  await context?.close().catch(() => {});
}

// Runs inside the page: number every visible interactive element and
// describe it the way a person would see it.
export function collectElements(max) {
  const selector = "a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=checkbox], [role=tab], [contenteditable=true]";
  const labelFor = (el) => {
    const aria = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.innerText);
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText;
    const wrapping = el.closest("label")?.innerText;
    const text = ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ? "" : el.innerText;
    return (aria || byFor || wrapping || el.getAttribute("placeholder") || text || el.getAttribute("title") || el.getAttribute("name") || el.getAttribute("value") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
  };
  document.querySelectorAll("[data-doppel-ref]").forEach((el) => el.removeAttribute("data-doppel-ref"));
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none" || el.disabled) continue;
    const ref = out.length + 1;
    el.setAttribute("data-doppel-ref", String(ref));
    const type = (el.getAttribute("type") || "").toLowerCase();
    const item = {
      ref,
      kind: el.tagName === "A" ? "link" : el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "INPUT" ? `input:${type || "text"}` : el.getAttribute("role") || "button",
      label: labelFor(el),
      name: el.getAttribute("name") || undefined,
      autocomplete: el.getAttribute("autocomplete") || undefined,
    };
    if (el.tagName === "SELECT") item.options = [...el.options].map((o) => o.text.trim()).slice(0, 30);
    if (["INPUT", "TEXTAREA"].includes(el.tagName) && !["checkbox", "radio", "submit", "button"].includes(type)) item.value = type === "password" ? (el.value ? "••••" : "") : el.value.slice(0, 80);
    if (["checkbox", "radio"].includes(type)) item.checked = el.checked;
    if (type === "submit" || (el.tagName === "BUTTON" && (el.getAttribute("type") || "submit") === "submit" && el.form)) item.submits = true;
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

async function snapshot(note = "") {
  const p = await ensurePage();
  await p.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  const elements = await p.evaluate(collectElements, MAX_ELEMENTS);
  const text = await p.evaluate(() => document.body?.innerText?.replace(/\n{3,}/g, "\n\n").slice(0, 4000) ?? "");
  const asksForPayment = elements.some((e) => isSensitiveAutocomplete(e.autocomplete) && /^cc-/.test(e.autocomplete ?? ""));
  return JSON.stringify({
    note: note || undefined,
    url: p.url(),
    title: await p.title(),
    warning: asksForPayment ? "This page asks for payment details. Stop here and tell the user what's in the cart and the total; they'll pay themselves." : undefined,
    elements,
    pageText: text,
  });
}

async function element(ref) {
  const p = await ensurePage();
  const handle = await p.$(`[data-doppel-ref="${Number(ref)}"]`);
  if (!handle) throw new Error(`No element ${ref} on the page. Call browser_snapshot to get fresh numbers.`);
  const info = await handle.evaluate((el) => ({
    label: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("value") || el.getAttribute("placeholder") || el.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 100),
    type: (el.getAttribute("type") || "").toLowerCase(),
    name: el.getAttribute("name") || "",
    id: el.id || "",
    autocomplete: el.getAttribute("autocomplete") || "",
    labelText: (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.closest("label")?.innerText || "",
    submits: el.getAttribute("type") === "submit" || (el.tagName === "BUTTON" && (el.getAttribute("type") || "submit") === "submit" && Boolean(el.form)),
  }));
  return { p, handle, info };
}

function assertNotSensitive(info, value) {
  if (info.type === "password" || isSensitiveAutocomplete(info.autocomplete) || isSensitiveLabel(info.label, info.name, info.id, info.labelText) || containsSensitiveValue(value)) {
    throw new Error(SENSITIVE_REFUSAL);
  }
}

async function settle(p) {
  await p.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
}

export const tools = [
  {
    name: "browser_open",
    description: "Open a URL in the Doppel browser window and return the page: a numbered list of fields, buttons, and links, plus the visible text.",
    actionClass: "read",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: async ({ url }) => {
      const p = await ensurePage();
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      await p.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(p);
      return snapshot();
    },
  },
  {
    name: "browser_snapshot",
    description: "Re-read the current page: numbered fields, buttons, and links, plus visible text. Element numbers change after every snapshot.",
    actionClass: "read",
    input_schema: { type: "object", properties: {} },
    run: () => snapshot(),
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the browser window to check visually that a step worked.",
    actionClass: "read",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const p = await ensurePage();
      const data = (await p.screenshot({ type: "jpeg", quality: 50 })).toString("base64");
      return [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
        { type: "text", text: `Screenshot of ${p.url()}` },
      ];
    },
  },
  {
    name: "browser_fill",
    description: "Type into a field by its number. Refuses password, SSN, and card fields; those are for the user.",
    actionClass: "local",
    input_schema: { type: "object", properties: { ref: { type: "integer" }, value: { type: "string" } }, required: ["ref", "value"] },
    run: async ({ ref, value }, ctx) => {
      const { p, handle, info } = await element(ref);
      assertNotSensitive(info, value);
      if (!(await ctx.approve({ actionClass: "local", title: `Type into "${info.label || info.name}"`, detail: value }))) return "The user declined this step.";
      await handle.fill(String(value));
      return snapshot(`Filled "${info.label || info.name}".`);
    },
  },
  {
    name: "browser_select",
    description: "Choose an option in a dropdown by its number and the option's visible text.",
    actionClass: "local",
    input_schema: { type: "object", properties: { ref: { type: "integer" }, option: { type: "string" } }, required: ["ref", "option"] },
    run: async ({ ref, option }, ctx) => {
      const { handle, info } = await element(ref);
      assertNotSensitive(info, option);
      if (!(await ctx.approve({ actionClass: "local", title: `Choose "${option}" in "${info.label || info.name}"` }))) return "The user declined this step.";
      await handle.selectOption({ label: option });
      return snapshot(`Selected "${option}".`);
    },
  },
  {
    name: "browser_click",
    description: "Click a button, link, checkbox, or tab by its number. Clicks that submit, send, book, or pay pause for the user's approval depending on their settings; payment always does.",
    actionClass: "local",
    input_schema: { type: "object", properties: { ref: { type: "integer" } }, required: ["ref"] },
    run: async ({ ref }, ctx) => {
      const { p, handle, info } = await element(ref);
      const label = info.label || info.name || `element ${ref}`;
      const actionClass = PAYMENT_WORDS.test(label) ? "payment" : SHIP_WORDS.test(label) || info.submits ? "ships" : "local";
      const ok = await ctx.approve({ actionClass, title: `Click "${label}" on ${new URL(p.url()).host}`, detail: actionClass === "payment" ? "This looks like it spends money." : "" });
      if (!ok) return "The user declined this click. Don't retry it.";
      await handle.click({ timeout: 10000 });
      await settle(p);
      return snapshot(`Clicked "${label}".`);
    },
  },
  {
    name: "browser_press",
    description: "Press a key in the page, such as Enter, Tab, Escape, or ArrowDown.",
    actionClass: "local",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    run: async ({ key }, ctx) => {
      const p = await ensurePage();
      const actionClass = /^enter$/i.test(key) ? "ships" : "local";
      if (!(await ctx.approve({ actionClass, title: `Press ${key} on ${new URL(p.url()).host}` }))) return "The user declined this step.";
      await p.keyboard.press(key);
      await settle(p);
      return snapshot(`Pressed ${key}.`);
    },
  },
];
