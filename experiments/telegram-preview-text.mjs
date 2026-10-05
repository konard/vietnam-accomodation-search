// Text of a t.me/s/ preview message body. Tags are stripped until none is
// left, so a tag split by another ("<scr<b>ipt>") cannot survive, and the
// entities are decoded after that, with "&amp;" last.
export function previewText(html) {
  let text = html.replace(/<br\s*\/?>/giu, '\n');
  for (let previous; previous !== text;) {
    previous = text;
    text = text.replace(/<[^<>]*>/gu, '');
  }
  return text
    .replace(/&nbsp;/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&#(\d+);/gu, (_entity, code) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&amp;/gu, '&')
    .trim();
}
