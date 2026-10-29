// Runs a full task against a fake Claude API: inspect a PDF, fill it, then
// try to send an email, which must stop for approval in "ask before it ships".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { PDFDocument } from "pdf-lib";
import { initStore, updateSettings } from "../src/main/store.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doppel-agent-"));
initStore(dir);

const requests = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d)).on("end", () => {
    const params = JSON.parse(body);
    requests.push({ beta: req.headers["anthropic-beta"], params });
    const last = params.messages.at(-1);
    const turn = requests.length;
    let content;
    if (turn === 1) content = [{ type: "text", text: "Looking at the form." }, { type: "tool_use", id: "t1", name: "form_inspect", input: { path: pdfPath } }];
    else if (turn === 2) content = [{ type: "tool_use", id: "t2", name: "form_fill", input: { path: pdfPath, values: { Name: "Alex Rivera", SSN: "123-45-6789" } } }];
    else if (turn === 3) content = [{ type: "tool_use", id: "t3", name: "email_send", input: { to: "landlord@example.com", subject: "Form", body: "Attached." } }];
    else content = [{ type: "text", text: `Done. Last result: ${JSON.stringify(last.content?.[0]?.content ?? "").slice(0, 80)}` }];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `msg_${turn}`, type: "message", role: "assistant", model: params.model, content, stop_reason: content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 50, output_tokens: 10 } }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;

const pdfPath = path.join(dir, "lease.pdf");
{
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  doc.getForm().createTextField("Name").addToPage(page, { x: 40, y: 700 });
  doc.getForm().createTextField("SSN").addToPage(page, { x: 40, y: 650 });
  fs.writeFileSync(pdfPath, await doc.save());
}

const { setSecret } = await import("../src/main/secrets.js");
const agent = await import("../src/main/agent.js");
const { respond } = await import("../src/main/approvals.js");

const waitFor = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out");
};

test("a task runs tools, gates the email send, and records everything", async () => {
  await setSecret("anthropicKey", "sk-ant-test-0000000000000000000000");
  updateSettings({ approvalMode: "ask_before_ships" });

  const started = agent.startTask("Fill out my lease form and email it to my landlord");
  const task = agent.getTask(started.id);

  const approval = await waitFor(() => task.steps.find((s) => s.type === "approval" && s.status === "pending"));
  assert.equal(task.status, "waiting");
  assert.equal(approval.actionClass, "ships");
  assert.equal(approval.preview.to, "landlord@example.com");

  // The filled copy exists, and the SSN was left blank.
  const filled = path.join(dir, "lease (filled).pdf");
  assert.ok(fs.existsSync(filled));
  const form = (await PDFDocument.load(fs.readFileSync(filled))).getForm();
  assert.equal(form.getTextField("Name").getText(), "Alex Rivera");
  assert.equal(form.getTextField("SSN").getText(), undefined);

  respond(approval.id, false);
  await waitFor(() => task.status === "done");

  const results = task.messages.filter((m) => m.role === "user" && Array.isArray(m.content)).flatMap((m) => m.content);
  assert.equal(results.length, 3, "one tool_result per tool_use");
  assert.match(results[2].content, /declined/);
  assert.match(requests[0].beta, /context-management-2025-06-27/);
  assert.match(requests[0].beta, /server-side-fallback-2026-07-01/);
  assert.equal(requests[0].params.fallbacks, "default");
  assert.ok(requests.every((r) => r.params.system === requests[0].params.system), "system prompt stays fixed");
  assert.ok(!JSON.stringify(task.messages).includes("sk-ant-test"), "API key never enters the conversation");

  // The task is on disk and resumable after a restart.
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "tasks", `${task.id}.json`), "utf8"));
  assert.equal(saved.status, "done");
  assert.equal(saved.messages.length, task.messages.length);
  server.close();
});
