import { createFileRoute } from "@tanstack/react-router";
import { EditorShell } from "@/components/auralith/EditorShell";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="h-dvh">
      <EditorShell />
    </div>
  );
}
