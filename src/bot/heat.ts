const WINDOW_MS = 8 * 60_000;
const TIMEOUT_COOLDOWN_MS = 20 * 60_000;

type Heat = {
  insults: number;
  warned: boolean;
  lastTimeoutAt: number;
  lastAt: number;
};

const heat = new Map<string, Heat>();

const INSULT =
  /\b(o[cç]|amk|amq|aq\b|siktir|sikik|sikerim|sikeyim|orospu|gerizekal[ıi]|mal\b|salak|aptal|yav[sş]ak|anan[ıi]|pi[cç]|trash bot|useless bot|sik yapamaz|g[ıi]c[ıi]k|k[ıi]r[ıi]k bir ai|amına|amina|göt|got)\b/i;

export function looksLikeBotInsult(text: string): boolean {
  return INSULT.test(text);
}

export function noteHeat(broadcasterUserId: number, userId: number, insulting: boolean): {
  warnNow: boolean;
  timeoutNow: boolean;
} {
  if (!insulting) return { warnNow: false, timeoutNow: false };
  const key = `${broadcasterUserId}:${userId}`;
  const now = Date.now();
  const row = heat.get(key);
  const fresh = !row || now - row.lastAt > WINDOW_MS;
  const next: Heat = fresh
    ? { insults: 1, warned: false, lastTimeoutAt: row?.lastTimeoutAt ?? 0, lastAt: now }
    : { ...row, insults: row.insults + 1, lastAt: now };
  heat.set(key, next);

  if (!next.warned && next.insults >= 2) {
    next.warned = true;
    heat.set(key, next);
    return { warnNow: true, timeoutNow: false };
  }
  if (
    next.warned &&
    next.insults >= 3 &&
    now - next.lastTimeoutAt >= TIMEOUT_COOLDOWN_MS
  ) {
    next.lastTimeoutAt = now;
    next.insults = 0;
    next.warned = false;
    heat.set(key, next);
    return { warnNow: false, timeoutNow: true };
  }
  return { warnNow: false, timeoutNow: false };
}

export function timeoutRoast(username: string, lang: "tr" | "en" | "other"): string {
  if (lang === "tr") return `@${username} 5 saniye. Bak, susturmayı biliyorum.`;
  return `@${username} 5 seconds. See? I know how to shut you up.`;
}

export function ensureWarning(text: string, lang: "tr" | "en" | "other"): string {
  if (/shut you up|sustur|kapat[ıi]r[ıi]m|kestiririm|susacaks[ıi]n|timeout|5 saniye|3 saniye/i.test(text)) {
    return text;
  }
  const extra =
    lang === "tr"
      ? " Dur. Biliyorum nasıl susturulursun, kesersem keserim."
      : " Keep it up and I know how to shut you up.";
  return `${text}${extra}`;
}
