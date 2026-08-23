import type { Region } from "./types";

const MAX = 80;

export class RegionHistory {
  private past: Region[][] = [];
  private future: Region[][] = [];

  snapshot(regions: Region[]): void {
    this.past.push(cloneRegions(regions));
    if (this.past.length > MAX) this.past.shift();
    this.future.length = 0;
  }

  undo(current: Region[]): Region[] | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(cloneRegions(current));
    return prev;
  }

  redo(current: Region[]): Region[] | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(cloneRegions(current));
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  reset(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}

export function cloneRegions(regions: Region[]): Region[] {
  return regions.map((r) =>
    r.kind === "trace"
      ? { ...r, points: r.points.map((p) => ({ ...p })) }
      : { ...r },
  );
}
