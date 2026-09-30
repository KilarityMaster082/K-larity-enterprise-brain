// Owner task: EB-98 UI tests — lets `node --test` run the app's TypeScript modules directly: resolves
// extensionless relative imports and the "@/..." alias to .ts files. No test dependencies.
import { register } from "node:module";

register("./resolve-hooks.mjs", import.meta.url);
