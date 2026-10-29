// The hard line: Doppel never types or stores Social Security numbers,
// passwords, or card and bank numbers. It leaves those for the user.
const SENSITIVE_LABEL =
  /\b(ssn|social[ _-]?security|passport|password|passcode|pin ?(code|number)?|cvv|cvc|csc|security[ _-]?code|card[ _-]?(number|no)|credit[ _-]?card|debit[ _-]?card|cc[ _-]?(num|number)|routing|account[ _-]?(number|no)|bank[ _-]?account|iban|tax[ _-]?id|itin|ein)\b/i;

const SENSITIVE_AUTOCOMPLETE = /^(cc-|current-password|new-password|one-time-code)/i;

export function isSensitiveLabel(...labels) {
  return labels.some((l) => l && SENSITIVE_LABEL.test(String(l).replace(/([a-z])([A-Z])/g, "$1 $2")));
}

export function isSensitiveAutocomplete(value) {
  return Boolean(value) && SENSITIVE_AUTOCOMPLETE.test(String(value));
}

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function containsSensitiveValue(value) {
  const text = String(value ?? "");
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return true; // SSN
  for (const match of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true; // card number
  }
  return false;
}

export const SENSITIVE_REFUSAL =
  "Doppel never types or stores Social Security numbers, passwords, or card and bank numbers. Leave this for the user and tell them exactly where to enter it themselves.";
