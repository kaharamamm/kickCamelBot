/**
 * Static Kick emote catalog.
 * Moods follow Plutchik’s 8 basics (used by most AI agent emotion systems)
 * plus a few Kick-chat vibes (laugh / love / cool / confused).
 *
 * Plutchik core: happy(joy), trust, fear, surprise, sad, disgust, angry, anticipation
 * Compounds / chat: love, laugh(amused), cool, confused, hype, dance
 */
export type CatalogMood =
  | "happy"
  | "laugh"
  | "sad"
  | "angry"
  | "fear"
  | "surprise"
  | "disgust"
  | "trust"
  | "anticipation"
  | "hype"
  | "dance"
  | "love"
  | "cool"
  | "confused"
  | "neutral";

export type CatalogEmote = {
  id: number;
  name: string;
  mood: CatalogMood;
};

export const KICK_EMOTE_CATALOG: CatalogEmote[] = [
  { id: 3753119, name: "asmonSmash", mood: "angry" },
  { id: 5380971, name: "AURAPULSE", mood: "hype" },
  { id: 5756662, name: "AYAYA", mood: "happy" },
  { id: 5882722, name: "BANG", mood: "surprise" },
  { id: 4147910, name: "BBoomer", mood: "hype" },
  { id: 39251, name: "beeBobble", mood: "dance" },
  { id: 37217, name: "Bwop", mood: "sad" },
  { id: 5756614, name: "CaptFail", mood: "disgust" },
  { id: 4148144, name: "catblobDance", mood: "dance" },
  { id: 4147900, name: "catKISS", mood: "love" },
  { id: 37218, name: "Clap", mood: "happy" },
  { id: 5756616, name: "DanceDance", mood: "dance" },
  { id: 5756666, name: "DonoWall", mood: "neutral" },
  { id: 4147914, name: "duckPls", mood: "dance" },
  { id: 3645850, name: "EDDIE", mood: "neutral" },
  { id: 39265, name: "EDMusiC", mood: "dance" },
  { id: 5756668, name: "EZ", mood: "cool" },
  { id: 5756511, name: "FLASHBANG", mood: "surprise" },
  { id: 39402, name: "Flowie", mood: "love" },
  { id: 37243, name: "gachiGASM", mood: "neutral" },
  { id: 5756671, name: "GIGACHAD", mood: "cool" },
  { id: 4055795, name: "GnomeDisco", mood: "hype" },
  { id: 4148076, name: "HaHaa", mood: "laugh" },
  { id: 5273247, name: "highCortisol", mood: "fear" },
  { id: 4148074, name: "HYPERCLAP", mood: "hype" },
  { id: 5452913, name: "JudgeJackson", mood: "confused" },
  { id: 4147902, name: "KEKBye", mood: "neutral" },
  { id: 37225, name: "KEKLEO", mood: "laugh" },
  { id: 37226, name: "KEKW", mood: "laugh" },
  { id: 5470844, name: "kickclassic", mood: "neutral" },
  { id: 5339426, name: "kickDrops", mood: "hype" },
  { id: 5756621, name: "kkHuh", mood: "confused" },
  { id: 5273243, name: "lowCortisol", mood: "cool" },
  { id: 37227, name: "LULW", mood: "laugh" },
  { id: 4148128, name: "mericCat", mood: "sad" },
  { id: 5756381, name: "modCheck", mood: "confused" },
  { id: 5273241, name: "MOGGED", mood: "cool" },
  { id: 5756628, name: "MuteD", mood: "neutral" },
  { id: 5756504, name: "NODDERS", mood: "trust" },
  { id: 5756602, name: "NugTime", mood: "neutral" },
  { id: 4055796, name: "ODAJAM", mood: "dance" },
  { id: 37229, name: "OOOO", mood: "hype" },
  { id: 5756623, name: "OuttaPocket", mood: "disgust" },
  { id: 4147892, name: "PatrickBoo", mood: "disgust" },
  { id: 37232, name: "PeepoClap", mood: "happy" },
  { id: 37245, name: "peepoDJ", mood: "dance" },
  { id: 5756675, name: "peepoRiot", mood: "angry" },
  { id: 37233, name: "PogU", mood: "hype" },
  { id: 37230, name: "POLICE", mood: "neutral" },
  { id: 5756627, name: "politeCat", mood: "neutral" },
  { id: 4147888, name: "ppJedi", mood: "dance" },
  { id: 37234, name: "Prayge", mood: "trust" },
  { id: 5756644, name: "ratJAM", mood: "dance" },
  { id: 4148081, name: "Sadge", mood: "sad" },
  { id: 5756676, name: "SenpaiWhoo", mood: "hype" },
  { id: 5380973, name: "shoulderRoll", mood: "dance" },
  { id: 5755651, name: "SIT", mood: "neutral" },
  { id: 5756632, name: "SUSSY", mood: "neutral" },
  { id: 37236, name: "ThisIsFine", mood: "fear" },
  { id: 5756677, name: "TriKool", mood: "cool" },
  { id: 3645849, name: "TRUEING", mood: "trust" },
  { id: 4147884, name: "vibePls", mood: "dance" },
  { id: 5756678, name: "WeirdChamp", mood: "disgust" },
  { id: 5756680, name: "WeSmart", mood: "cool" },
  { id: 1730752, name: "emojiAngel", mood: "trust" },
  { id: 1730753, name: "emojiAngry", mood: "angry" },
  { id: 1579033, name: "emojiAstonished", mood: "surprise" },
  { id: 1730754, name: "emojiAwake", mood: "happy" },
  { id: 1579036, name: "emojiBlowKiss", mood: "love" },
  { id: 1730755, name: "emojiBubbly", mood: "happy" },
  { id: 1730756, name: "emojiCheerful", mood: "happy" },
  { id: 1730758, name: "emojiClown", mood: "laugh" },
  { id: 1730759, name: "emojiCool", mood: "cool" },
  { id: 1730760, name: "emojiCrave", mood: "love" },
  { id: 1730761, name: "emojiCry", mood: "sad" },
  { id: 1579040, name: "emojiCrying", mood: "sad" },
  { id: 1730762, name: "emojiCurious", mood: "confused" },
  { id: 1730765, name: "emojiCute", mood: "happy" },
  { id: 1730767, name: "emojiDead", mood: "fear" },
  { id: 1730768, name: "emojiDevil", mood: "laugh" },
  { id: 1579041, name: "emojiDisappoint", mood: "sad" },
  { id: 1579042, name: "emojiDisguise", mood: "neutral" },
  { id: 1730769, name: "emojiDJ", mood: "dance" },
  { id: 1730770, name: "emojiDown", mood: "sad" },
  { id: 1579044, name: "emojiEnraged", mood: "angry" },
  { id: 1579045, name: "emojiExcited", mood: "hype" },
  { id: 1579054, name: "emojiEyeRoll", mood: "disgust" },
  { id: 1730772, name: "emojiFire", mood: "hype" },
  { id: 1730774, name: "emojiGamer", mood: "cool" },
  { id: 1730775, name: "emojiGlass", mood: "cool" },
  { id: 1730776, name: "emojiGoofy", mood: "neutral" },
  { id: 1730782, name: "emojiGramps", mood: "neutral" },
  { id: 1579046, name: "emojiGrimacing", mood: "fear" },
  { id: 1730785, name: "emojiGrin", mood: "happy" },
  { id: 1730786, name: "emojiGrumpy", mood: "neutral" },
  { id: 1730787, name: "emojiHappy", mood: "happy" },
  { id: 1579047, name: "emojiHeartEyes", mood: "love" },
  { id: 1730788, name: "emojiHmm", mood: "confused" },
  { id: 4200908, name: "emojiHydrate", mood: "neutral" },
  { id: 1730789, name: "emojiKing", mood: "cool" },
  { id: 1730790, name: "emojiKiss", mood: "love" },
  { id: 1730791, name: "emojiLady", mood: "neutral" },
  { id: 1579050, name: "emojiLaughing", mood: "laugh" },
  { id: 1730792, name: "emojiLoading", mood: "confused" },
  { id: 1730794, name: "emojiLol", mood: "laugh" },
  { id: 1730796, name: "emojiMan", mood: "neutral" },
  { id: 1579051, name: "emojiMoneyEyes", mood: "hype" },
  { id: 1730798, name: "emojiNo", mood: "neutral" },
  { id: 1730799, name: "emojiOof", mood: "neutral" },
  { id: 1730800, name: "emojiOooh", mood: "surprise" },
  { id: 1730802, name: "emojiOuch", mood: "neutral" },
  { id: 1579052, name: "emojiPleading", mood: "neutral" },
  { id: 1730803, name: "emojiRich", mood: "hype" },
  { id: 1730807, name: "emojiShocked", mood: "surprise" },
  { id: 1730825, name: "emojiSleep", mood: "neutral" },
  { id: 1730827, name: "emojiSmart", mood: "neutral" },
  { id: 1579055, name: "emojiSmerking", mood: "neutral" },
  { id: 1579057, name: "emojiSmiling", mood: "happy" },
  { id: 1730829, name: "emojiSorry", mood: "sad" },
  { id: 1730830, name: "emojiStare", mood: "anticipation" },
  { id: 1579058, name: "emojiStarEyes", mood: "love" },
  { id: 1579059, name: "emojiSwearing", mood: "angry" },
  { id: 1579061, name: "emojiUnamused", mood: "disgust" },
  { id: 1579062, name: "emojiVomiting", mood: "disgust" },
  { id: 1730831, name: "emojiWink", mood: "cool" },
  { id: 1579038, name: "emojiXEyes", mood: "fear" },
  { id: 1730834, name: "emojiYay", mood: "happy" },
  { id: 1730835, name: "emojiYes", mood: "trust" },
  { id: 1730839, name: "emojiYuh", mood: "cool" },
  { id: 1730840, name: "emojiYum", mood: "happy" },
];
