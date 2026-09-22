export const LANGUAGE_DETECTION_SCHEMA_VERSION = 1;

const VIETNAMESE_MARKS =
  /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/iu;
const VIETNAMESE_WORDS =
  /\b(?:cho\s+thuê|căn\s+hộ|phòng|giá|nhà|tháng|địa\s+chỉ)\b/giu;
const ENGLISH_WORDS =
  /\b(?:apartment|available|bedroom|contact|deposit|for\s+rent|house|month|price|room)\b/giu;
const RUSSIAN_WORDS =
  /\b(?:аренд|квартир|комнат|спальн|цена|депозит|месяц|контакт|сда[её]т)\p{L}*/giu;

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

export function detectListingLanguage(value = '') {
  const text = String(value).normalize('NFC');
  const scores = {
    en: count(text, ENGLISH_WORDS),
    ru: count(text, RUSSIAN_WORDS) + (/[А-ЯЁа-яё]/u.test(text) ? 2 : 0),
    vi: count(text, VIETNAMESE_WORDS) + (VIETNAMESE_MARKS.test(text) ? 2 : 0),
  };
  const [language, score] = Object.entries(scores).sort(
    ([leftLanguage, left], [rightLanguage, right]) =>
      right - left || leftLanguage.localeCompare(rightLanguage)
  )[0];
  const total = Object.values(scores).reduce((sum, value_) => sum + value_, 0);
  if (score === 0) {
    return {
      confidence: 0,
      language: 'unknown',
      method: 'reviewed-keyword-script-v1',
      schemaVersion: LANGUAGE_DETECTION_SCHEMA_VERSION,
    };
  }
  return {
    confidence: score / total,
    language,
    method: 'reviewed-keyword-script-v1',
    schemaVersion: LANGUAGE_DETECTION_SCHEMA_VERSION,
  };
}
