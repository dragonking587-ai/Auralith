import type { Project, Region } from "./types";

async function urlToDataUrl(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

function canvasFromImage(img: HTMLImageElement | null): string | undefined {
  if (!img || !img.naturalWidth) return undefined;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(img, 0, 0);
  try {
    return c.toDataURL("image/jpeg", 0.92);
  } catch {
    return c.toDataURL("image/png");
  }
}

export async function serializeProject(project: Project, extras: {
  backdropImage?: HTMLImageElement | null;
  poll?: unknown;
  reactions?: unknown;
}): Promise<Project> {
  let backdrop = await urlToDataUrl(project.backdropDataUrl);
  if (!backdrop || backdrop.startsWith("blob:")) backdrop = canvasFromImage(extras.backdropImage || null);
  const regions: Region[] = [];
  for (const r of project.regions) {
    const prop = await urlToDataUrl(r.propDataUrl);
    regions.push({
      ...r,
      effects: r.effects.map((e) => ({ ...e })),
      propDataUrl: prop && !prop.startsWith("blob:") ? prop : r.propDataUrl?.startsWith("data:") ? r.propDataUrl : undefined
    });
  }
  return {
    ...project,
    backdropDataUrl: backdrop,
    regions,
    poll: (extras.poll as Project["poll"]) || project.poll,
    reactions: (extras.reactions as Project["reactions"]) || project.reactions
  };
}

export function projectHasContent(p: Project) {
  return !!(p.backdropDataUrl || p.regions.length);
}
