export function parseTimerMinutes(preset: unknown, custom: unknown): number | null {
  const p = String(preset ?? "none").toLowerCase();
  if (p === "none" || p === "" || p === "off") return null;
  if (p === "5") return 5;
  if (p === "15") return 15;
  const n = Math.floor(Number(custom ?? p));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(180, n);
}

export function timerPreset(minutes: number | null | undefined): "none" | "5" | "15" | "custom" {
  if (!minutes || minutes < 1) return "none";
  if (minutes === 5) return "5";
  if (minutes === 15) return "15";
  return "custom";
}
