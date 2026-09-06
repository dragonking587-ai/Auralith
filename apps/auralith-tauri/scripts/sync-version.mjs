import fs from "node:fs";

const version = fs.readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
const appPath = new URL("../src/ui/App.tsx", import.meta.url);
const source = fs.readFileSync(appPath, "utf8");
const next = source.replace(/const APP_VERSION = "[^"]+";/, `const APP_VERSION = "${version}";`);

if (next === source && !source.includes(`const APP_VERSION = "${version}";`)) {
  throw new Error("Could not synchronize APP_VERSION in src/ui/App.tsx");
}

fs.writeFileSync(appPath, next, "utf8");
console.log(`[version] Main Auralith APP_VERSION -> ${version}`);
