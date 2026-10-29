// Decides whether an action runs on its own, runs after a short preview, or
// waits for the user, based on the approval mode and the action's class:
//   read     looks at something; never asks
//   local    changes something on this machine (reminders, memory, files)
//   ships    leaves the machine (sends email, submits a web form)
//   payment  spends money; always asks
import { newId, getSettings } from "./store.js";
import * as audit from "./audit.js";

const pending = new Map();
let notify = () => {};

export function setNotifier(fn) {
  notify = fn;
}

export function policyFor(actionClass, { mode, alwaysAsk = false }) {
  if (actionClass === "read") return "auto";
  if (actionClass === "payment" || alwaysAsk) return "ask";
  if (mode === "ask_every_time") return "ask";
  if (mode === "ask_before_ships") return actionClass === "ships" ? "ask" : "auto";
  return actionClass === "ships" ? "preview" : "auto";
}

// Returns true if the action may go ahead. `step` is shown on the task card.
export function requestApproval(task, { actionClass, tool, title, detail = "", preview = null, alwaysAsk = false, previewable = false }) {
  const settings = getSettings();
  let policy = policyFor(actionClass, { mode: settings.approvalMode, alwaysAsk });
  if (policy === "preview" && !previewable) policy = "auto";

  if (policy === "auto") {
    audit.record({ taskId: task.id, action: "auto-approved", tool, decision: actionClass, detail: title });
    return Promise.resolve(true);
  }

  const id = newId("apv");
  const step = {
    type: "approval",
    id,
    actionClass,
    tool,
    title,
    detail,
    preview,
    status: "pending",
    sendAt: policy === "preview" ? Date.now() + settings.sendPreviewSeconds * 1000 : null,
  };
  task.steps.push(step);
  task.status = "waiting";
  notify(task);

  return new Promise((resolve) => {
    const finish = (approved, how) => {
      if (!pending.has(id)) return;
      pending.delete(id);
      clearTimeout(timer);
      step.status = approved ? "approved" : "denied";
      step.sendAt = null;
      task.status = "running";
      audit.record({ taskId: task.id, action: approved ? "approved" : "denied", tool, decision: how, detail: title });
      notify(task);
      resolve(approved);
    };
    // In "don't ask" mode a send goes out after the preview unless cancelled.
    const timer = step.sendAt ? setTimeout(() => finish(true, "preview elapsed"), step.sendAt - Date.now()) : null;
    pending.set(id, { taskId: task.id, finish });
  });
}

export function respond(id, approved) {
  const entry = pending.get(id);
  if (!entry) throw new Error("That approval is no longer waiting.");
  entry.finish(Boolean(approved), approved ? "user approved" : "user declined");
}

// Stopping a task declines anything it was waiting on.
export function cancelForTask(taskId) {
  for (const [, entry] of pending) if (entry.taskId === taskId) entry.finish(false, "task stopped");
}
