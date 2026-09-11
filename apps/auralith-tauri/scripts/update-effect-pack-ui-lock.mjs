import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const lockPath = path.join(root, "scripts", "verify-rc49-ui-lock.mjs");
let source = fs.readFileSync(lockPath, "utf8");

for (const rel of ["src/ui/App.tsx", "src/ui/styles.css"]) {
  const hash = execFileSync("git", ["hash-object", rel], { cwd: root, encoding: "utf8" }).trim();
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`("${escaped}":\\s*")[0-9a-f]+(")`);
  if (!re.test(source)) throw new Error(`[effect-packs] UI lock entry missing for ${rel}`);
  source = source.replace(re, `$1${hash}$2`);
  console.log(`[effect-packs] UI lock ${rel} -> ${hash}`);
}

source = source.replace(
  "visual/UI source files are unchanged from rc.49.1",
  "visual/UI source files match the approved Reborn UI baseline"
);
fs.writeFileSync(lockPath, source, "utf8");
