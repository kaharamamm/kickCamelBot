/** Fold Turkish letters so şarkıyı/sarkiyi, geç/gec, vs. all match the same patterns. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

/** Informal Turkish verb tails: geçsene, atlasana, siliver… */
const TAIL = String.raw`(?:sene|sana|iver|ver)?`;

function hit(text: string, re: RegExp): boolean {
  return re.test(fold(text));
}

export function isSkipOrder(text: string): boolean {
  const t = fold(text);
  if (!t || t.length > 180) return false;
  const song = String.raw`(?:sarkiyi|sarki|muzigi|muzik|parcayi|parca|song|track|queue|tune)`;
  const skip = String.raw`(?:atla|gec|skip|next|pass)`;
  const end = String.raw`(?:$|[^a-z0-9])`;
  if (/\bskip(?:\s+(?:this|the|it|pls|please|lutfen|song|track|one))?\b/.test(t)) return true;
  if (new RegExp(`${song}.{0,28}${skip}${TAIL}${end}`).test(t)) return true;
  if (new RegExp(`(?:^|[^a-z0-9])${skip}${TAIL}.{0,28}${song}`).test(t)) return true;
  if (/(?:atlasene|atla\s*sana|gecsene|gec\s*sana|skip\s*(?:pls|please|lutfen))/.test(t)) return true;
  if (/(?:siradaki|sonraki|baska)\s*(?:sarki|song|parca|track)?/.test(t) && /(?:gec|cal|play|atla|skip|bot|camel)/.test(t)) {
    return true;
  }
  if (/(?:bunu|sunu|onu)\s+(?:atla|gec|skip)/.test(t) && /(?:sarki|song|muzik|parca|bot|camel)/.test(t)) return true;
  if (/\bnext\s+(?:song|track|one)\b/.test(t)) return true;
  return false;
}

export function isClearOrder(text: string): boolean {
  const t = fold(text);
  if (!t || t.length > 180) return false;
  const chat = String.raw`(?:chati|chat'i|chat|sohbeti|sohbet)`;
  const wipe = String.raw`(?:sil|temizle|clear|wipe|purge)`;
  const end = String.raw`(?:$|[^a-z0-9])`;
  if (new RegExp(`${chat}.{0,28}${wipe}${TAIL}${end}`).test(t)) return true;
  if (new RegExp(`${wipe}${TAIL}${end}.{0,28}${chat}`).test(t)) return true;
  if (/(?:silsene|silsana|siliver|temizlesene|temizlesana|temizle\s*sene)/.test(t)) return true;
  if (/\bbenim\s+chat/.test(t) && /(?:temizle|sil|clear|wipe|purge)/.test(t)) return true;
  if (/\b(?:temizle|sil|clear|wipe|purge)\b.*(?:chatim|chatimi|sohbetim|sohbetimi)\b/.test(t)) return true;
  if (/\bwipe(?:\s+the)?\s+chat\b/.test(t)) return true;
  return false;
}

export function isRaidOrder(text: string): boolean {
  const t = fold(text);
  if (/(?:raidle|hostla)\b/.test(t)) return true;
  if (/\bbaskin\b/.test(t) && /(?:at|et|yap|ver)/.test(t)) return true;
  if (/\b(?:raid|host)\s+(?:at|et|to)\b/.test(t)) return true;
  if (/\b(?:raid|host)\s+[a-z0-9_]{3,25}\b/.test(t)) return true;
  if (/\b(?:raid|host)\b/.test(t) && /(?:kanal|channel|kick\.com|@[a-z0-9_])/.test(t)) return true;
  return false;
}

export function isEmoteOrder(text: string): boolean {
  const t = fold(text);
  if (!/emote|emoji/.test(t)) return false;
  return /(?:only|mod|mode|sadece|ac|kapat|on|off|al|yap|et|cevir|gec|pulse)/.test(t);
}

export function isSlowOrder(text: string): boolean {
  const t = fold(text);
  if (!/(?:slow|yavas)/.test(t)) return false;
  return /(?:mod|mode|ac|kapat|on|off|al|yap|et|pulse|saniye|sec)/.test(t);
}

export function isFollowOrder(text: string): boolean {
  const t = fold(text);
  return /follow(?:er)?\s*only|sadece\s+takip|takipci\s*only|follower[- ]only/.test(t);
}

export function isSubOrder(text: string): boolean {
  const t = fold(text);
  return /sub(?:scriber)?\s*only|sadece\s+sub|abone\s*only|subscribers?\s+only/.test(t);
}

