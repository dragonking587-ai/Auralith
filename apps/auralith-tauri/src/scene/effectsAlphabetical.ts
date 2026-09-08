import { ALL_EFFECTS } from "./types";

// Keep every UI that consumes ALL_EFFECTS organized A-Z without changing effect IDs or project compatibility.
ALL_EFFECTS.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
