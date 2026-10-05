import { isWhatsAppSensitiveTopic } from "./safety.js";

/** Build a Pollinations image URL (same backend as Kick !draw). */
export function buildDrawImageUrl(prompt: string): string {
  const clipped = prompt.replace(/\s+/g, " ").trim().slice(0, 180);
  const seed = Date.now() % 99999;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(clipped)}?nologo=true&width=1024&height=1024&seed=${seed}`;
}

/**
 * Detect a draw/çiz request on WhatsApp.
 * Returns the prompt, or null if this isn't an image request.
 * Supports bot first/last and Turkish verb-final: "bot keller çiz", "kel adam çiz bot".
 */
export function parseWhatsAppDrawRequest(content: string): string | null {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return null;

  const bot = String.raw`(?:[@]?\s*)?(?:camel\s*bot|camelbot|camel|bots?(?:u|lar|um)?)`;
  const drawVerb = String.raw`(?:çiz|ciz|draw|image|resim(?:\s*(?:çiz|ciz|yap))?)`;

  const patterns: RegExp[] = [
    // "bot çiz …" / "CamelBot draw …"
    new RegExp(`^${bot}\\s+${drawVerb}\\s+(.+)$`, "i"),
    // "bot keller çiz" / "bot uçan deve çiz" (verb last — common in Turkish)
    new RegExp(`^${bot}\\s+(.+?)\\s+${drawVerb}$`, "i"),
    // "kel adam çiz bot" / "bald man draw bot" (bot last — very common)
    new RegExp(`^(.+?)\\s+${drawVerb}\\s+${bot}$`, "i"),
    // "kel adam bot çiz"
    new RegExp(`^(.+?)\\s+${bot}\\s+${drawVerb}$`, "i"),
    // "çiz kel adam bot"
    new RegExp(`^${drawVerb}\\s+(.+?)\\s+${bot}$`, "i"),
    // "!draw …" / "!çiz …"
    /^!(?:draw|image|drawimage|çiz|ciz)\s+(.+)$/i,
    // "çiz …" / "draw me a …"
    /^(?:çiz|ciz|draw)\s+(?:me\s+|bana\s+)?(?:a\s+|an\s+|bir\s+)?(.+)$/i,
    // "bana keller çiz" / "keller çiz"
    /^bana\s+(.+?)\s+(?:çiz|ciz|draw)$/i,
    /^(.+?)\s+(?:çiz|ciz)$/i,
    /^(?:resim|görsel|gorsel)\s+(?:çiz|ciz|yap)\s+(.+)$/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    let prompt = m?.[1]?.trim() ?? "";
    // Strip leftover draw/bot words if any
    prompt = prompt
      .replace(/^(?:[@]?\s*)?(?:camel\s*bot|camelbot|camel|bots?(?:u|lar|um)?)\s+/i, "")
      .replace(/\s+(?:[@]?\s*)?(?:camel\s*bot|camelbot|camel|bots?(?:u|lar|um)?)$/i, "")
      .replace(/^(?:çiz|ciz|draw|image|resim)\s+/i, "")
      .replace(/\s+(?:çiz|ciz|draw|image|resim)$/i, "")
      .trim();
    if (
      prompt.length >= 2 &&
      !/^(?:bot|camel|camelbot|lütfen|lutfen|pls|please|bunu|şunu|sunu|onu|nasıl|nasil|ne|what|how)$/i.test(prompt)
    ) {
      return prompt.slice(0, 180);
    }
  }
  return null;
}

export type DrawResult =
  | { ok: true; prompt: string; buffer: Buffer; mime: string }
  | { ok: false; error: string };

/** Generate image bytes for WhatsApp send. */
export async function generateWhatsAppImage(prompt: string): Promise<DrawResult> {
  const clipped = prompt.replace(/\s+/g, " ").trim().slice(0, 180);
  if (clipped.length < 3) {
    return { ok: false, error: "Prompt too short — say what to draw." };
  }
  if (isWhatsAppSensitiveTopic(clipped)) {
    return {
      ok: false,
      error: "That topic is off-limits for images here. Pick something normal — food, animals, nonsense.",
    };
  }

  const url = buildDrawImageUrl(clipped);
  try {
    const res = await fetch(url, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      return { ok: false, error: `Image service failed (${res.status}). Try again.` };
    }
    const ctype = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
    if (!ctype.startsWith("image/")) {
      return { ok: false, error: "Image service returned non-image data." };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 500) {
      return { ok: false, error: "Image came back empty. Try a different prompt." };
    }
    return { ok: true, prompt: clipped, buffer, mime: ctype };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /abort|timeout/i.test(msg) ? "Image took too long. Try again." : `Draw failed: ${msg}` };
  }
}
