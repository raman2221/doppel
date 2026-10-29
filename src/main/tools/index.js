// Every tool Doppel can use. Each declares an actionClass (read, local,
// ships, payment). Browser tools that only know their class once they see the
// page (a "Pay" button vs. a "Next" button) ask for approval themselves.
import { tools as email } from "./email.js";
import { tools as browser } from "./browser.js";
import { tools as memory } from "./memory.js";
import { tools as reminders } from "./reminders.js";
import { tools as forms } from "./forms.js";

const SELF_APPROVING = new Set(["browser_fill", "browser_select", "browser_click", "browser_press"]);

const askUser = {
  name: "ask_user",
  description: "Ask the user a question and wait for the answer. Use it only when you can't continue without something only they know. Offer options when the choice is between a few things.",
  actionClass: "read",
  input_schema: {
    type: "object",
    properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
    required: ["question"],
  },
  run: (input, ctx) => ctx.ask(input),
};

export const TOOLS = [...email, ...browser, ...memory, ...reminders, ...forms, askUser].map((tool) => ({
  ...tool,
  selfApproves: SELF_APPROVING.has(tool.name),
}));

const byName = new Map(TOOLS.map((t) => [t.name, t]));
export const findTool = (name) => byName.get(name) ?? null;

export const toolDefinitions = () => TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

// Checks the fields a tool marks as required, and their basic types.
export function validateInput(tool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Input must be an object.";
  const schema = tool.input_schema;
  for (const key of schema.required ?? []) {
    if (input[key] === undefined || input[key] === null || input[key] === "") return `Missing required field "${key}".`;
  }
  for (const [key, value] of Object.entries(input)) {
    const type = schema.properties?.[key]?.type;
    if (!type || value === undefined || value === null) continue;
    const ok =
      type === "integer" ? Number.isInteger(value) || /^\d+$/.test(String(value)) :
      type === "array" ? Array.isArray(value) :
      type === "object" ? typeof value === "object" && !Array.isArray(value) :
      typeof value === type;
    if (!ok) return `Field "${key}" should be ${type === "integer" ? "an integer" : `a ${type}`}.`;
  }
  return null;
}
