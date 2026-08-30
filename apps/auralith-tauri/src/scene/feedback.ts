export const FEEDBACK_TYPES = [
  "Bug Report",
  "UI / Usability",
  "Effect Problem",
  "Audio Problem",
  "Performance Problem",
  "Crash",
  "Feature Request",
  "General Feedback",
  "Other",
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export type FeedbackDraft = {
  type: FeedbackType;
  title: string;
  body: string;
  steps: string;
  expected: string;
  actual: string;
  includeDiag: boolean;
};

export type FeedbackDiag = {
  version: string;
  tag: string;
  userAgent: string;
  screen: string;
  renderer: string;
  quality: string;
  effects: string;
  audio: string;
  view: string;
  lastError: string;
};

export function buildReport(d: FeedbackDraft, diag: FeedbackDiag): string {
  const lines = [
    "Auralith Reborn Feedback",
    "",
    `Type: ${d.type}`,
    `Title: ${d.title}`,
    `Version: ${diag.version}`,
    `Tag: ${diag.tag}`,
    `Windows / UA: ${d.includeDiag ? diag.userAgent : "(not included)"}`,
    `Display: ${d.includeDiag ? diag.screen : "(not included)"}`,
    `Renderer: ${d.includeDiag ? diag.renderer : "(not included)"}`,
    `Quality: ${d.includeDiag ? diag.quality : "(not included)"}`,
    `Audio: ${d.includeDiag ? diag.audio : "(not included)"}`,
    `View: ${d.includeDiag ? diag.view : "(not included)"}`,
    `Effects: ${d.includeDiag ? diag.effects : "(not included)"}`,
    "",
    "Description:",
    d.body || "(none)",
    "",
    "Steps to reproduce:",
    d.steps || "(none)",
    "",
    "Expected:",
    d.expected || "(none)",
    "",
    "Actual:",
    d.actual || "(none)",
  ];
  if (d.includeDiag && diag.lastError) {
    lines.push("", "Last error:", diag.lastError.slice(0, 800));
  }
  return lines.join("\n");
}

export function githubNewIssueUrl(title: string, body: string): string {
  const base = "https://github.com/dragonking587-ai/Auralith/issues/new";
  const q = new URLSearchParams({ title: title.slice(0, 180), body: body.slice(0, 5500) });
  return `${base}?${q.toString()}`;
}
