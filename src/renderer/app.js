// Doppel's interface. All data comes from window.doppel (see preload.cjs).
const api = window.doppel;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const md = (text) => DOMPurify.sanitize(marked.parse(String(text ?? ""), { gfm: true }));
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") node.setAttribute("target", "_blank");
});

const state = { app: null, view: "tasks", taskId: null, tasks: [], task: null, pendingApprovals: 0 };
let toastTimer = null;
let countdownTimer = null;

function toast(message, bad = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast${bad ? " bad" : ""}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 6000 : 2600);
}

async function attempt(fn, success) {
  try {
    const result = await fn();
    if (success) toast(typeof success === "function" ? success(result) : success);
    return result;
  } catch (err) {
    toast(err.message, true);
    return undefined;
  }
}

const MODE_LABELS = {
  ask_every_time: ["Ask me every time", "Every action that changes anything waits for you."],
  ask_before_ships: ["Ask before it ships", "Changes on this computer go ahead. Anything leaving the machine (emails, web forms) waits for you."],
  dont_ask: ["Don't ask", "Doppel acts on its own. Emails show for a few seconds first so you can cancel. Payments and messages to family still wait."],
};

const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmtTime(ms);
}
const STATUS = { running: ["Working", ""], waiting: ["Needs you", "wait"], done: ["Done", "ok"], stopped: ["Stopped", ""], error: ["Stopped on an error", "stop"] };

// ---- routing --------------------------------------------------------------------

