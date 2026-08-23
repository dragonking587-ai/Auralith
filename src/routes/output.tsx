import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StreamView } from "@/components/auralith/StreamView";
import { getOrCreateSessionId } from "@/lib/auralith/storage";

export const Route = createFileRoute("/output")({
  component: OutputPage,
  ssr: false,
  head: () => ({
    meta: [{ title: "Auralith — Stream Output" }],
  }),
});

function OutputPage() {
  const [session, setSession] = useState("");

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setSession(search.get("session") || getOrCreateSessionId());
    document.title = "Auralith — Stream Output";
  }, []);

  if (!session) return <div className="h-dvh w-full bg-black" />;
  return <StreamView sessionId={session} />;
}
