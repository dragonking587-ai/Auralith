import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const app = fs.readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
const fail = (message) => { throw new Error(`[ui-nav-audit] ${message}`); };
const has = (needle, label) => { if (!app.includes(needle)) fail(`missing ${label}`); };
const lacks = (needle, label) => { if (app.includes(needle)) fail(`stale ${label}`); };

has('type AppPage = "home" | "editor" | "overlay" | "audio" | "output" | "server" | "devices" | "settings";', "distinct AppPage type including Overlay");
has('useState<AppPage>("home")', "Home default page");
for (const page of ["home", "editor", "overlay", "audio", "output", "server", "devices", "settings"]) has(`["${page}"`, `${page} navigation entry`);
has('{tab==="home" && (', "dedicated Home pane");
has('{tab==="overlay" && (', "dedicated Overlay pane");
has('{tab==="output" && (', "dedicated Output pane");
has('{tab==="server" && (', "dedicated Server pane");
has('{tab==="devices" && (', "dedicated Devices pane");
has('<h3>WHAT\'S NEW</h3>', "What's New Home content");
has('<h3>UPCOMING</h3>', "Upcoming Home content");
has('<h3>CLEAN OUTPUT</h3>', "Output controls");
has('<h4>LOCAL / LAN SERVER</h4>', "Server controls");
has('<h4>HOST REMOTE</h4>', "Device pairing controls");
lacks('["output","Home"]', "Home-to-output alias");
lacks('["output","Server"]', "Server-to-output alias");
lacks('["output","Devices"]', "Devices-to-output alias");
console.log("[ui-nav-audit] PASS — Home, Editor, Overlay, Audio, Output, Server, Devices, and Settings are distinct pages with dedicated control groups.");
