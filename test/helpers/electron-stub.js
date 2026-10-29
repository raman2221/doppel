// Minimal stand-in for Electron's safeStorage so main-process modules load in plain Node.
export const safeStorage = {
  encryptStringAsync: async (s) => Buffer.from(`enc:${s}`),
  decryptStringAsync: async (b) => ({ result: b.toString().replace(/^enc:/, ""), shouldReEncrypt: false }),
};
