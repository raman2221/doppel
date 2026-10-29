// What Doppel knows about the user: facts (address, phone, employer...),
// people (with birthdays and whether they're family), and a writing-style guide.
import { readJson, writeJson, newId } from "../store.js";
import { registerUndo, push as pushUndo } from "../undo.js";
import { isSensitiveLabel, containsSensitiveValue, SENSITIVE_REFUSAL } from "./sensitive.js";

const FILE = "memory.json";
const EMPTY = { facts: [], people: [], style: null };

export const loadMemory = () => ({ ...EMPTY, ...readJson(FILE, EMPTY) });
const saveMemory = (m) => writeJson(FILE, m);

registerUndo("memory_restore", (snapshot) => saveMemory(snapshot));

function snapshotForUndo(task, label) {
  pushUndo({ taskId: task?.id ?? null, label, type: "memory_restore", data: loadMemory() });
}

export function saveFact(task, { key, value }) {
  key = String(key ?? "").trim();
  value = String(value ?? "").trim();
  if (!key || !value) throw new Error("key and value are required.");
  if (isSensitiveLabel(key) || containsSensitiveValue(value)) throw new Error(SENSITIVE_REFUSAL);
  snapshotForUndo(task, `Remember ${key}`);
  const m = loadMemory();
  const existing = m.facts.find((f) => f.key.toLowerCase() === key.toLowerCase());
  if (existing) Object.assign(existing, { value, updatedAt: Date.now() });
  else m.facts.push({ id: newId("fact"), key, value, updatedAt: Date.now() });
  saveMemory(m);
  return `Saved: ${key} = ${value}`;
}

const BIRTHDAY = /^(\d{4}-)?\d{2}-\d{2}$/;

export function savePerson(task, input) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("name is required.");
  if (input.birthday && !BIRTHDAY.test(input.birthday)) throw new Error("birthday must be MM-DD or YYYY-MM-DD.");
  if (containsSensitiveValue(JSON.stringify(input))) throw new Error(SENSITIVE_REFUSAL);
  snapshotForUndo(task, `Remember ${name}`);
  const m = loadMemory();
  let person = m.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!person) {
    person = { id: newId("person"), name };
    m.people.push(person);
  }
  for (const field of ["relation", "email", "phone", "birthday", "notes"]) {
    if (input[field] != null && String(input[field]).trim()) person[field] = String(input[field]).trim();
  }
  if (typeof input.family === "boolean") person.family = input.family;
  person.updatedAt = Date.now();
  saveMemory(m);
  return `Saved ${name}: ${JSON.stringify(person)}`;
}

export function forget(task, { id }) {
  const m = loadMemory();
  const label = m.facts.find((f) => f.id === id)?.key ?? m.people.find((p) => p.id === id)?.name;
  if (!label) throw new Error(`Nothing in memory has id ${id}.`);
  snapshotForUndo(task, `Forget ${label}`);
  m.facts = m.facts.filter((f) => f.id !== id);
  m.people = m.people.filter((p) => p.id !== id);
  saveMemory(m);
  return `Forgot ${label}.`;
}

export function search({ query = "" } = {}) {
  const m = loadMemory();
  const q = String(query).toLowerCase().trim();
  const hit = (obj) => !q || JSON.stringify(obj).toLowerCase().includes(q);
  return { facts: m.facts.filter(hit), people: m.people.filter(hit) };
}

export function setStyle(guide, sampleCount) {
  const m = loadMemory();
  m.style = { guide, sampleCount, trainedAt: Date.now() };
  saveMemory(m);
}

export function isFamilyAddress(address) {
  const a = String(address ?? "").toLowerCase();
  return loadMemory().people.some((p) => p.family && p.email && a.includes(p.email.toLowerCase()));
}

// Rendered into each task's system prompt.
export function profileBlock() {
  const m = loadMemory();
  const facts = m.facts.map((f) => `- ${f.key}: ${f.value}`).join("\n") || "(nothing saved yet)";
  const people = m.people
    .map((p) => `- ${p.name}${p.relation ? ` (${p.relation}${p.family ? ", family" : ""})` : p.family ? " (family)" : ""}${p.email ? ` <${p.email}>` : ""}${p.birthday ? `, birthday ${p.birthday}` : ""}${p.notes ? `. ${p.notes}` : ""} [id ${p.id}]`)
    .join("\n") || "(nobody saved yet)";
  return { facts: m.facts.length ? m.facts.map((f) => `- ${f.key}: ${f.value} [id ${f.id}]`).join("\n") : facts, people, style: m.style?.guide ?? null };
}

export const tools = [
  {
    name: "memory_save_fact",
    description: "Remember a durable fact about the user, such as their home address, phone, employer, or a preference. Saving the same key again updates it. Never use this for passwords, SSNs, or card or bank numbers.",
    actionClass: "local",
    input_schema: { type: "object", properties: { key: { type: "string", description: "Short label, e.g. home address" }, value: { type: "string" } }, required: ["key", "value"] },
    run: (input, ctx) => saveFact(ctx.task, input),
  },
  {
    name: "memory_save_person",
    description: "Remember or update a person the user knows: relation, email, phone, birthday (MM-DD or YYYY-MM-DD), whether they're family, and notes. Matched by name.",
    actionClass: "local",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        relation: { type: "string", description: "e.g. mom, manager, landlord" },
        email: { type: "string" },
        phone: { type: "string" },
        birthday: { type: "string" },
        family: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
    run: (input, ctx) => savePerson(ctx.task, input),
  },
  {
    name: "memory_search",
    description: "Search what you remember about the user and the people they know.",
    actionClass: "read",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Leave empty to list everything." } } },
    run: (input) => JSON.stringify(search(input)),
  },
  {
    name: "memory_forget",
    description: "Delete a saved fact or person by id.",
    actionClass: "local",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (input, ctx) => forget(ctx.task, input),
  },
];
