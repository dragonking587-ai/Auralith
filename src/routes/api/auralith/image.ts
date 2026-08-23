import { createFileRoute } from "@tanstack/react-router";
import { getSession } from "../../../../scripts/auralith-live-hub.mjs";

export const Route = createFileRoute("/api/auralith/image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const session = url.searchParams.get("session") ?? "";
        if (!session) return new Response("session required", { status: 400 });
        const s = getSession(session);
        if (!s.image) return new Response("not found", { status: 404 });
        return new Response(s.image, {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const session = url.searchParams.get("session") ?? "";
        if (!session) return Response.json({ error: "session required" }, { status: 400 });
        const body = await request.text();
        const s = getSession(session);
        s.image = body;
        s.imageRev += 1;
        return Response.json({ ok: true, imageRev: s.imageRev });
      },
    },
  },
});