function parseHash() {
  const [view, id] = location.hash.replace(/^#/, "").split("/");
  return { view: ["tasks", "memory", "reminders", "activity", "settings"].includes(view) ? view : "tasks", id: id || null };
}

async function route() {
  const { view, id } = parseHash();
  state.view = view;
  state.taskId = view === "tasks" ? id : null;
  document.querySelectorAll(".nav-item").forEach((a) => a.setAttribute("aria-current", a.dataset.view === view ? "page" : "false"));
  clearInterval(countdownTimer);
  const renderers = { tasks: renderTasks, memory: renderMemory, reminders: renderReminders, activity: renderActivity, settings: renderSettings };
  await renderers[view]();
  renderRailFoot();
}

function renderRailFoot() {
  const s = state.app;
  const [label] = MODE_LABELS[s.settings.approvalMode];
  $("#rail-foot").innerHTML = `
    <a class="mode-pill" href="#settings" title="Change approval mode"><i class="dot ${s.settings.approvalMode === "dont_ask" ? "wait" : "ok"}"></i>${esc(label)}</a>
    <span><i class="dot ${s.secrets.anthropicKey ? "ok" : "wait"}" style="display:inline-block"></i> Claude ${s.secrets.anthropicKey ? "connected" : "not set up"}</span>
    <span><i class="dot ${s.settings.email.address && s.secrets.emailPassword ? "ok" : ""}" style="display:inline-block"></i> Email ${s.settings.email.address && s.secrets.emailPassword ? "connected" : "not connected"}</span>`;
  const tasksLink = $('.nav-item[data-view="tasks"]');
  const waiting = state.tasks.filter((t) => t.status === "waiting").length;
  tasksLink.innerHTML = `Tasks${waiting ? `<span class="nav-badge">${waiting}</span>` : ""}`;
}

// ---- tasks ----------------------------------------------------------------------

const EXAMPLES = [
  ["Clear my inbox", "Archive newsletters and notifications, and draft replies to anything that needs me."],
  ["Renew my car registration", "Remind me every year on May 1 and open the DMV renewal page when it's due."],
  ["Fill out a form", "Drop a PDF on the bar above, then say “fill this in with my details.”"],
  ["Find dinner", "Find a table for two Friday at 7pm near me on OpenTable. Don't book it; show me options."],
];

async function renderTasks() {
  state.tasks = await api.listTasks();
  state.task = state.taskId ? await api.getTask(state.taskId) : null;
  $("#main").innerHTML = `
    <section class="command" id="command">
      <form id="command-form">
        <input type="text" id="command-input" autocomplete="off" placeholder="What should your twin handle?" aria-label="New task">
        <button class="btn go" type="submit">Go</button>
      </form>
      <div class="command-hint"><span>One line is enough. Doppel plans the steps.</span><span>Drop a file here to use it.</span><span>${state.app.platform === "darwin" ? "⌘⇧Space" : "Ctrl+Shift+Space"} opens Doppel from anywhere.</span></div>
    </section>
    <div class="tasks-layout">
      <div class="task-list" id="task-list"></div>
      <section class="task-detail" id="task-detail"></section>
    </div>`;
  renderTaskList();
  renderTaskDetail();
  if (!state.task) $("#command-input").focus();
}

function renderTaskList() {
  const el = $("#task-list");
  if (!el) return;
  el.innerHTML = state.tasks.length
    ? state.tasks
        .map((t) => {
          const [label, tone] = STATUS[t.status] ?? [t.status, ""];
          return `<button class="task-item" data-open-task="${esc(t.id)}" aria-current="${t.id === state.taskId}">
            <strong>${esc(t.title)}</strong>
            <span><i class="dot ${tone === "ok" ? "ok" : tone === "wait" ? "wait" : ""}"></i>${label}${t.origin === "reminder" ? " · from a reminder" : ""} · ${ago(t.updatedAt)}</span>
          </button>`;
        })
        .join("")
    : '<p class="empty-list">Your tasks show up here.</p>';
}

function emailPreview(p) {
  return `<div class="email-preview"><dl><dt>To</dt><dd>${esc(p.to)}</dd>${p.cc ? `<dt>Cc</dt><dd>${esc(p.cc)}</dd>` : ""}<dt>Subject</dt><dd>${esc(p.subject)}</dd></dl><pre>${esc(p.body)}</pre></div>`;
}

function stepHtml(s) {
  if (s.type === "user") return `<div class="you">${esc(s.text)}</div>`;
  if (s.type === "text") return `<div class="twin-text">${md(s.text)}</div>`;
  if (s.type === "notice") return `<div class="notice">${esc(s.text)}</div>`;
  if (s.type === "error") return `<div class="error">${esc(s.text)}${/Settings/.test(s.text) ? ' <a href="#settings">Open Settings</a>' : ""}</div>`;
  if (s.type === "tool") {
    const label = { running: "…", done: "done", error: "failed", declined: "declined", stopped: "stopped" }[s.status] ?? s.status;
    const body = s.result && s.status !== "running" ? `<details><summary class="sum">${esc(s.summary)}</summary><pre>${esc(s.result)}</pre></details>` : `<span class="sum">${esc(s.summary)}</span>`;
    return `<div class="tool"><span class="st st-${esc(s.status)}">${label}</span><b>${esc(s.name)}</b>${body}</div>`;
  }
  if (s.type === "approval") {
    const settled = s.status !== "pending";
    const payment = s.actionClass === "payment";
    const preview = s.preview?.kind === "email" ? emailPreview(s.preview) : s.detail ? `<div class="hint">${esc(s.detail)}</div>` : "";
    let actions;
    if (settled) actions = `<span class="pill ${s.status === "approved" ? "ok" : "stop"}">${s.status === "approved" ? "Approved" : "Declined"}</span>`;
    else if (s.sendAt) actions = `<span class="countdown" data-send-at="${s.sendAt}"></span><button class="btn" data-approval="${esc(s.id)}" data-approve="false">Cancel</button><button class="btn primary" data-approval="${esc(s.id)}" data-approve="true">Send now</button>`;
    else actions = `<button class="btn" data-approval="${esc(s.id)}" data-approve="false">Decline</button><button class="btn primary" data-approval="${esc(s.id)}" data-approve="true">${payment ? "Approve payment" : "Approve"}</button>`;
    const tag = payment ? '<span class="pill stop">Spends money</span>' : s.actionClass === "ships" ? '<span class="pill wait">Leaves your computer</span>' : '<span class="pill">Changes something</span>';
    return `<div class="approval${payment ? " payment" : ""}${settled ? " settled" : ""}">
      <div class="approval-head"><strong>${esc(s.title)}</strong>${tag}</div>
      ${settled && s.preview?.kind === "email" ? "" : preview}
      <div class="actions">${actions}</div>
    </div>`;
  }
  if (s.type === "question") {
    if (s.status !== "pending") return `<div class="notice">Doppel asked: ${esc(s.question)}. You answered: ${esc(s.answer)}</div>`;
    return `<div class="question"><strong>${esc(s.question)}</strong>
      ${s.options?.length ? `<div class="options">${s.options.map((o) => `<button class="btn" data-answer="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
      <div class="hint">Or type an answer below.</div></div>`;
  }
  return "";
}

function renderTaskDetail() {
  const el = $("#task-detail");
  if (!el) return;
  const t = state.task;
  if (!t) {
    el.innerHTML = `<div class="welcome">
      <h2>What should come off your plate?</h2>
      <p>Doppel works through your inbox, browser, forms, and reminders the way you would, and checks with you based on your approval mode.</p>
      ${state.app.secrets.anthropicKey ? "" : '<div class="error">Add your Claude API key in <a href="#settings">Settings</a> before the first task.</div>'}
      <div class="examples">${EXAMPLES.map(([title, text]) => `<button class="example" data-example="${esc(text)}"><b>${esc(title)}</b><span>${esc(text)}</span></button>`).join("")}</div>
    </div>`;
    return;
  }
  const [label, tone] = STATUS[t.status] ?? [t.status, ""];
  const box = $("#timeline");
  const nearBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const canReply = !t.running || t.steps.some((s) => s.type === "question" && s.status === "pending");
  el.innerHTML = `
    <div class="task-head">
      <h2 title="${esc(t.title)}">${esc(t.title)}</h2>
      <div class="task-actions">
        <span class="pill ${tone}">${label}</span>
        ${t.running ? `<button class="btn danger" data-stop="${esc(t.id)}">Stop</button>` : ""}
        ${!t.running && (t.status === "stopped" || t.status === "error") ? `<button class="btn" data-resume="${esc(t.id)}">Resume</button>` : ""}
      </div>
    </div>
    <div class="timeline" id="timeline"><div class="timeline-inner">
      ${t.steps.map(stepHtml).join("")}
      ${t.running && t.status === "running" ? '<div class="working"><span class="pulse"><i></i><i></i></span>Working…</div>' : ""}
    </div></div>
    ${canReply ? `<form class="reply" id="reply-form"><input type="text" id="reply-input" autocomplete="off" placeholder="${t.running ? "Answer Doppel's question" : "Follow up, or ask for changes"}"><button class="btn primary" type="submit">Send</button></form>` : ""}`;
  const timeline = $("#timeline");
  if (nearBottom) timeline.scrollTop = timeline.scrollHeight;
  tickCountdowns();
  clearInterval(countdownTimer);
  if (document.querySelector("[data-send-at]")) countdownTimer = setInterval(tickCountdowns, 250);
}

function tickCountdowns() {
  document.querySelectorAll("[data-send-at]").forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.sendAt) - Date.now()) / 1000));
    el.textContent = left > 0 ? `Sending in ${left}s` : "Sending…";
  });
}