export function isClipOrder(text: string): boolean {
  const t = fold(text);
  if (!/(?:clip|klip)/.test(t)) return false;
  if (/^(?:clip|klip)\b/.test(t)) return true;
  return /(?:that|this|it|now|please|pls|lutfen|al|at|cek|et|yap|su|bunu|sunu)/.test(t);
}

export function isTitleOrder(text: string): boolean {
  const t = fold(text);
  return (
    /(?:change|set|update|degistir).{0,24}(?:title|baslik)/.test(t) ||
    /(?:title|baslik).{0,60}(?:to|as|yap|olsun|degistir|guncelle|:|=)/.test(t) ||
    /(?:oyle|aynen|tamam|ok).{0,28}(?:yap|degistir|guncelle).{0,20}(?:baslik|title)/.test(t) ||
    /(?:basligi?|title(?:yi)?)\s*(?:degistir|guncelle|yap)\b/.test(t) ||
    /(?:yap|degistir|guncelle)\s+(?:su\s+|o\s+)?(?:basligi?|title)\b/.test(t) ||
    /(?:basligi?|title)\s+.{2,80}\s+(?:yap|olsun)\s*$/.test(t)
  );
}

export function isCategoryOrder(text: string): boolean {
  const t = fold(text);
  return (
    /(?:change|set|update|degistir|cevir|çevir).{0,36}(?:category|kategori|game|\boyun)/.test(t) ||
    /(?:category|kategori|game|\boyun(?:u|umu|unu)?\b).{0,48}(?:to|as|yap|olsun|ye|ya|cevir|çevir|:|=)/.test(t) ||
    /(?:benim|bizim|yayin(?:in)?|stream(?:in)?)\s+(?:oyun(?:u|umu)?|game|kategori(?:yi)?|category).{0,48}(?:cevir|çevir|yap|olsun|degistir)/.test(
      t,
    )
  );
}

export function isOffOrder(text: string): boolean {
  return hit(text, /\b(?:off|kapat|kapa|durdur|disable|bitir)\b/);
}

export function isPinOrder(text: string): boolean {
  const t = fold(text);
  return /(?:sabitle|sabitlesene|sabit\s*le|pin(?:ned)?|pinned)/.test(t);
}

export function isUnpinOrder(text: string): boolean {
  const t = fold(text);
  return /(?:sabitlemeyi?\s*kaldir|sabitlemeyi?\s*kaldır|unpin|pin\s*off|sabiti?\s*kaldir|sabiti?\s*kaldır)/.test(t);
}

export function extractQuoted(text: string): string | null {
  const hit = text.match(/["'“”«»]([^"'“”«»]{3,100})["'“”«»]/);
  return hit?.[1]?.trim() || null;
}

/** Short "ok do it / tamam yap" confirmations — need conversation context to mean anything. */
export function isConfirmApply(text: string): boolean {
  const f = fold(text)
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!f || f.length > 48) return false;
  // Require a do-verb (plain "tamam" alone is too weak — just acknowledgment)
  if (
    /^(?:tamam|ok|okay|aynen|oyle|evet|yes|yep|yeah|sure|alright)\s+(?:onu|bunu|sunu|oyle\s+)?(?:yap|yapsana|yapsene|yapalim|koy|degistir|guncelle|do it|go ahead|apply|set it)$/.test(
      f,
    )
  ) {
    return true;
  }
  if (/^(?:yap|yapsana|yapsene|yapalim|koy|do it|go ahead|apply it|set it)$/.test(f)) return true;
  if (/^(?:aynen|oyle)$/.test(f)) return true;
  return false;
}

export function isWriteIntent(text: string): boolean {
  return hit(
    text,
    /yazar\s*mi|yazsana|yazsene|yaziver|\byaz\b|soylesene|soyle|dersene|der\s*mi|desene|sorsene|sorsana|\bsor\b|\bask\b|\bsay\b|gidip|\bgit\b|katil|join|kanal|channel|sabitle|pin/,
  );
}

export function looksLikeModSlang(text: string): boolean {
  if (fold(text).length > 160) return false;
  return (
    isClearOrder(text) ||
    isSkipOrder(text) ||
    isEmoteOrder(text) ||
    isSlowOrder(text) ||
    isFollowOrder(text) ||
    isSubOrder(text) ||
    isClipOrder(text)
  );
}
