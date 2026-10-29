// Map `import ... from "electron"` to the stub when running tests in plain Node.
import { registerHooks } from "node:module";
const stub = new URL("./electron-stub.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    return specifier === "electron" ? { url: stub, shortCircuit: true } : next(specifier, context);
  },
});
