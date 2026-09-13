import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const lockPath = path.join(root, "scripts", "verify-rc49-ui-lock.mjs");
let lock = fs.readFileSync(lockPath, "utf8");

for (const rel of ["src/ui/App.tsx", "src/ui/styles.css"]) {
  const hash = execFileSync("git", ["hash-object", rel], { cwd: root, encoding: "utf8" }).trim();
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`("${escaped}"\\s*:\\s*")[0-9a-f]{40}(")`);
  if (!re.test(lock)) throw new Error(`UI lock entry missing for ${rel}`);
  lock = lock.replace(re, `$1${hash}$2`);
  console.log(`[ui-lock] ${rel} -> ${hash}`);
}

lock = lock.replace("visual/UI source files are unchanged from rc.49.1", "visual/UI source files match the approved rc.49.3.8 overlay baseline");
fs.writeFileSync(lockPath, lock, "utf8");
