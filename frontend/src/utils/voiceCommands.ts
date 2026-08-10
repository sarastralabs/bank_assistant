/** Normalize spoken text for command matching. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const END_PHRASES = [
  "ಮುಗಿಸು",
  "ಮುಗಿದು",
  "ಮುಗಿಸಿ",
  "ನಿಲ್ಲಿಸು",
  "bye",
  "goodbye",
  "good bye",
  "stop",
  "end",
  "finish",
  "thank you bye",
];

const AFFIRM_PHRASES = [
  "ಸರಿ",
  "ಸರಿಯೇ",
  "ಹೌದು",
  "ಒಪ್ಪಿದೆ",
  "ದೃಢೀಕರಿಸಿ",
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
  "correct",
  "confirm",
  "right",
];

const REJECT_PHRASES = [
  "ಮತ್ತೆ",
  "ಮರುಹೇಳಿ",
  "ತಪ್ಪು",
  "ಇಲ್ಲ",
  "no",
  "wrong",
  "again",
  "re record",
  "rerecord",
  "repeat",
];

const SKIP_PHRASES = [
  "ಬಿಟ್ಟುಬಿಡಿ",
  "ಬಿಟ್ಟುಬಿಡು",
  "skip",
  "none",
  "n a",
  "leave it",
  "no need",
];

function includesAny(haystack: string, phrases: string[]): boolean {
  return phrases.some((p) => haystack.includes(norm(p)) || haystack.includes(p));
}

export function isEndSessionCommand(...parts: string[]): boolean {
  const t = norm(parts.filter(Boolean).join(" "));
  if (!t) return false;
  return includesAny(t, END_PHRASES);
}

export function isAffirmCommand(...parts: string[]): boolean {
  const t = norm(parts.filter(Boolean).join(" "));
  if (!t) return false;
  return includesAny(t, AFFIRM_PHRASES);
}

export function isRejectCommand(...parts: string[]): boolean {
  const t = norm(parts.filter(Boolean).join(" "));
  if (!t) return false;
  return includesAny(t, REJECT_PHRASES);
}

export function isSkipCommand(...parts: string[]): boolean {
  const t = norm(parts.filter(Boolean).join(" "));
  if (!t) return false;
  return includesAny(t, SKIP_PHRASES);
}