api.onTaskUpdate((task) => {
  const i = state.tasks.findIndex((t) => t.id === task.id);
  const summary = { id: task.id, title: task.title, status: task.status, origin: task.origin, createdAt: task.createdAt, updatedAt: task.updatedAt };
  if (i >= 0) state.tasks[i] = summary;
  else state.tasks.unshift(summary);
  if (state.view === "tasks") {
    renderTaskList();
    if (task.id === state.taskId) {
      const typing = $("#reply-input")?.value;
      state.task = task;
      renderTaskDetail();
      if (typing && $("#reply-input")) $("#reply-input").value = typing;
    }
  }
  renderRailFoot();
});

// ---- memory ---------------------------------------------------------------------

async function renderMemory() {
  const m = await api.getMemory();
  $("#main").innerHTML = `<div class="page"><div class="page-inner">
    <header class="page-head"><h1>Memory</h1><p>What Doppel knows about you and the people in your life. It uses this to fill forms, write as you, and remember dates. It never stores passwords, SSNs, or card numbers.</p></header>

    <section class="card">
      <div class="card-head"><div><h2>About you</h2><p>Your name, address, phone, employer: anything a form might ask for.</p></div></div>
      <div class="list">${m.facts.map((f) => `<div class="list-row"><div class="grow"><b>${esc(f.key)}</b><div>${esc(f.value)}</div></div><button class="btn small danger" data-forget="${esc(f.id)}">Forget</button></div>`).join("") || '<p class="hint">Nothing yet. Add your name first; Doppel signs emails with it.</p>'}</div>
      <form class="row" id="fact-form"><label class="field">Label<input type="text" id="fact-key" placeholder="name"></label><label class="field">Value<input type="text" id="fact-value" placeholder="Alex Rivera"></label><button class="btn" type="submit">Add</button></form>
    </section>

    <section class="card">
      <div class="card-head"><div><h2>People</h2><p>Birthdays get a heads-up 3 days ahead. Messages to family always wait for your approval.</p></div></div>
      <div class="list">${m.people.map((p) => `<div class="list-row"><div class="grow"><b>${esc(p.name)}</b>${p.family ? ' <span class="pill wait">Family</span>' : ""}<div>${esc([p.relation, p.email, p.phone, p.birthday && `birthday ${p.birthday}`, p.notes].filter(Boolean).join(" · "))}</div></div><button class="btn small danger" data-forget="${esc(p.id)}">Forget</button></div>`).join("") || '<p class="hint">Nobody yet.</p>'}</div>
      <form class="row" id="person-form">
        <label class="field">Name<input type="text" id="p-name"></label>
        <label class="field">Relation<input type="text" id="p-relation" placeholder="mom, manager…"></label>
        <label class="field">Email<input type="email" id="p-email"></label>
        <label class="field">Birthday<input type="text" id="p-birthday" placeholder="MM-DD"></label>
        <label class="field" style="flex:0 0 auto">Family<input type="checkbox" id="p-family"></label>
        <button class="btn" type="submit">Add</button>
      </form>
    </section>

    <section class="card">
      <div class="card-head"><div><h2>How you write</h2><p>Doppel reads your recent sent mail and writes a style guide, so its emails sound like you.</p></div>
      <button class="btn primary" id="train-style">${m.style ? "Retrain" : "Train on my sent mail"}</button></div>
      ${m.style ? `<div class="hint">Trained on ${m.style.sampleCount} emails, ${fmtTime(m.style.trainedAt)}</div><div class="style-guide">${esc(m.style.guide)}</div>` : '<p class="hint">Not trained yet. Connect email in Settings first.</p>'}
    </section>
  </div></div>`;
}

