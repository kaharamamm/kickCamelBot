export type ChatLang = "tr" | "en" | "other";

const TR_WORD =
  /\b(miyim|misin|mısın|musun|müsün|neden|niye|nasıl|nasil|niçin|merhaba|selam|kanka|abi|abla|lan|çok|degil|değil|evet|hayır|hayir|ben|sen|senin|benim|gibi|biz|bu|şu|ne|nedir|hava|yağmur|yagmur|sıcak|sicak|soğuk|soguk|teşekkür|tesekkur|lütfen|lutfen|kral|yayın|yayin|anan[ıi]|sikerim|sikeyim|siktir|yav[sş]ak|orospu|amk|amq|gerizekal[ıi]|salak|aptal|pi[cç]|sakin|cevap|ver|burada|varm[ıi][sş]|kim|ol|bak|hadi|tamam|yok|var|bir|bi|dur|gel|git)\b/i;

const lastLang = new Map<number, ChatLang>();

export function detectLang(text: string, userId?: number): ChatLang {
  const sample = text.replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ").trim();
  const compact = sample.replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
  const shortCall = compact.length < 14 || /^(camel|camelbot|bot|kral[ıi]m)\b/i.test(compact);
  if (userId && shortCall && lastLang.has(userId)) return lastLang.get(userId)!;
  let guessed: ChatLang = "en";
  if (!sample) guessed = lastLang.get(userId ?? 0) ?? "en";
  else if (/[\u0600-\u06FF\u3040-\u30ff\u3400-\u9fff\u0400-\u04FF\u0900-\u097F\u0E00-\u0E7F]/.test(sample)) guessed = "other";
  else if (/[ğüşöçıİĞÜŞÖÇ]/.test(sample) || TR_WORD.test(sample)) guessed = "tr";
  else if (/[A-Za-z]/.test(sample)) guessed = "en";
  else guessed = "other";
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
