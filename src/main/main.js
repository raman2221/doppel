import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme, globalShortcut, Notification, shell, powerSaveBlocker, powerMonitor } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initStore, getSettings, updateSettings, MODELS, APPROVAL_MODES } from "./store.js";
import { loadSecrets, setSecret, secretStatus } from "./secrets.js";
import * as audit from "./audit.js";
import * as undo from "./undo.js";
import { setNotifier, respond } from "./approvals.js";
import * as agent from "./agent.js";
import { loadMemory, saveFact, savePerson, forget, setStyle } from "./tools/memory.js";
import { listReminders, createReminder, deleteReminder, collectDue, upcomingBirthdays } from "./tools/reminders.js";
import { testConnection, sentSamples } from "./tools/email.js";
import { closeBrowser } from "./tools/browser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const smokeShot = process.argv.find((a) => a.startsWith("--smoke-shot="))?.split("=")[1];
const smokeView = process.argv.find((a) => a.startsWith("--smoke-view="))?.split("=")[1];

let win = null;
let tray = null;
let quitting = false;

// A crash in the main process would take the tray and reminders down with it,
// so errors are written to doppel.log in the user-data folder instead.
function logError(err) {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "doppel.log"), `${new Date().toISOString()} ${err?.stack || err}\n`);
  } catch {
    // nowhere left to report it
  }
}
process.on("uncaughtException", logError);
process.on("unhandledRejection", logError);

// Doppel's window is text and simple cards, so it doesn't need the GPU. Software
// rendering frees roughly 100 MB of GPU-process memory on small machines.
if (!process.argv.includes("--gpu")) app.disableHardwareAcceleration();

if (!smokeShot && !app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showWindow());

// The tray and window icon: two overlapping circles, you and your twin.
function twinIcon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.3;
  const circles = [
    { x: size * 0.38, y: size * 0.5, color: [0x1c, 0x15, 0x10] }, // BGR ink
    { x: size * 0.62, y: size * 0.5, color: [0x66, 0x7c, 0x0e] }, // BGR teal
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      for (const c of circles) {
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
        const alpha = Math.max(0, Math.min(1, r - d + 0.5));
        if (alpha > 0) {
          buf[i] = c.color[0];
          buf[i + 1] = c.color[1];
          buf[i + 2] = c.color[2];
          buf[i + 3] = Math.max(buf[i + 3], Math.round(alpha * 255));
        }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function showWindow(view) {
  if (!win) return createWindow(view);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (view) win.webContents.send("nav", view);
}

function createWindow(view) {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 880,
    minHeight: 580,
    title: "Doppel",
    icon: twinIcon(64),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e1116" : "#eef1f4",
    show: !smokeShot,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const hash = view && view !== "command" ? view : smokeView;
  win.loadFile(path.join(here, "..", "renderer", "index.html"), hash ? { hash } : undefined);

  // The window only ever shows Doppel's own page; links open in the real browser.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Closing the window destroys it to free its memory; tasks, reminders,
  // and the tray keep running, and the window is rebuilt when reopened.
  win.on("closed", () => (win = null));

  if (smokeShot) {
    win.webContents.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, 1500));
      fs.writeFileSync(smokeShot, (await win.webContents.capturePage()).toPNG());
      const totalMb = app.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024;
      console.log(`smoke memory: ${Math.round(totalMb)} MB across ${app.getAppMetrics().length} processes`);
      for (const p of app.getAppMetrics()) console.log(`  ${p.type}: ${Math.round(p.memory.workingSetSize / 1024)} MB (private ${Math.round((p.memory.privateBytes ?? 0) / 1024)} MB)`);
      quitting = true;
      app.quit();
    });
  }
}

function createTray() {
  tray = new Tray(twinIcon(16));
  tray.setToolTip("Doppel");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "New task", click: () => showWindow("tasks") },
      { label: "Reminders", click: () => showWindow("reminders") },
      { label: "Activity", click: () => showWindow("activity") },
      { type: "separator" },
      { label: "Quit Doppel", click: () => ((quitting = true), app.quit()) },
    ]),
  );
  tray.on("click", () => showWindow());
}

function notifyDesktop(title, body, view = "reminders") {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: twinIcon(64) });
    n.on("click", () => showWindow(view));
    n.show();
  }
}

// Task changes are batched (one update per task every 80 ms) so a busy task
// doesn't flood the window with re-renders.
const queuedUpdates = new Map();
let flushTimer = null;
function onTaskChange(task) {
  queuedUpdates.set(task.id, task);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    const batch = [...queuedUpdates.values()];
    queuedUpdates.clear();
    batch.forEach(deliverTaskUpdate);
    keepAwakeWhileWorking();
  }, 80);
}

// While a task runs, stop macOS App Nap from throttling Doppel in the background.
let wakeBlocker = null;
function keepAwakeWhileWorking() {
  const busy = agent.hasRunningTasks();
  if (busy && wakeBlocker === null) wakeBlocker = powerSaveBlocker.start("prevent-app-suspension");
  if (!busy && wakeBlocker !== null) {
    powerSaveBlocker.stop(wakeBlocker);
    wakeBlocker = null;
  }
}

