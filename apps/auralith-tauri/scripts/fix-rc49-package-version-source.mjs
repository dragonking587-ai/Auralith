import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hotfixPath = path.join(here, "apply-rc49-hotfix.mjs");
let text = fs.readFileSync(hotfixPath, "utf8");

const oldBlock = `  app = replaceOnce(\n    app,\n    'const APP_VERSION = "1.0.0-rc.44";',\n    'const APP_VERSION = "1.0.0-rc.49.1";',\n    "runtime version"\n  );`;

const newBlock = `  // Older rc.49 sources hard-coded rc.44 here. Newer Reborn builds source the\n  // version from package.json through Vite so the UI/updater cannot drift.\n  if (app.includes('const APP_VERSION = "1.0.0-rc.44";')) {\n    app = app.replace(\n      'const APP_VERSION = "1.0.0-rc.44";',\n      'const APP_VERSION = "1.0.0-rc.49.1";'\n    );\n  } else if (\n    !app.includes('const APP_VERSION = __AURALITH_VERSION__;') &&\n    !app.includes('const APP_VERSION = "1.0.0-rc.49.1";')\n  ) {\n    throw new Error("[rc.49.1 hotfix] could not find supported runtime version source");\n  }`;

if (text.includes(newBlock)) {
  console.log("[rc49-version-source] already compatible");
  process.exit(0);
}
if (!text.includes(oldBlock)) throw new Error("[rc49-version-source] legacy runtime-version block not found");
text = text.replace(oldBlock, newBlock);
fs.writeFileSync(hotfixPath, text);
console.log("[rc49-version-source] package-driven version source accepted");
