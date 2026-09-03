export type ChatLang = "tr" | "en" | "other";

/** Strong Turkish vocabulary (folded + original forms matched via fold). */
const TR_LEXICON = new Set(
  [
    "miyim", "misin", "misin", "musun", "musun", "neden", "niye", "nasil", "nicin", "merhaba", "selam",
    "kanka", "abi", "abla", "lan", "cok", "degil", "evet", "hayir", "ben", "sen", "senin", "benim", "bizim",
    "gibi", "biz", "bu", "su", "sunu", "bunu", "onu", "ne", "nedir", "hava", "yagmur", "sicak", "soguk",
    "tesekkur", "lutfen", "kral", "yayin", "sakin", "cevap", "ver", "burada", "var", "yok", "bir", "bi",
    "dur", "gel", "git", "yap", "yapsana", "yapsene", "yapma", "et", "etsene", "bak", "hadi", "tamam",
    "olsun", "olmaz", "olur", "simdi", "sonra", "once", "icin", "kadar", "daha", "bile", "ama", "fakat",
    "cunku", "veya", "ya", "da", "de", "ki", "mi", "mu", "mu", "misin", "misiniz", "musunuz",
    "iyi", "kotu", "guzel", "cirkin", "buyuk", "kucuk", "yeni", "eski", "hizli", "yavas",
    "oyun", "oyunu", "oyunu", "kanal", "kanala", "chati", "chat", "mesaj", "yaz", "yazsana", "soyle",
    "söyle", "der", "sor", "sorsana", "cevir", "degistir", "ac", "kapa", "kapat", "sil", "temizle",
    "atla", "gec", "skip", "klip", "baslik", "kategori", "bana", "sana", "ona", "bizi", "sizi",
    "naber", "nbr", "sa", "slm", "gunaydin", "iyi", "aksamlar", "geceler", "rica", "ederim",
    "anladim", "anlamadim", "bilmiyorum", "biliyorum", "istiyorum", "istemiyorum", "lazim", "gerek",
    "belki", "galiba", "herhalde", "keske", "tabi", "tabii", "aynen", "kesinlikle", "asla",
    "kim", "kime", "nerede", "nereye", "nasil", "hangi", "kac", "neydi", "neyse", "iste",
    "lan", "aq", "amk", "amq", "orospu", "salak", "aptal", "mal", "yarram", "siktir",
  ].map((w) => foldToken(w)),
);

const EN_LEXICON = new Set(
  [
    "the", "a", "an", "and", "or", "but", "if", "then", "so", "because", "as", "of", "to", "for",
    "in", "on", "at", "by", "with", "from", "into", "about", "over", "after", "before", "between",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your",
    "his", "their", "our", "this", "that", "these", "those", "what", "who", "where", "when", "why",
    "how", "which", "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
    "have", "has", "had", "will", "would", "can", "could", "should", "shall", "may", "might", "must",
    "not", "no", "yes", "yeah", "yep", "nah", "ok", "okay", "please", "thanks", "thank", "hello",
    "hi", "hey", "yo", "sup", "good", "bad", "great", "nice", "cool", "just", "only", "also",
    "really", "very", "much", "more", "most", "some", "any", "all", "every", "each", "here", "there",
    "now", "then", "today", "tomorrow", "yesterday", "make", "made", "do", "get", "got", "go", "going",
    "come", "came", "see", "saw", "look", "want", "need", "know", "think", "say", "said", "tell",
    "ask", "give", "take", "put", "let", "keep", "try", "change", "switch", "set", "update", "play",
    "game", "stream", "title", "category", "chat", "message", "bot", "please", "bro", "dude", "man",
    "lol", "lmao", "omg", "wtf", "idk", "imo", "tbh", "bruh", "mate", "guys", "folks",
  ].map((w) => w.toLowerCase()),
);

/** Tokens that are address noise — ignore for language scoring. */
const IGNORE = new Set(
  ["camel", "camelbot", "@camel", "@camelbot", "bot", "bots", "pls", "plz", "please", "kralim"].map((w) =>
    foldToken(w),
  ),
);

const lastLang = new Map<number, ChatLang>();

function foldToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

function tokenize(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}']+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function hasTurkishLetters(word: string): boolean {
  return /[ğüşöçıİĞÜŞÖÇ]/.test(word);
}

