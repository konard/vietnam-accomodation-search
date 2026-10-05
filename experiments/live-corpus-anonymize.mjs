// Replaces contacts, links, handles, and names in live listing text before
// it is written to the reviewed corpus or compared with it.
const ENTITIES = { '&amp;': '&', '&gt;': '>', '&lt;': '<', '&quot;': '"' };

// Web cards carry the poster in labelled fields; every other occurrence of
// those values is removed as well.
function cardPeople(value) {
  return [...String(value).matchAll(/^(?:author|contact):\s*(.+)$/gimu)]
    .map(([, name]) => name.trim())
    .filter((name) => name.length > 2 && !name.startsWith('['));
}

export function anonymize(value) {
  let text = String(value)
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(?:amp|gt|lt|quot);/gu, (entity) => ENTITIES[entity]);
  for (const name of cardPeople(text)) {
    text = text.split(name).join('[NAME]');
  }
  return (
    text
      .replace(/https?:\/\/\S+|(?:www\.|t\.me\/)\S+/giu, '[URL]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/gu, '[EMAIL]')
      .replace(/@[A-Za-z]\w{3,}/gu, '[TELEGRAM_HANDLE]')
      .replace(/((?:line|微信|wechat)\s*[:：]\s*)[\w.-]{3,}/giu, '$1[CONTACT]')
      .replace(
        /(?<![\d.,])(?:\+|00)\d{1,3}(?:[\s.\-()]*\d){7,12}(?![\d.,])/gu,
        '[PHONE]'
      )
      .replace(/(?<![\d.,])0\d{2,3}(?:[\s.-]*\d){6,8}(?![\d.,])/gu, '[PHONE]')
      .replace(
        /((?<!\p{L})(?:liên\s*hệ|lh|zalo|whatsapp|viber|контакт\p{L}*|пишите|звоните|contact|author|người\s*đăng)\s*[:：]?\s*)(?!\[)[^\n\d[]{2,40}/giu,
        '$1[CONTACT]'
      )
      .replace(/[一-鿿]姐/gu, '[NAME]')
      // A name next to a phone or messenger contact: "[PHONE] Дмитрий.",
      // "1️⃣ Cẩm — Zalo", or a name alone on the line above the contact.
      .replace(
        /((?:\[PHONE\]|📞)[ \t]*(?:[—–|-][ \t]*)?)\p{Lu}\p{Ll}+/gu,
        '$1[NAME]'
      )
      .replace(/(\[PHONE\][ \t]*\n)\p{Lu}\p{Ll}+[ \t]*$/gmu, '$1[NAME]')
      .replace(/\p{Lu}\p{Ll}+(?=[ \t]*[|—–-][ \t]*\[PHONE\])/gu, '[NAME]')
      .replace(/(©[^\n]*?\.[ \t]*)\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+/gu, '$1[NAME]')
      .replace(
        /\p{Lu}\p{Ll}+(?=[ \t]*[—–-][ \t]*(?:Zalo|WhatsApp|Telegram))/gu,
        '[NAME]'
      )
      .replace(
        /^\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)?[ \t.]*$(?=\n[^\n]*(?:\[PHONE\]|\[CONTACT\]|📞))/gmu,
        '[NAME]'
      )
  );
}
