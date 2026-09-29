/**
 * For HTTP harnesses that call server modules directly (to emit the events a
 * scheduler would): `server-only` guards against client bundles and throws in
 * plain Node. This resolves it to an empty module — for the harness process
 * only; nothing here ships. Both loaders: tsx compiles to CommonJS `require`.
 */
import Module, { register } from "node:module";
import { fileURLToPath } from "node:url";

const empty = fileURLToPath(new URL("./empty.cjs", import.meta.url));

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "server-only" ? empty : resolveFilename.call(this, request, ...rest);
};

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
      if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
      return next(specifier, context);
    }`),
  import.meta.url,
);
