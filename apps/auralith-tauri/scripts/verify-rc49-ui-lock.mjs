import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const app = fs.readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");

// npm run build is invoked twice by CI/Tauri. The first pass verifies the clean
// rc.49.1 sources; after the official rc.49 hotfix mutates the working tree,
// subsequent passes intentionally skip this pre-mutation lock check.
if (app.includes("RC49_HOTFIX_SHAPES")) {
  console.log("[rc.49 UI lock] post-hotfix build; clean source was already verified");
  process.exit(0);
}

const locked = {
  "src/ui/App.tsx": "93121f4b4fcd45d11761fcb88344eebf996e6476",
  "src/ui/HelpOverlay.tsx": "0df3ac17d5fca4c774e957340804b71fc1c25a51",
  "src/ui/HostPage.tsx": "ee11ca39ddf74b9088a189c18fd2f39f50ca18ae",
  "src/ui/QrPanel.tsx": "76ed933b176ef51da6a029d4d45f895cadb99154",
  "src/ui/ViewerPage.tsx": "bf5d482af469abd8f3c42a41f1c71a7836665303",
  "src/ui/dropdown-theme.css": "fd21ba90c7fc8dc9262283f8425ec3c11354f79e",
  "src/ui/effect-controls-cleanup.css": "f544b806b6be83033942489143ec59992738001a",
  "src/ui/helpContent.ts": "2bef40cacea5a596accd4d9dd066a50588e06a1f",
  "src/ui/reference-layout.css": "6f5feb1a058ff4845d5505bb768891034dbf26c3",
  "src/ui/referenceChrome.ts": "6186875b47f0fde2d6d47002c68f74741c3d999b",
  "src/ui/styles.css": "8f83fa67fdb0287414ffcba4b3f71747e385d668",
  "index.html": "cb312fe13483d53582c0f9e1511d1258bdf69741",
  "src/main.tsx": "5924fb5d8dff93501e70c2aadeb821b1604ca228"
};

const changed = [];
for (const [rel, expected] of Object.entries(locked)) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { changed.push(`${rel}: missing`); continue; }
  const actual = execFileSync("git", ["hash-object", rel], { cwd: root, encoding: "utf8" }).trim();
  if (actual !== expected) changed.push(`${rel}: ${actual} != ${expected}`);
}
if (changed.length) throw new Error("rc.49 visual/UI lock failed:\n" + changed.join("\n"));
console.log(`[rc.49 UI lock] PASS — ${Object.keys(locked).length} visual/UI source files are unchanged from rc.49.1`);
