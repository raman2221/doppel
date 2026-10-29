import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { initStore, dataPath } from "../src/main/store.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doppel-test-"));
initStore(dir);

const audit = await import("../src/main/audit.js");
const { policyFor } = await import("../src/main/approvals.js");
const { isSensitiveLabel, containsSensitiveValue } = await import("../src/main/tools/sensitive.js");
const { inspectForm, fillForm } = await import("../src/main/tools/forms.js");
const reminders = await import("../src/main/tools/reminders.js");
const memory = await import("../src/main/tools/memory.js");
const undo = await import("../src/main/undo.js");

test("audit log chains entries and detects tampering", () => {
  for (let i = 0; i < 5; i++) audit.record({ action: "tool", detail: `step ${i}` });
  assert.deepEqual(audit.verify(), { ok: true, count: 5 });
  const file = dataPath("audit.jsonl");
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  lines[2] = lines[2].replace("step 2", "step 2 (edited)");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(audit.verify().ok, false);
  lines.splice(2, 1); // deleting the entry instead breaks the link
  fs.writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(audit.verify().ok, false);
  fs.rmSync(file);
});

test("approval policy matches the three modes", () => {
  assert.equal(policyFor("read", { mode: "ask_every_time" }), "auto");
  assert.equal(policyFor("local", { mode: "ask_every_time" }), "ask");
  assert.equal(policyFor("local", { mode: "ask_before_ships" }), "auto");
  assert.equal(policyFor("ships", { mode: "ask_before_ships" }), "ask");
  assert.equal(policyFor("ships", { mode: "dont_ask" }), "preview");
  assert.equal(policyFor("payment", { mode: "dont_ask" }), "ask");
  assert.equal(policyFor("ships", { mode: "dont_ask", alwaysAsk: true }), "ask");
});

test("sensitive fields and values are recognized", () => {
  for (const label of ["SSN", "Social Security Number", "cardNumber", "CVV", "Routing number", "password"]) assert.ok(isSensitiveLabel(label), label);
  for (const label of ["First name", "Street address", "Phone", "Email"]) assert.ok(!isSensitiveLabel(label), label);
  assert.ok(containsSensitiveValue("my ssn is 123-45-6789"));
  assert.ok(containsSensitiveValue("4111 1111 1111 1111"));
  assert.ok(!containsSensitiveValue("call me at 734 555 0199"));
});

test("forms: fills safe fields, skips sensitive ones, writes a copy, undo removes it", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  const form = doc.getForm();
  form.createTextField("Full Name").addToPage(page, { x: 50, y: 300 });
  form.createTextField("SSN").addToPage(page, { x: 50, y: 250 });
  form.createCheckBox("US Citizen").addToPage(page, { x: 50, y: 200 });
  const dd = form.createDropdown("State");
  dd.addOptions(["MI", "OH"]);
  dd.addToPage(page, { x: 50, y: 150 });
  const original = path.join(dir, "application.pdf");
  fs.writeFileSync(original, await doc.save());

  const info = await inspectForm({ path: original });
  assert.equal(info.fieldCount, 4);
  assert.equal(info.fields.find((f) => f.name === "SSN").sensitive, true);

  const task = { id: "task_test" };
  const result = await fillForm(task, { path: original, values: { "Full Name": "Alex Rivera", SSN: "123-45-6789", "US Citizen": "yes", State: "mi", Nope: "x" } });
  assert.deepEqual(result.filled.sort(), ["Full Name", "State", "US Citizen"]);
  assert.deepEqual(result.skipped.map((s) => s.name).sort(), ["Nope", "SSN"]);
  assert.ok(fs.existsSync(result.saved) && result.saved !== original);

  const filled = (await PDFDocument.load(fs.readFileSync(result.saved))).getForm();
  assert.equal(filled.getTextField("Full Name").getText(), "Alex Rivera");
  assert.equal(filled.getTextField("SSN").getText(), undefined);

  const entry = undo.list().find((u) => u.label.includes("Filled form"));
  await undo.run(entry.id);
  assert.ok(!fs.existsSync(result.saved));
});

test("reminders: repeating reminders advance, one-offs finish", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  reminders.createReminder(null, { text: "Pay rent", due: past, repeat: "monthly" });
  reminders.createReminder(null, { text: "Call dentist", due: past });
  reminders.createReminder(null, { text: "Later", due: new Date(Date.now() + 86_400_000).toISOString() });
  const due = reminders.collectDue();
  assert.deepEqual(due.map((r) => r.text).sort(), ["Call dentist", "Pay rent"]);
  const all = reminders.listReminders();
  assert.ok(new Date(all.find((r) => r.text === "Pay rent").due) > new Date());
  assert.equal(all.find((r) => r.text === "Call dentist").done, true);
  assert.equal(reminders.collectDue().length, 0);
});

test("memory refuses secrets and flags birthdays once", () => {
  assert.throws(() => memory.saveFact(null, { key: "SSN", value: "123-45-6789" }));
  assert.throws(() => memory.saveFact(null, { key: "note", value: "card 4111 1111 1111 1111" }));
  memory.saveFact(null, { key: "name", value: "Alex Rivera" });
  const soon = new Date(Date.now() + 2 * 86_400_000);
  const mmdd = `${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  memory.savePerson(null, { name: "Mom", relation: "mom", email: "mom@example.com", birthday: mmdd, family: true });
  assert.equal(reminders.upcomingBirthdays().length, 1);
  assert.equal(reminders.upcomingBirthdays().length, 0);
  assert.ok(memory.isFamilyAddress("Mom <mom@example.com>"));
});
