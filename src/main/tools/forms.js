// PDF forms: list a form's fields, then fill them from what Doppel knows.
// The original is never touched; the result is saved as a new "(filled)" copy.
import fs from "node:fs";
import path from "node:path";
import { registerUndo, push as pushUndo } from "../undo.js";
import { isSensitiveLabel, containsSensitiveValue } from "./sensitive.js";

// pdf-lib loads on first use, so it costs nothing until a form is filled.
let pdf = null;
const loadPdf = async () => (pdf ??= await import("pdf-lib"));

registerUndo("file_delete", ({ file }) => fs.rmSync(file, { force: true }));

function resolvePdf(p) {
  const file = path.resolve(String(p ?? "").replace(/^"|"$/g, ""));
  if (path.extname(file).toLowerCase() !== ".pdf") throw new Error("That isn't a .pdf file.");
  if (!fs.existsSync(file)) throw new Error(`No file at ${file}.`);
  return file;
}

async function loadForm(file) {
  const { PDFDocument } = await loadPdf();
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const form = doc.getForm();
  if (form.getFields().length === 0) {
    throw new Error("This PDF has no fillable fields. It's probably a scanned or flattened form, which Doppel can't fill yet.");
  }
  return { doc, form };
}

function describe(field) {
  const name = field.getName();
  const base = { name, sensitive: isSensitiveLabel(name) };
  if (field instanceof pdf.PDFTextField) return { ...base, type: "text", value: field.getText() ?? "", maxLength: field.getMaxLength() ?? undefined };
  if (field instanceof pdf.PDFCheckBox) return { ...base, type: "checkbox", value: field.isChecked() };
  if (field instanceof pdf.PDFRadioGroup) return { ...base, type: "radio", options: field.getOptions(), value: field.getSelected() ?? null };
  if (field instanceof pdf.PDFDropdown || field instanceof pdf.PDFOptionList) return { ...base, type: "choice", options: field.getOptions(), value: field.getSelected() };
  return { ...base, type: "other" };
}

export async function inspectForm({ path: p }) {
  const file = resolvePdf(p);
  const { form } = await loadForm(file);
  const fields = form.getFields().map(describe);
  return { file, fieldCount: fields.length, fields, note: "Fields marked sensitive must be left for the user." };
}

function outputPath(file) {
  const dir = path.dirname(file);
  const base = path.basename(file, ".pdf");
  let candidate = path.join(dir, `${base} (filled).pdf`);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${base} (filled ${n}).pdf`);
  return candidate;
}

const truthy = (v) => v === true || /^(true|yes|y|x|checked|on|1)$/i.test(String(v).trim());

export async function fillForm(task, { path: p, values }) {
  const file = resolvePdf(p);
  if (!values || typeof values !== "object") throw new Error("values must map field names to values.");
  const { doc, form } = await loadForm(file);
  const filled = [];
  const skipped = [];

  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      skipped.push({ name, reason: "No field with this exact name. Use form_inspect to get the names." });
      continue;
    }
    if (isSensitiveLabel(name) || containsSensitiveValue(value)) {
      skipped.push({ name, reason: "Sensitive field. Left blank for the user to fill in." });
      continue;
    }
    try {
      if (field instanceof pdf.PDFTextField) {
        const max = field.getMaxLength();
        const text = String(value ?? "");
        if (max && text.length > max) throw new Error(`Too long: this field holds ${max} characters.`);
        field.setText(text);
      } else if (field instanceof pdf.PDFCheckBox) {
        truthy(value) ? field.check() : field.uncheck();
      } else if (field instanceof pdf.PDFRadioGroup || field instanceof pdf.PDFDropdown || field instanceof pdf.PDFOptionList) {
        const options = field.getOptions();
        const match = options.find((o) => o.toLowerCase() === String(value).toLowerCase());
        if (!match) throw new Error(`Must be one of: ${options.join(", ")}`);
        field.select(match);
      } else {
        throw new Error("This field type can't be filled.");
      }
      filled.push(name);
    } catch (err) {
      skipped.push({ name, reason: err.message });
    }
  }

  if (filled.length === 0) return { saved: null, filled, skipped, note: "Nothing was filled, so no file was written." };
  const out = outputPath(file);
  fs.writeFileSync(out, await doc.save());
  pushUndo({ taskId: task?.id ?? null, label: `Filled form ${path.basename(out)}`, type: "file_delete", data: { file: out } });
  return { saved: out, filled, skipped };
}

export const tools = [
  {
    name: "form_inspect",
    description: "List the fillable fields in a PDF form: exact field names, types, options, and current values. Fields marked sensitive (SSN, passwords, card or bank numbers) must be left for the user.",
    actionClass: "read",
    input_schema: { type: "object", properties: { path: { type: "string", description: "Full path to the PDF" } }, required: ["path"] },
    run: async (input) => JSON.stringify(await inspectForm(input)),
  },
  {
    name: "form_fill",
    description:
      "Fill a PDF form and save it as a new '(filled)' copy next to the original. `values` maps exact field names from form_inspect to values (text, true/false for checkboxes, or an option name). Use only information you know is right; ask the user for anything you don't know.",
    actionClass: "local",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        values: { type: "object", additionalProperties: true },
      },
      required: ["path", "values"],
    },
    run: async (input, ctx) => JSON.stringify(await fillForm(ctx.task, input)),
  },
];
