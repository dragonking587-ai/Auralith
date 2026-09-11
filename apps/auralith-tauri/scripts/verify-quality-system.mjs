import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const fail = (message) => { throw new Error(`[quality-audit] ${message}`); };
const requireText = (text, needle, label) => { if (!text.includes(needle)) fail(`missing ${label}: ${needle}`); };

const types = read("src/scene/types.ts");
const app = read("src/ui/App.tsx");
const legacy = read("src/render/renderer.ts");
const particles = read("src/render/threeParticleLayer.ts");
const volumetric = read("src/render/threeVolumetricLayer.ts");
const pipeline = read("src/render/cinematicPipelineV2.ts");

requireText(types, 'quality: "Low" | "Medium" | "High" | "Ultra";', "four project quality tiers");
requireText(types, 'quality: "High"', "High default quality");
for (const q of ["Low", "Medium", "High", "Ultra"]) requireText(app, `"${q}"`, `${q} UI option`);
requireText(legacy, 'project.quality === "Ultra" ? 3 : project.quality === "High" ? 2 : project.quality === "Medium" ? 1 : 0', "legacy 0/1/2/3 quality mapping");
requireText(legacy, 'quality: project.quality || "High"', "fireworks quality forwarding");
requireText(particles, 'if (project.quality === "Ultra") return 192;', "Ultra particle density");
requireText(particles, 'if (project.quality === "High") return 128;', "High particle density");
requireText(particles, 'if (project.quality === "Medium") return 80;', "Medium particle density");
requireText(particles, 'return 48;', "Low particle density");
requireText(volumetric, 'project.quality === "Ultra" ? 2 : project.quality === "High" ? 1.45 : project.quality === "Medium" ? 1 : 0.72', "volumetric quality mapping");
requireText(pipeline, 'project.quality === "Ultra" ? 1.0 : project.quality === "High" ? 0.82 : project.quality === "Medium" ? 0.62 : 0.42', "cinematic post quality mapping");

console.log("[quality-audit] PASS — Low/Medium/High/Ultra are selectable and wired through legacy detail, particles, volumetrics, fireworks, and cinematic post-processing.");
