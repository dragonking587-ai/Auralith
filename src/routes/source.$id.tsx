import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { StreamView } from "@/components/auralith/StreamView";

export const Route = createFileRoute("/source/$id")({
  component: SourcePage,
  ssr: false,
  head: () => ({
    meta: [{ title: "Auralith — Stream Output" }],
  }),
});

function SourcePage() {
  const { id } = Route.useParams();
  useEffect(() => {
    document.title = "Auralith — Stream Output";
  }, []);
  return <StreamView sessionId={id} />;
}