/** Common Turkish morphology when typed without special letters. */
function looksTurkishMorphology(folded: string): boolean {
  if (folded.length < 3) return false;
  return (
    /(?:sana|sene|siniz|siniz|yoruz|iyorum|iyorsun|acak|ecek|misin|musun|musun|mıyım|miyim|misiniz|musunuz)$/.test(
      folded,
    ) ||
    /(?:iyor|uyor|uyor|arak|erek|madan|meden|dan|den|lar|ler|nin|nun|nun|nın|lig|lık|lik|luk|cuk|cik)$/.test(
      folded,
    ) ||
    /^(yap|et|ol|bak|gel|git|yaz|sor|de|soyle|cevir|degistir|ac|kapa|sil|atla|gec)/.test(folded)
  );
}

function scoreWord(raw: string): { tr: number; en: number } {
  const folded = foldToken(raw);
  if (!folded || IGNORE.has(folded) || /^\d+$/.test(folded)) return { tr: 0, en: 0 };

  let tr = 0;
  let en = 0;

  if (hasTurkishLetters(raw)) tr += 2;
  if (TR_LEXICON.has(folded)) tr += 2;
  else if (looksTurkishMorphology(folded)) tr += 1;

  if (EN_LEXICON.has(folded)) en += 2;
  else if (/^[a-z]+(?:'[a-z]+)?$/i.test(raw) && !hasTurkishLetters(raw) && folded.length >= 3) {
    // Plain Latin word with no TR signal — weak English lean
    if (!looksTurkishMorphology(folded) && !TR_LEXICON.has(folded)) en += 1;
  }

  return { tr, en };
}

/**
 * Pick reply language by counting Turkish vs English signals across the whole sentence.
 * More Turkish weight → tr; more English → en. Ties keep the user's last language (default tr).
 */
export function detectLang(text: string, userId?: number): ChatLang {
  const sample = text.replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ").trim();
  if (/[\u0600-\u06FF\u3040-\u30ff\u3400-\u9fff\u0400-\u04FF\u0900-\u097F\u0E00-\u0E7F]/.test(sample)) {
    return "other";
  }

  const tokens = tokenize(sample);
  const contentTokens = tokens.filter((t) => !IGNORE.has(foldToken(t)));

  // Very short address-only pings keep prior language ("camel", "bot")
  if (contentTokens.length === 0) {
    return (userId && lastLang.get(userId)) || "tr";
  }

  let trScore = 0;
  let enScore = 0;
  for (const tok of contentTokens) {
    const s = scoreWord(tok);
    trScore += s.tr;
    enScore += s.en;
  }

  let guessed: ChatLang;
  if (trScore === 0 && enScore === 0) {
    // No lexicon hits — use alphabet hints
    if (contentTokens.some(hasTurkishLetters)) guessed = "tr";
    else if (contentTokens.some((t) => /[A-Za-z]/.test(t))) guessed = "en";
    else guessed = (userId && lastLang.get(userId)) || "tr";
  } else if (trScore > enScore) guessed = "tr";
  else if (enScore > trScore) guessed = "en";
  else guessed = (userId && lastLang.get(userId)) || (contentTokens.some(hasTurkishLetters) ? "tr" : "en");

  if (userId && guessed !== "other") lastLang.set(userId, guessed);
  return guessed;
}

export function langInstruction(lang: ChatLang): string {
  if (lang === "tr") return "Reply ONLY in Turkish. Do not switch to English.";
  if (lang === "en") return "Reply ONLY in English. Do not switch to Turkish unless they mixed.";
  return "They did not write Turkish or English.";
}

export function otherLangReply(username: string): string {
  return `@${username} speak English or Turkish. I'm a camel, not Google Translate.`;
}

export function isGreeting(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(selam|selamlar|selamun aleyk[uü]m|aleyk[uü]m selam|merhaba|merhabalar|sa|slm|naber|nabersin|nabersiniz|nasilsin|nasılsın|nasilsiniz|nasılsınız|gunaydin|günaydın|iyi aksamlar|iyi akşamlar|iyi geceler|hello|hi|hey|yo|sup|howdy|what s up|whats up|how are you)\b/.test(
    t,
  );
}
