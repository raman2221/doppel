// The only bridge between the page and the main process. The page gets these
// functions and nothing else: no Node, no file system, no secrets.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

contextBridge.exposeInMainWorld("doppel", {
  state: () => call("app:state"),
  updateSettings: (patch) => call("settings:update", patch),
  setSecret: (name, value) => call("secrets:set", name, value),
  testEmail: () => call("email:test"),
  trainStyle: () => call("email:train"),

  listTasks: () => call("tasks:list"),
  getTask: (id) => call("tasks:get", id),
  startTask: (text) => call("tasks:start", text),
  replyTask: (id, text) => call("tasks:reply", id, text),
  stopTask: (id) => call("tasks:stop", id),
  resumeTask: (id) => call("tasks:resume", id),
  respondApproval: (id, approved) => call("approvals:respond", id, approved),

  getMemory: () => call("memory:get"),
  saveFact: (input) => call("memory:saveFact", input),
  savePerson: (input) => call("memory:savePerson", input),
  forget: (id) => call("memory:forget", id),

  listReminders: () => call("reminders:list"),
  createReminder: (input) => call("reminders:create", input),
  deleteReminder: (id) => call("reminders:delete", id),

  listAudit: () => call("audit:list"),
  verifyAudit: () => call("audit:verify"),
  listUndo: () => call("undo:list"),
  runUndo: (id) => call("undo:run", id),
  showInFolder: (p) => call("shell:show", p),

  pathForFile: (file) => webUtils.getPathForFile(file),
  onTaskUpdate: (cb) => ipcRenderer.on("task:update", (_e, task) => cb(task)),
  onNav: (cb) => ipcRenderer.on("nav", (_e, view) => cb(view)),
});
