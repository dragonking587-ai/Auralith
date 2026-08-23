import { createFileRoute } from "@tanstack/react-router";
import { getSession, hydrateSession, persistSession } from "../../../../scripts/auralith-live-hub.mjs";

export const Route = createFileRoute("/api/auralith/live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const session = url.searchParams.get("session") ?? "";
        if (!session) return Response.json({ error: "session required" }, { status: 400 });
        const s = await hydrateSession(session);
        return Response.json({
          scene: s.scene,
          sceneRev: s.sceneRev,
          imageRev: s.imageRev,
          bands: s.bands,
        });
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const body = (await request.json().catch(() => ({}))) as {
          session?: string;
          scene?: unknown;
          rev?: number;
          bands?: unknown;
        };
        const id = body.session || url.searchParams.get("session") || "";
        if (!id) return Response.json({ error: "session required" }, { status: 400 });
        await hydrateSession(id);
        const s = getSession(id);
        if (body.scene) {
          s.scene = body.scene;
          s.sceneRev = body.rev ?? s.sceneRev + 1;
        }
        if (body.bands) s.bands = body.bands;
        await persistSession(id);
        return Response.json({ ok: true, sceneRev: s.sceneRev, imageRev: s.imageRev });
      },
    },
  },
});