// ---- reminders -------------------------------------------------------------------

async function renderReminders() {
  const reminders = await api.listReminders();
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const defaultDue = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#main").innerHTML = `<div class="page"><div class="page-inner">
    <header class="page-head"><h1>Reminders</h1><p>Renewals, follow-ups, and anything with a date. A reminder with a task attached runs on its own when it comes due.</p></header>
    <section class="card">
      <div class="list">${reminders.map((r) => `<div class="list-row"><span class="when">${esc(fmtTime(Date.parse(r.due)))}</span><div class="grow"><b>${esc(r.text)}</b><div>${esc([r.repeat !== "none" && `repeats ${r.repeat}`, r.action && `then Doppel will: ${r.action}`].filter(Boolean).join(" · "))}</div></div><button class="btn small danger" data-delete-reminder="${esc(r.id)}">Delete</button></div>`).join("") || '<p class="hint">No reminders yet. Add one here, or just tell Doppel, e.g. “remind me to cancel the gym trial before the 14th.”</p>'}</div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2>New reminder</h2></div></div>
      <form class="row" id="reminder-form">
        <label class="field" style="flex-basis:260px">What<input type="text" id="r-text" placeholder="Renew passport"></label>
        <label class="field">When<input type="datetime-local" id="r-due" value="${defaultDue}"></label>
        <label class="field">Repeat<select id="r-repeat">${["none", "daily", "weekly", "monthly", "yearly"].map((r) => `<option value="${r}">${r === "none" ? "Doesn't repeat" : r[0].toUpperCase() + r.slice(1)}</option>`).join("")}</select></label>
        <button class="btn primary" type="submit">Add</button>
      </form>
    </section>
  </div></div>`;
}

// ---- activity ------------------------------------------------------------------------

async function renderActivity() {
  const [undoable, log] = await Promise.all([api.listUndo(), api.listAudit()]);
  $("#main").innerHTML = `<div class="page"><div class="page-inner">
    <header class="page-head"><h1>Activity</h1><p>Everything Doppel did, in a log where each entry is chained to the one before it with SHA-256, so any edit shows up. Changes that stay on this computer can be undone for 30 minutes. Sent messages can't.</p></header>
    <section class="card">
      <div class="card-head"><div><h2>Undo</h2></div></div>
      <div class="list">${undoable.map((u) => `<div class="list-row"><span class="when">${esc(ago(u.at))}</span><div class="grow"><b>${esc(u.label)}</b><div>${Math.max(1, Math.round((u.expiresAt - Date.now()) / 60000))} min left to undo</div></div><button class="btn small" data-undo="${esc(u.id)}">Undo</button></div>`).join("") || '<p class="hint">Nothing to undo right now.</p>'}</div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2>Audit log</h2><p>The latest ${log.length} of up to 1,000 entries.</p></div><div class="row" style="flex:0 0 auto"><span id="verify-result"></span><button class="btn" id="verify-log">Verify integrity</button></div></div>
      <div class="log-wrap"><table class="log"><thead><tr><th>When</th><th>What</th><th>Detail</th><th>Hash</th></tr></thead><tbody>
        ${log.map((e) => `<tr><td>${esc(fmtTime(Date.parse(e.at)))}</td><td>${esc(e.action)}${e.tool ? ` · <code>${esc(e.tool)}</code>` : ""}</td><td>${esc(e.detail)}</td><td><code title="${esc(e.hash)}">${esc((e.hash ?? "").slice(0, 10))}</code></td></tr>`).join("") || '<tr><td colspan="4" class="hint">No activity yet.</td></tr>'}
      </tbody></table></div>
    </section>
  </div></div>`;
}

// ---- settings -----------------------------------------------------------------------

const EMAIL_PRESETS = {
  gmail: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587 },
  icloud: { imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587 },
};

async function renderSettings() {
  state.app = await api.state();
  const { settings: s, secrets, models } = state.app;
  const preset = Object.entries(EMAIL_PRESETS).find(([, p]) => p.imapHost === s.email.imapHost)?.[0] ?? "custom";
  $("#main").innerHTML = `<div class="page"><form class="page-inner" id="settings-form">
    <header class="page-head"><h1>Settings</h1><p>Keys and passwords are encrypted with your computer's keychain and never leave this machine except to the service they belong to.</p></header>

    <section class="card">
      <div class="card-head"><div><h2>Approval mode</h2><p>Payments and messages to family always wait for you, whatever you pick.</p></div></div>
      <div class="modes">${state.app.approvalModes.map((mode) => `<label class="mode"><input type="radio" name="mode" value="${mode}"${mode === s.approvalMode ? " checked" : ""}><div><b>${esc(MODE_LABELS[mode][0])}</b><span>${esc(MODE_LABELS[mode][1])}</span></div></label>`).join("")}</div>
      <label class="field" style="max-width:260px">Email preview in “Don't ask” mode<input type="number" id="preview-seconds" min="3" max="30" value="${s.sendPreviewSeconds}"><small>Seconds before an email sends on its own.</small></label>
    </section>

    <section class="card">
      <div class="card-head"><div><h2>Claude</h2><p>Doppel's thinking runs on Claude. Create a key at console.anthropic.com → API Keys; usage is billed to that account.</p></div><span class="pill ${secrets.anthropicKey ? "ok" : "wait"}">${secrets.anthropicKey ? "Connected" : "Not set"}</span></div>
      <label class="field">API key<input type="password" id="anthropic-key" autocomplete="off" placeholder="${secrets.anthropicKey ? "Saved. Paste a new key to replace it." : "sk-ant-…"}"></label>
      <div class="row">
        <label class="field">Model<select id="model">${models.map((m) => `<option value="${m.id}"${m.id === s.model ? " selected" : ""}>${esc(m.label)} (${esc(m.note)})</option>`).join("")}</select></label>
        <label class="field">Effort<select id="effort">${["low", "medium", "high"].map((e) => `<option value="${e}"${e === s.effort ? " selected" : ""}>${e[0].toUpperCase() + e.slice(1)}</option>`).join("")}</select></label>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div><h2>Email</h2><p>Doppel reads and sends through your mail provider with an app password, not your normal password. For Gmail: turn on 2-Step Verification, then create one at myaccount.google.com/apppasswords. School and work accounts may have app passwords turned off.</p></div><span class="pill ${s.email.address && secrets.emailPassword ? "ok" : ""}">${s.email.address && secrets.emailPassword ? "Connected" : "Not connected"}</span></div>
      <div class="row">
        <label class="field">Provider<select id="email-preset"><option value="gmail"${preset === "gmail" ? " selected" : ""}>Gmail</option><option value="outlook"${preset === "outlook" ? " selected" : ""}>Outlook / Microsoft 365</option><option value="icloud"${preset === "icloud" ? " selected" : ""}>iCloud</option><option value="custom"${preset === "custom" ? " selected" : ""}>Other</option></select></label>
        <label class="field">Address<input type="email" id="email-address" value="${esc(s.email.address)}" placeholder="you@gmail.com"></label>
        <label class="field">App password<input type="password" id="email-password" autocomplete="off" placeholder="${secrets.emailPassword ? "Saved" : "16 characters"}"></label>
      </div>
      <div class="row" id="custom-hosts"${preset === "custom" ? "" : " hidden"}>
        <label class="field">IMAP host<input type="text" id="imap-host" value="${esc(s.email.imapHost)}"></label>
        <label class="field">IMAP port<input type="number" id="imap-port" value="${s.email.imapPort}"></label>
        <label class="field">SMTP host<input type="text" id="smtp-host" value="${esc(s.email.smtpHost)}"></label>
        <label class="field">SMTP port<input type="number" id="smtp-port" value="${s.email.smtpPort}"></label>
      </div>
      <div><button class="btn" type="button" id="test-email">Test connection</button></div>
    </section>

    <section class="card">
      <div class="card-head"><div><h2>Browser</h2><p>Errands run in a separate Doppel window with its own profile. Sign in to sites there once, and Doppel stays signed in.</p></div></div>
      <label class="field" style="max-width:260px">Browser<select id="browser-channel"><option value="chrome"${s.browser.channel === "chrome" ? " selected" : ""}>Google Chrome</option><option value="msedge"${s.browser.channel === "msedge" ? " selected" : ""}>Microsoft Edge</option></select></label>
    </section>

    <div><button class="btn primary" type="submit">Save settings</button></div>
  </form></div>`;
}

async function saveSettings() {
  const preset = $("#email-preset").value;
  const hosts = preset === "custom"
    ? { imapHost: $("#imap-host").value.trim(), imapPort: Number($("#imap-port").value), smtpHost: $("#smtp-host").value.trim(), smtpPort: Number($("#smtp-port").value) }
    : EMAIL_PRESETS[preset];
  await api.updateSettings({
    approvalMode: document.querySelector('input[name="mode"]:checked')?.value,
    sendPreviewSeconds: Number($("#preview-seconds").value),
    model: $("#model").value,
    effort: $("#effort").value,
    email: { address: $("#email-address").value.trim(), ...hosts },
    browser: { channel: $("#browser-channel").value },
  });
  if ($("#anthropic-key").value.trim()) await api.setSecret("anthropicKey", $("#anthropic-key").value.trim());
  if ($("#email-password").value.trim()) await api.setSecret("emailPassword", $("#email-password").value.replace(/\s+/g, ""));
  await renderSettings();
  renderRailFoot();
}

// ---- events ---------------------------------------------------------------------------

async function startTask(text) {
  const task = await attempt(() => api.startTask(text));
  if (task) location.hash = `#tasks/${task.id}`;
}

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "command-form") {
    const text = $("#command-input").value.trim();
    if (text) startTask(text);
  } else if (id === "reply-form") {
    const text = $("#reply-input").value.trim();
    if (!text) return;
    const task = await attempt(() => api.replyTask(state.taskId, text));
    if (task) $("#reply-input").value = "";
  } else if (id === "fact-form") {
    if (await attempt(() => api.saveFact({ key: $("#fact-key").value, value: $("#fact-value").value }), "Saved")) renderMemory();
  } else if (id === "person-form") {
    const input = { name: $("#p-name").value, relation: $("#p-relation").value, email: $("#p-email").value, birthday: $("#p-birthday").value || undefined, family: $("#p-family").checked };
    if (await attempt(() => api.savePerson(input), "Saved")) renderMemory();
  } else if (id === "reminder-form") {
    const input = { text: $("#r-text").value, due: $("#r-due").value, repeat: $("#r-repeat").value };
    if (await attempt(() => api.createReminder(input), "Reminder added")) renderReminders();
  } else if (id === "settings-form") {
    await attempt(saveSettings, "Settings saved");
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  if (d.openTask) location.hash = `#tasks/${d.openTask}`;
  else if (d.example) {
    $("#command-input").value = d.example;
    $("#command-input").focus();
  } else if (d.approval) {
    t.closest(".actions")?.querySelectorAll("button").forEach((b) => (b.disabled = true));
    await attempt(() => api.respondApproval(d.approval, d.approve === "true"));
  } else if (d.answer) await attempt(() => api.replyTask(state.taskId, d.answer));
  else if (d.stop) await attempt(() => api.stopTask(d.stop), "Stopping…");
  else if (d.resume) await attempt(() => api.resumeTask(d.resume));
  else if (d.forget) {
    if (await attempt(() => api.forget(d.forget), "Forgotten. You can undo this in Activity.")) renderMemory();
  } else if (d.deleteReminder) {
    if (await attempt(() => api.deleteReminder(d.deleteReminder), "Deleted. You can undo this in Activity.")) renderReminders();
  } else if (d.undo) {
    if (await attempt(() => api.runUndo(d.undo), (label) => `Undid: ${label}`)) renderActivity();
  } else if (t.id === "verify-log") {
    const r = await attempt(() => api.verifyAudit());
    if (r) $("#verify-result").innerHTML = r.ok ? `<span class="pill ok">Intact · ${r.count} entries</span>` : `<span class="pill stop">${esc(r.reason)}</span>`;
  } else if (t.id === "test-email") {
    t.disabled = true;
    await attempt(async () => {
      await saveSettings();
      return api.testEmail();
    }, (msg) => msg);
    if (document.body.contains(t)) t.disabled = false;
  } else if (t.id === "train-style") {
    t.disabled = true;
    t.textContent = "Reading your sent mail…";
    if (await attempt(() => api.trainStyle(), "Writing style saved")) renderMemory();
    else if (document.body.contains(t)) {
      t.disabled = false;
      t.textContent = "Train on my sent mail";
    }
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "email-preset") $("#custom-hosts").hidden = e.target.value !== "custom";
});

// Dropping a file on the command bar puts its path into the request.
document.addEventListener("dragover", (e) => {
  if (e.target.closest?.("#command")) {
    e.preventDefault();
    $("#command").classList.add("dropping");
  }
});
document.addEventListener("dragleave", (e) => {
  if (e.target.closest?.("#command")) $("#command").classList.remove("dropping");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const command = e.target.closest?.("#command");
  if (!command) return;
  command.classList.remove("dropping");
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (paths.length) {
    const input = $("#command-input");
    input.value = `${input.value.trim()} ${paths.map((p) => `"${p}"`).join(" ")}`.trim() + " ";
    input.focus();
  }
});

api.onNav((view) => {
  if (view === "command") {
    location.hash = "#tasks";
    setTimeout(() => $("#command-input")?.focus(), 50);
  } else location.hash = `#${view}`;
});

window.addEventListener("hashchange", route);
(async () => {
  try {
    state.app = await api.state();
    state.tasks = await api.listTasks();
    await route();
  } catch (err) {
    $("#main").innerHTML = `<div class="page"><div class="error">Doppel couldn't start: ${esc(err.message)}</div></div>`;
  }
})();
