import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

const version = read("VERSION").trim();
must(version.startsWith("1.0.0-rc.49."), `unexpected VERSION: ${version}`);
must(JSON.parse(read("package.json")).version === version, "package.json version mismatch");
must(JSON.parse(read("src-tauri/tauri.conf.json")).version === version, "tauri.conf.json version mismatch");

const neon = read("src/render/threeLightOpticalLayer.ts");
must(neon.includes("float centerCut = smoothstep("), "Neon center cutout missing");
must(neon.includes("float planeFade = 1.0 - smoothstep("), "Neon plane-edge fade missing");
must(neon.includes("float support = centerCut * planeFade;"), "Neon support mask missing");
must(!/uMode < 10\.5[\s\S]{0,1500}innerGlow/.test(neon), "Neon still has a filled center contribution");

const cinematic = read("src/render/cinematicRenderer.ts");
must(cinematic.includes("legacyProjectWithoutNativeNeon"), "legacy Neon suppression missing");
must(cinematic.includes('effect.kind === "NeonGlow" && isThreeNativePlacement'), "legacy Neon routing guard missing");
must(cinematic.includes("if (legacyNeon.removed > 0)"), "Neon fallback redraw missing");

const flame = read("src/render/threeEnvironmentFinalLayer.ts");
must(flame.includes("for (int i = 0; i < 9; i++)"), "nine-tongue flame missing");
must(flame.includes("tipWisps"), "flame tip wisps missing");
must(flame.includes('blending: kind === "RealisticFlame" ? THREE.NormalBlending'), "natural flame blending missing");

const designer = read("src/ui/GamingOverlayDesigner.tsx");
for (const label of ["Web / Song Card", "Card Fit", "Fit — show whole card", "Source Width", "Source Height", "Tilt X", "Tilt Y", "Skew X", "Skew Y", "Perspective", "Loudman.live"]) {
  must(designer.includes(label), `overlay control missing: ${label}`);
}
const surface = read("src/ui/GamingOverlaySurface.tsx");
must(surface.includes("perspective(${item.perspective}px) rotateX(${item.rotateX}deg) rotateY(${item.rotateY}deg)"), "overlay perspective transform chain missing");
must(surface.includes('const webFit = item.webFit || "fit";'), "web-card fit mode missing");
must(surface.includes("Math.min(width / sourceWidth, height / sourceHeight)"), "web-card Fit scale missing");
must(surface.includes("Math.max(width / sourceWidth, height / sourceHeight)"), "web-card Fill scale missing");
must(surface.includes('transform: `translate(-50%, -50%) scale(${webScaleX}, ${webScaleY})`'), "web-card whole-surface scaling missing");

const overlayModel = read("src/scene/gamingOverlay.ts");
must(overlayModel.includes('export type GamingOverlayWebFit = "fit" | "fill" | "stretch" | "native";'), "web fit model missing");
must(overlayModel.includes('webFit: "fit"'), "new web cards must default to Fit");
must(overlayModel.includes("sourceWidth: 640"), "web-card source width default missing");
must(overlayModel.includes("sourceHeight: 360"), "web-card source height default missing");

console.log("RC49.3.10_VERIFY_OK neon=fixed flame=multi-tongue gaming-overlay=enabled song-card-fit=fixed");
