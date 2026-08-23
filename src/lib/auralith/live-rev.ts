/** Incoming image revision should replace the displayed pixels. */
export function shouldReplaceImage(incomingRev: number, currentRev: number): boolean {
  return incomingRev > currentRev;
}

/** HTTP/blob image must never clobber a newer live editor snapshot. */
export function preferHttpImage(httpRev: number, liveRev: number, hasLivePixels: boolean): boolean {
  if (hasLivePixels && httpRev <= liveRev) return false;
  return httpRev > liveRev;
}
