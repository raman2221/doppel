// Email over IMAP (reading, archiving, drafts) and SMTP (sending), using an
// app password. Works with Gmail and most other providers.
import { getSettings } from "../store.js";
import { getSecret } from "../secrets.js";
import { registerUndo, push as pushUndo } from "../undo.js";
import { isFamilyAddress, loadMemory } from "./memory.js";

const MAX_BODY_CHARS = 15000;

// Mail libraries load on first use, so they cost no memory until email is used.
const lib = {};
async function load() {
  lib.ImapFlow ??= (await import("imapflow")).ImapFlow;
  lib.nodemailer ??= (await import("nodemailer")).default;
  lib.MailComposer ??= (await import("nodemailer/lib/mail-composer/index.js")).default;
  lib.simpleParser ??= (await import("mailparser")).simpleParser;
  return lib;
}

// Timeouts keep a dropped connection (sleep, bad Wi-Fi) from hanging a task.
async function smtp(a) {
  const { nodemailer } = await load();
  return nodemailer.createTransport({
    host: a.smtpHost,
    port: Number(a.smtpPort),
    secure: Number(a.smtpPort) === 465,
    auth: { user: a.address, pass: a.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

function account() {
  const { email } = getSettings();
  const pass = getSecret("emailPassword");
  if (!email.address || !pass) throw new Error("Email isn't connected yet. Ask the user to add their address and app password in Settings → Email.");
  return { ...email, pass };
}

async function withImap(fn) {
  const a = account();
  const { ImapFlow } = await load();
  const client = new ImapFlow({ host: a.imapHost, port: Number(a.imapPort), secure: true, auth: { user: a.address, pass: a.pass }, logger: false, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function specialFolder(client, use) {
  const boxes = await client.list();
  return boxes.find((b) => b.specialUse === use)?.path ?? null;
}

const addressList = (field) => (field?.value ?? []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
const envelopeFrom = (env) => (env?.from ?? []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");

function cleanBody(parsed) {
  const text = parsed.text || (parsed.html ? parsed.html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "");
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n…[truncated]` : text;
}

export async function listInbox({ limit = 20, unread_only = false, folder = "INBOX" } = {}) {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = (await client.search(unread_only ? { seen: false } : { all: true }, { uid: true })) || [];
      const pick = uids.slice(-Math.min(Number(limit) || 20, 50));
      if (pick.length === 0) return { folder, count: 0, messages: [] };
      const messages = [];
      for await (const msg of client.fetch(pick, { envelope: true, flags: true, internalDate: true }, { uid: true })) {
        messages.push({
          uid: msg.uid,
          from: envelopeFrom(msg.envelope),
          subject: msg.envelope?.subject ?? "(no subject)",
          date: msg.internalDate?.toISOString?.() ?? null,
          unread: !msg.flags?.has("\\Seen"),
        });
      }
      return { folder, count: messages.length, messages: messages.reverse() };
    } finally {
      lock.release();
    }
  });
}

export async function readEmail({ uid, folder = "INBOX" }) {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg) throw new Error(`No message with uid ${uid} in ${folder}.`);
      const parsed = await lib.simpleParser(msg.source);
      return {
        uid,
        from: addressList(parsed.from),
        to: addressList(parsed.to),
        cc: addressList(parsed.cc),
        date: parsed.date?.toISOString() ?? null,
        subject: parsed.subject ?? "(no subject)",
        attachments: parsed.attachments.map((a) => a.filename).filter(Boolean),
        body: cleanBody(parsed),
      };
    } finally {
      lock.release();
    }
  });
}

registerUndo("email_unarchive", async ({ archivePath, uids }) => {
  await withImap(async (client) => {
    const lock = await client.getMailboxLock(archivePath);
    try {
      await client.messageMove(uids, "INBOX", { uid: true });
    } finally {
      lock.release();
    }
  });
});

export async function archiveEmails(task, { uids }) {
  if (!Array.isArray(uids) || uids.length === 0) throw new Error("uids must be a non-empty list.");
  return withImap(async (client) => {
    const archivePath = (await specialFolder(client, "\\All")) ?? (await specialFolder(client, "\\Archive"));
    if (!archivePath) throw new Error("This mailbox has no Archive folder.");
    const lock = await client.getMailboxLock("INBOX");
    try {
      const result = await client.messageMove(uids.map(String).join(","), archivePath, { uid: true });
      const moved = result?.uidMap ? [...result.uidMap.values()] : [];
      if (moved.length) pushUndo({ taskId: task?.id ?? null, label: `Archive ${uids.length} email${uids.length === 1 ? "" : "s"}`, type: "email_unarchive", data: { archivePath, uids: moved.join(",") } });
      return `Archived ${uids.length} message${uids.length === 1 ? "" : "s"} to ${archivePath}.`;
    } finally {
      lock.release();
    }
  });
}

// Threading headers so a reply lands in the same conversation.
async function replyHeaders(uid) {
  if (!uid) return {};
  return withImap(async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg) return {};
      const parsed = await lib.simpleParser(msg.source);
      const refs = [].concat(parsed.references ?? [], parsed.messageId ?? []).filter(Boolean);
      return { inReplyTo: parsed.messageId, references: refs.join(" ") };
    } finally {
      lock.release();
    }
  });
}

function signedName() {
  return loadMemory().facts.find((f) => /^(name|full name|my name)$/i.test(f.key))?.value ?? null;
}

export async function sendEmail({ to, cc, subject, body, reply_to_uid }) {
  const a = account();
  const transport = await smtp(a);
  const headers = await replyHeaders(reply_to_uid);
  const name = signedName();
  const info = await transport.sendMail({ from: name ? `${name} <${a.address}>` : a.address, to, cc: cc || undefined, subject, text: body, ...headers });
  return `Sent to ${to}${cc ? ` (cc ${cc})` : ""}. Message id ${info.messageId}.`;
}

registerUndo("email_delete_draft", async ({ draftsPath, uid }) => {
  await withImap(async (client) => {
    const lock = await client.getMailboxLock(draftsPath);
    try {
      await client.messageDelete(String(uid), { uid: true });
    } finally {
      lock.release();
    }
  });
});

export async function saveDraft(task, { to, cc, subject, body, reply_to_uid }) {
  const a = account();
  const headers = await replyHeaders(reply_to_uid);
  const { MailComposer } = await load();
  const raw = await new MailComposer({ from: a.address, to, cc: cc || undefined, subject, text: body, ...headers }).compile().build();
  return withImap(async (client) => {
    const draftsPath = await specialFolder(client, "\\Drafts");
    if (!draftsPath) throw new Error("This mailbox has no Drafts folder.");
    const result = await client.append(draftsPath, raw, ["\\Draft", "\\Seen"]);
    if (result?.uid) pushUndo({ taskId: task?.id ?? null, label: `Draft: ${subject}`, type: "email_delete_draft", data: { draftsPath, uid: result.uid } });
    return `Saved a draft to ${draftsPath}: "${subject}" to ${to}.`;
  });
}

// Read recent sent mail so Claude can describe how the user writes.
export async function sentSamples(max = 40) {
  return withImap(async (client) => {
    const sentPath = await specialFolder(client, "\\Sent");
    if (!sentPath) throw new Error("This mailbox has no Sent folder.");
    const lock = await client.getMailboxLock(sentPath);
    try {
      const uids = ((await client.search({ all: true }, { uid: true })) || []).slice(-max);
      const samples = [];
      for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
        const parsed = await lib.simpleParser(msg.source);
        // Keep only what the user wrote, not the quoted thread below it.
        const own = (parsed.text ?? "").split(/\n(?:On .{5,200} wrote:|-{2,} ?Original Message|From: )/)[0].split("\n").filter((l) => !l.startsWith(">")).join("\n").trim();
        if (own.length > 20) samples.push(`Subject: ${parsed.subject ?? ""}\nTo: ${addressList(parsed.to)}\n\n${own.slice(0, 1500)}`);
      }
      return samples;
    } finally {
      lock.release();
    }
  });
}

export async function testConnection() {
  const result = await listInbox({ limit: 1 });
  const a = account();
  await (await smtp(a)).verify();
  return `Connected. Inbox and sending both work${result.count ? "" : " (inbox is empty)"}.`;
}

const recipients = (input) => [input.to, input.cc].filter(Boolean).join(", ");

export const tools = [
  {
    name: "email_list",
    description: "List recent messages in the inbox (or another folder): uid, sender, subject, date, unread.",
    actionClass: "read",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", description: "Up to 50. Default 20." }, unread_only: { type: "boolean" }, folder: { type: "string", description: "Default INBOX" } },
    },
    run: async (input) => JSON.stringify(await listInbox(input)),
  },
  {
    name: "email_read",
    description: "Read one message in full: sender, recipients, subject, attachment names, and body text.",
    actionClass: "read",
    input_schema: { type: "object", properties: { uid: { type: "integer" }, folder: { type: "string" } }, required: ["uid"] },
    run: async (input) => JSON.stringify(await readEmail(input)),
  },
  {
    name: "email_archive",
    description: "Archive messages out of the inbox (newsletters, notifications, finished threads). Can be undone for 30 minutes.",
    actionClass: "local",
    input_schema: { type: "object", properties: { uids: { type: "array", items: { type: "integer" } } }, required: ["uids"] },
    approval: (input) => ({ title: `Archive ${input.uids?.length ?? 0} email(s)` }),
    run: (input, ctx) => archiveEmails(ctx.task, input),
  },
  {
    name: "email_draft",
    description: "Save a message to the Drafts folder without sending it. Use when the user wants to review first, or the reply needs information you don't have.",
    actionClass: "local",
    input_schema: {
      type: "object",
      properties: { to: { type: "string" }, cc: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, reply_to_uid: { type: "integer", description: "uid of the inbox message this replies to" } },
      required: ["to", "subject", "body"],
    },
    approval: (input) => ({ title: `Save draft to ${input.to}`, preview: { kind: "email", ...input } }),
    run: (input, ctx) => saveDraft(ctx.task, input),
  },
  {
    name: "email_send",
    description: "Send an email as the user, in their voice. For replies, pass reply_to_uid so it threads correctly. Sent mail can't be undone.",
    actionClass: "ships",
    input_schema: {
      type: "object",
      properties: { to: { type: "string" }, cc: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, reply_to_uid: { type: "integer" } },
      required: ["to", "subject", "body"],
    },
    approval: (input) => ({
      title: `Send email to ${input.to}`,
      preview: { kind: "email", ...input },
      previewable: true,
      alwaysAsk: isFamilyAddress(recipients(input)),
    }),
    run: (input) => sendEmail(input),
  },
];
