/** Incoming image revision should replace the displayed pixels. */
export function shouldReplaceImage(incomingRev: number, currentRev: number): boolean {
  return incomingRev > currentRev;
}
