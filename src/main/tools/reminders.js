// Reminders, renewals, and follow-ups. A reminder can carry an action: a task
// Doppel runs on its own when the reminder comes due.
import { readJson, writeJson, newId } from "../store.js";
import { registerUndo, push as pushUndo } from "../undo.js";
import { loadMemory } from "./memory.js";

const FILE = "reminders.json";
const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"];

export const listReminders = () => readJson(FILE, []);
const save = (all) => writeJson(FILE, all);

registerUndo("reminder_remove", ({ id }) => save(listReminders().filter((r) => r.id !== id)));
registerUndo("reminder_restore", ({ reminder }) => save([...listReminders().filter((r) => r.id !== reminder.id), reminder]));

function parseDue(due) {
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) throw new Error(`Couldn't read the date "${due}". Use ISO format like 2026-11-03T09:00.`);
  return date;
}

export function createReminder(task, { text, due, repeat = "none", action = null }) {
  if (!String(text ?? "").trim()) throw new Error("text is required.");
  if (!REPEATS.includes(repeat)) throw new Error(`repeat must be one of ${REPEATS.join(", ")}.`);
  const reminder = {
    id: newId("rem"),
    text: String(text).trim(),
    due: parseDue(due).toISOString(),
    repeat,
    action: action ? String(action).trim() : null,
    createdAt: Date.now(),
    done: false,
  };
  save([...listReminders(), reminder]);
  pushUndo({ taskId: task?.id ?? null, label: `Reminder: ${reminder.text}`, type: "reminder_remove", data: { id: reminder.id } });
  return reminder;
}

export function deleteReminder(task, id) {
  const all = listReminders();
  const reminder = all.find((r) => r.id === id);
  if (!reminder) throw new Error(`No reminder with id ${id}.`);
  save(all.filter((r) => r.id !== id));
  pushUndo({ taskId: task?.id ?? null, label: `Delete reminder: ${reminder.text}`, type: "reminder_restore", data: { reminder } });
  return `Deleted reminder "${reminder.text}".`;
}

function advance(date, repeat) {
  const d = new Date(date);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
  else if (repeat === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d;
}

// Called by the scheduler. Returns reminders that just came due and moves
// repeating ones to their next date.
export function collectDue(now = new Date()) {
  const all = listReminders();
  const due = [];
  for (const r of all) {
    if (r.done || new Date(r.due) > now) continue;
    due.push({ ...r });
    if (r.repeat === "none") r.done = true;
    else {
      let next = advance(r.due, r.repeat);
      while (next <= now) next = advance(next, r.repeat);
      r.due = next.toISOString();
    }
    r.lastFiredAt = now.toISOString();
  }
  if (due.length) save(all);
  return due;
}

// Birthdays coming up in the next `days` days, each reported once per year.
export function upcomingBirthdays(now = new Date(), days = 3) {
  const state = readJson("birthday-notices.json", {});
  const found = [];
  for (const person of loadMemory().people) {
    if (!person.birthday) continue;
    const [month, day] = person.birthday.slice(-5).split("-").map(Number);
    let next = new Date(now.getFullYear(), month - 1, day);
    if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next = new Date(now.getFullYear() + 1, month - 1, day);
    const daysAway = Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
    const key = `${person.id}:${next.getFullYear()}`;
    if (daysAway <= days && !state[key]) {
      found.push({ person, daysAway });
      state[key] = now.toISOString();
    }
  }
  if (found.length) writeJson("birthday-notices.json", state);
  return found;
}

export const tools = [
  {
    name: "reminder_create",
    description:
      "Create a reminder, renewal, or follow-up. Give `action` when Doppel should do something itself when it comes due (e.g. 'Check whether Sam replied about the lease; if not, draft a polite nudge'). Times are the user's local time in ISO format.",
    actionClass: "local",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What the reminder says" },
        due: { type: "string", description: "Local date and time, e.g. 2026-11-03T09:00" },
        repeat: { type: "string", enum: REPEATS },
        action: { type: "string", description: "Optional task for Doppel to run when it's due" },
      },
      required: ["text", "due"],
    },
    run: (input, ctx) => JSON.stringify(createReminder(ctx.task, input)),
  },
  {
    name: "reminder_list",
    description: "List upcoming reminders, renewals, and follow-ups.",
    actionClass: "read",
    input_schema: { type: "object", properties: {} },
    run: () => JSON.stringify(listReminders().filter((r) => !r.done)),
  },
  {
    name: "reminder_delete",
    description: "Delete a reminder by id.",
    actionClass: "local",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (input, ctx) => deleteReminder(ctx.task, input.id),
  },
];
