export type PollOption = "red" | "green";
export type ReactionMode = "live" | "winnerEnd";
export type TieBehavior = "keep" | "none";
export type OnEndBehavior = "restore" | "hold";

export type PollDisplay = {
  x: number; y: number; w: number; h: number;
  scale: number; opacity: number;
  showQuestion: boolean; showCounts: boolean; showPct: boolean; showTotal: boolean; showLeader: boolean;
  layout: "horizontal" | "vertical";
  fontSize: number; textColor: string;
  redAccent: string; greenAccent: string;
  bg: string; bgOpacity: number;
  border: boolean; borderW: number; radius: number; pad: number;
  align: "left" | "center" | "right";
};

export type PollConfig = {
  question: string;
  redLabel: string;
  greenLabel: string;
  redEffectId: string;
  greenEffectId: string;
  redColor: string;
  greenColor: string;
  reaction: ReactionMode;
  tie: TieBehavior;
  onEnd: OnEndBehavior;
  allowChange: boolean;
  transitionMs: number;
  display: PollDisplay;
};

export type PollRuntime = {
  running: boolean;
  roundId: string;
  red: number;
  green: number;
  leader: PollOption | null;
  overrideId: string | null;
  overrideColor: string | null;
};

export function defaultPollDisplay(): PollDisplay {
  return {
    x: 80, y: 80, w: 520, h: 180, scale: 1, opacity: 1,
    showQuestion: true, showCounts: true, showPct: true, showTotal: true, showLeader: true,
    layout: "horizontal", fontSize: 22, textColor: "#f4e4b0",
    redAccent: "#e23a3a", greenAccent: "#2fbf5a",
    bg: "#120c08", bgOpacity: 0.72,
    border: true, borderW: 2, radius: 12, pad: 16, align: "center"
  };
}

export function defaultPollConfig(): PollConfig {
  return {
    question: "Which color?",
    redLabel: "RED", greenLabel: "GREEN",
    redEffectId: "", greenEffectId: "",
    redColor: "#e23a3a", greenColor: "#2fbf5a",
    reaction: "live", tie: "keep", onEnd: "restore",
    allowChange: false, transitionMs: 250,
    display: defaultPollDisplay()
  };
}

export function defaultPollRuntime(): PollRuntime {
  return { running: false, roundId: newRound(), red: 0, green: 0, leader: null, overrideId: null, overrideColor: null };
}

export function newRound() {
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function effectIndex(project: { regions: { label?: string; kind: string; effects: { id: string; kind: string }[] }[] }) {
  const list: { id: string; label: string }[] = [];
  for (const r of project.regions) {
    for (const e of r.effects) list.push({ id: e.id, label: `${e.kind} — ${r.label || r.kind}` });
  }
  return list;
}

export function mappingMissing(cfg: PollConfig, ids: Set<string>) {
  return {
    red: !!(cfg.redEffectId && !ids.has(cfg.redEffectId)),
    green: !!(cfg.greenEffectId && !ids.has(cfg.greenEffectId))
  };
}

export function applyVote(
  rt: PollRuntime,
  cfg: PollConfig,
  votes: Map<string, PollOption>,
  viewerId: string,
  option: PollOption
): { rt: PollRuntime; votes: Map<string, PollOption>; accepted: boolean } {
  if (!rt.running) return { rt, votes, accepted: false };
  const prev = votes.get(viewerId);
  if (prev && !cfg.allowChange) return { rt, votes, accepted: false };
  const next = new Map(votes);
  let red = rt.red, green = rt.green;
  if (prev === option) return { rt, votes, accepted: true };
  if (prev === "red") red = Math.max(0, red - 1);
  if (prev === "green") green = Math.max(0, green - 1);
  if (option === "red") red += 1; else green += 1;
  next.set(viewerId, option);
  const nrt = resolveLeader({ ...rt, red, green }, cfg);
  return { rt: nrt, votes: next, accepted: true };
}

export function resolveLeader(rt: PollRuntime, cfg: PollConfig): PollRuntime {
  let leader = rt.leader;
  if (rt.red > rt.green) leader = "red";
  else if (rt.green > rt.red) leader = "green";
  else if (cfg.tie === "none") leader = null;
  const live = cfg.reaction === "live" && rt.running;
  if (!live) return { ...rt, leader };
  return applyOverride({ ...rt, leader }, cfg);
}

export function applyOverride(rt: PollRuntime, cfg: PollConfig): PollRuntime {
  const leader = rt.leader;
  if (!leader) return { ...rt, overrideId: null, overrideColor: null };
  const id = leader === "red" ? cfg.redEffectId : cfg.greenEffectId;
  const color = leader === "red" ? cfg.redColor : cfg.greenColor;
  return { ...rt, overrideId: id || null, overrideColor: id ? color : null };
}

export function clearVotes(rt: PollRuntime, cfg: PollConfig): PollRuntime {
  const next = { ...rt, roundId: newRound(), red: 0, green: 0, leader: cfg.tie === "keep" ? rt.leader : null };
  if (cfg.reaction === "live") return applyOverride(next, cfg);
  return { ...next, overrideId: null, overrideColor: null };
}

export function restoreEffects(rt: PollRuntime): PollRuntime {
  return { ...rt, overrideId: null, overrideColor: null, leader: null };
}

export function endPoll(rt: PollRuntime, cfg: PollConfig): PollRuntime {
  const stopped = { ...rt, running: false };
  if (cfg.reaction === "winnerEnd" || cfg.onEnd === "hold") {
    let leader = stopped.leader;
    if (stopped.red > stopped.green) leader = "red";
    else if (stopped.green > stopped.red) leader = "green";
    else if (cfg.tie === "none") leader = null;
    const withL = { ...stopped, leader };
    return cfg.onEnd === "restore" && cfg.reaction !== "winnerEnd" ? restoreEffects(withL) : applyOverride(withL, cfg);
  }
  if (cfg.onEnd === "hold") return applyOverride(stopped, cfg);
  return restoreEffects(stopped);
}

export function startPoll(rt: PollRuntime, cfg: PollConfig): PollRuntime {
  const next = { ...rt, running: true, roundId: rt.red || rt.green ? rt.roundId : newRound() };
  return cfg.reaction === "live" ? resolveLeader(next, cfg) : next;
}

export function resetPoll(cfg: PollConfig): { rt: PollRuntime; votes: Map<string, PollOption> } {
  return { rt: defaultPollRuntime(), votes: new Map() };
}

export function persistablePoll(cfg: PollConfig): PollConfig {
  return JSON.parse(JSON.stringify(cfg));
}
