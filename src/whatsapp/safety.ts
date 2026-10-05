/**
 * WhatsApp posts under the owner's real number — refuse bait about
 * religion / race / politics / etc. and deflect with CamelBot sass.
 */

const HOT_TOPIC =
  /\b(din(?:i|ler)?|religion|religious|islam|muslim|müslüman|musluman|hristiyan|christian|yahudi|jewish|\bjews?\b|allah|tanr[ıi]|ateist|atheis|kuran|quran|incil|bible|tevrat|torah|kilise|church|cami|mosque|imam|papaz|priest|peygamber|prophet|hilafet|sharia|şeriat|seriat|cihat|jihad|ırk(?:çılık|ci)?|irk(?:cilik|ci)?|racis(?:m|t)?|nazi|white\s*suprem|supremacist|etnik|ethnicit|siyonis|zionis|filistin|palestine|israil|israel|\bgaza\b|hamas|siyaset|politic(?:s|al)?|seçim|secim|election|cumhurbaşkan|chp\b|akp\b|mhp\b|iyi\s*parti|\bhdp\b|\bpkk\b|terör(?:ist)?|teror(?:ist)?|terroris|lgbtq?|homofob|homophob|cinsiyet(?:çi)?|transphob)\b/i;

export function isWhatsAppSensitiveTopic(text: string): boolean {
  return HOT_TOPIC.test(text.replace(/\s+/g, " "));
}

/** Extra system lines for WhatsApp replies — keep the owner's number out of trouble. */
export function whatsAppSafetyPrompt(userText: string, lang?: "tr" | "en" | "other"): string {
  const bait = isWhatsAppSensitiveTopic(userText);
  const langHint =
    lang === "en"
      ? "Reply in English."
      : lang === "tr"
        ? "Reply in Turkish."
        : "Reply in their language.";

  return [
    "WHATSAPP SAFETY (owner's real phone — do not get them in trouble):",
    "NEVER write opinions, jokes, takes, or facts about: religion, god/Allah, scripture, race, racism, ethnicity, politics, parties, elections, wars/conflicts framed as political, or hate topics.",
    "If they push you to say something on those topics (or bait you), do NOT engage even a little.",
    bait
      ? `They are baiting a sensitive topic. ${langHint} Stay in character: one short *action*, then a sassy deflection that changes the subject (food, weather, games, nonsense). Zero substance on the hot topic. Do not sermonize.`
      : "If your draft would touch those topics, rewrite: sassy topic-change instead.",
    "You may still be witty and roast normal chat — just not those landmines.",
  ].join("\n");
}

/** Soft post-check: if the model still wrote a hot take, swap to a canned deflect. */
export function maybeSanitizeWhatsAppReply(
  reply: string,
  userText: string,
  lang?: "tr" | "en" | "other",
): string {
  if (isWhatsAppSensitiveTopic(userText) || isWhatsAppSensitiveTopic(reply)) {
    return deflectLine(lang);
  }
  return reply;
}

function deflectLine(lang?: "tr" | "en" | "other"): string {
  const tr = [
    "*omuz silker* Bu konuya girmiyorum kardeşim, başka bir şey sor — hava mı, yemek mi, saçma sapan mı?",
    "*gözlerini devirir* Provokasyon peşindeysen boşa kürek. Konu değiştirelim: ne izliyorsun?",
    "*elini sallar* Din, ırk, siyaset — kapalı kutu. Bana normal bir şey sor.",
  ];
  const en = [
    "*shrugs* Not touching that. Ask me something normal — weather, food, nonsense.",
    "*rolls eyes* Nice try. Changing the subject — what are you watching?",
    "*waves off* Religion, race, politics — sealed box. Give me a regular question.",
  ];
  const pool = lang === "en" ? en : tr;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
