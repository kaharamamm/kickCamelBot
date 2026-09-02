const recent = new Map<string, number>();

export function thanksOnce(key: string, windowMs = 45_000): boolean {
  const last = recent.get(key) ?? 0;
  if (Date.now() - last < windowMs) return false;
  recent.set(key, Date.now());
  if (recent.size > 400) {
    const cutoff = Date.now() - windowMs;
    for (const [k, at] of recent) {
      if (at < cutoff) recent.delete(k);
    }
  }
  return true;
}