// Push a task change to the window. If the window is closed or in the
// background when Doppel needs an answer, say so with a notification.
const notifiedSteps = new Set();
function deliverTaskUpdate(task) {
  win?.webContents.send("task:update", task);
  if (win?.isVisible() && win.isFocused()) return;
  for (const s of task.steps) {
    if (s.status !== "pending" || s.sendAt || notifiedSteps.has(s.id)) continue;
    if (s.type === "approval") notifyDesktop("Doppel needs your approval", s.title, `tasks/${task.id}`);
    else if (s.type === "question") notifyDesktop("Doppel has a question", s.question, `tasks/${task.id}`);
    else continue;
    notifiedSteps.add(s.id);
  }
}

// Reminders come due here. Ones with an action start a task on their own.
function tickScheduler() {
  for (const r of collectDue()) {
    notifyDesktop("Reminder", r.text);
    audit.record({ action: "reminder fired", detail: r.text });
    if (r.action) agent.startTask(`${r.action}\n\n(This task was started by your reminder: "${r.text}".)`, { origin: "reminder" });
  }
  for (const { person, daysAway } of upcomingBirthdays()) {
    notifyDesktop("Birthday coming up", daysAway === 0 ? `It's ${person.name}'s birthday today.` : `${person.name}'s birthday is in ${daysAway} day${daysAway === 1 ? "" : "s"}.`);
  }
}

// IPC: every handler returns { ok, data } or { ok: false, error } so the
// renderer gets a plain message instead of Electron's wrapped error text.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

function registerIpc() {
  handle("app:state", () => ({ settings: getSettings(), secrets: secretStatus(), models: MODELS, approvalModes: APPROVAL_MODES, version: app.getVersion(), platform: process.platform }));
  handle("settings:update", (patch) => updateSettings(patch));
  handle("secrets:set", (name, value) => setSecret(name, value).then(secretStatus));

  handle("email:test", () => testConnection());
  handle("email:train", async () => {
    const samples = await sentSamples(40);
    if (samples.length < 5) throw new Error(`Only found ${samples.length} sent emails with your own writing. Doppel needs at least 5.`);
    const guide = await agent.describeWritingStyle(samples);
    setStyle(guide, samples.length);
    audit.record({ action: "trained writing style", detail: `${samples.length} sent emails` });
    return loadMemory().style;
  });

  handle("tasks:list", () => agent.listTasks());
  handle("tasks:get", (id) => {
    const task = agent.getTask(id);
    return task ? agent.publicTask(task) : null;
  });
  handle("tasks:start", (text) => agent.startTask(text));
  handle("tasks:reply", (id, text) => agent.replyToTask(id, text));
  handle("tasks:stop", (id) => agent.stopTask(id));
  handle("tasks:resume", (id) => agent.resumeTask(id));
  handle("approvals:respond", (id, approved) => respond(id, approved));

  handle("memory:get", () => loadMemory());
  handle("memory:saveFact", (input) => saveFact(null, input));
  handle("memory:savePerson", (input) => savePerson(null, input));
  handle("memory:forget", (id) => forget(null, { id }));

  handle("reminders:list", () => listReminders().filter((r) => !r.done).sort((a, b) => a.due.localeCompare(b.due)));
  handle("reminders:create", (input) => createReminder(null, input));
  handle("reminders:delete", (id) => deleteReminder(null, id));

  handle("audit:list", () => audit.list(300));
  handle("audit:verify", () => audit.verify());
  handle("undo:list", () => undo.list());
  handle("undo:run", (id) => undo.run(id));
  handle("shell:show", (p) => shell.showItemInFolder(String(p)));
}

app.whenReady().then(async () => {
  app.setAppUserModelId("tech.doppel.app");
  initStore(path.join(app.getPath("userData"), "data"));
  await loadSecrets();

  agent.setTaskNotifier(onTaskChange);
  setNotifier((task) => onTaskChange(agent.publicTask(task)));

  registerIpc();
  createWindow();
  if (smokeShot) return;

  createTray();
  const shortcut = getSettings().shortcut;
  if (!globalShortcut.register(shortcut, () => showWindow("command"))) console.warn(`Couldn't register ${shortcut}; another app is using it.`);
  setTimeout(tickScheduler, 5000);
  setInterval(tickScheduler, 30_000);
  // Laptops sleep; check for anything that came due while the lid was closed.
  powerMonitor.on("resume", () => setTimeout(tickScheduler, 3000));
});

app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  void closeBrowser();
});

// Doppel keeps running in the tray (menu bar on macOS) when its window is closed.
app.on("window-all-closed", () => {
  if (smokeShot) app.quit();
});

// macOS: clicking the Dock icon reopens the window.
app.on("activate", () => showWindow());
