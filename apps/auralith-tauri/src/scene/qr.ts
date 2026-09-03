import QRCode from "qrcode";

const FG = "#000000";
const BG = "#FFFFFF";

export async function qrDataUrl(text: string, cssPx = 480): Promise<string> {
  const payload = String(text || "").trim();
  if (!payload) return "";
  const dpr = typeof window !== "undefined" ? Math.max(1, Math.min(3, window.devicePixelRatio || 1)) : 1;
  const width = Math.round(cssPx * dpr);
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "Q",
    margin: 4,
    width,
    color: { dark: FG, light: BG },
    type: "image/png"
  });
}
