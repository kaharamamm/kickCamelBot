import { generateRaw } from "./ai.js";

const BLOCKED = [
  /\bearrape\b/i,
  /\bnsfw\b/i,
  /\bporn\b/i,
  /\bonlyfans\b/i,
  /\bxxx\b/i,
  /\b10 hours?\b/i,
  /\bscream(ing)? compilation\b/i,
  /\bloud warning\b/i,
];

export async function checkSongSafety(title: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length < 2) return { ok: false, reason: "Give me a song name. Example: !sr Never Gonna Give You Up" };
  if (BLOCKED.some((re) => re.test(clean))) {
    return { ok: false, reason: "That request isn't safe to play here. Try a normal song." };
  }

  const raw = await generateRaw(
    [
      `Song request: ${clean}`,
      'Is this safe to play on a public Kick stream? Reject explicit sexual tracks, hate, slurs, earrape/troll noise, or anything that would get the streamer in trouble.',
      'Normal pop/rock/rap/game OSTs are OK even if a little edgy.',
      'Return JSON only: {"safe":true} or {"safe":false,"reason":"short reason"}',
    ].join("\n"),
    "You output JSON only. Be strict on troll/NSFW, lenient on normal music.",
  );
  const parsed = parse(raw);
  if (!parsed) return { ok: true };
  if (!parsed.safe) {
    return { ok: false, reason: parsed.reason || "That request isn't safe to play here." };
  }
  return { ok: true };
}

function parse(raw: string | null): { safe: boolean; reason?: string } | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]) as { safe?: boolean; reason?: string };
    if (typeof json.safe !== "boolean") return null;
    return { safe: json.safe, reason: json.reason };
  } catch {
    return null;
  }
}
