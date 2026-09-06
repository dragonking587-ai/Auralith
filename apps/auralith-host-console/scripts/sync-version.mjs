import fs from "node:fs";

const confPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const htmlPath = new URL("../web/index.html", import.meta.url);
const version = JSON.parse(fs.readFileSync(confPath, "utf8")).version;
const source = fs.readFileSync(htmlPath, "utf8");
const next = source.replace(/const APP_VERSION="[^"]+";/, `const APP_VERSION="${version}";`);

if (next === source && !source.includes(`const APP_VERSION="${version}";`)) {
  throw new Error("Could not synchronize Host Console APP_VERSION in web/index.html");
}

fs.writeFileSync(htmlPath, next, "utf8");
console.log(`[version] Host Console APP_VERSION -> ${version}`);
