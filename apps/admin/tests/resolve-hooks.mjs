// Owner task: EB-98 UI tests — resolve hook used by tests/register.mjs.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);

function withExt(url) {
  const path = fileURLToPath(url);
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    if (existsSync(path + ext) && (ext || /\.[cm]?[jt]sx?$/.test(path))) return pathToFileURL(path + ext).href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const hit = withExt(new URL(specifier.slice(2), ROOT));
    if (hit) return { url: hit, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const hit = withExt(new URL(specifier, context.parentURL));
    if (hit) return { url: hit, shortCircuit: true };
  }
  return next(specifier, context);
}
