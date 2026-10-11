// Reads of a proof body, which the API serves as a sanitized HTML string.

const LINE_TAGS = new Set(["br", "p", "h2", "h3", "li", "blockquote", "pre", "hr", "ul", "ol"]);
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntity(match, body) {
  if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

// Drops every tag in one scan (a block tag or <br> becomes a newline), so no nested
// or split markup can survive into the text.
function stripTags(html) {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open === -1) return out + html.slice(i);
    out += html.slice(i, open);
    const close = html.indexOf(">", open);
    if (close === -1) return out;
    const name = /^\/?([a-z0-9]+)/i.exec(html.slice(open + 1, close));
    if (name && LINE_TAGS.has(name[1].toLowerCase())) out += "\n";
    i = close + 1;
  }
  return out;
}

// Mirrors `htmlText` in frontend/src/lib/proof.tsx; change both.
function proofText(html) {
  if (!html) return "";
  return stripTags(html)
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replaceAll("\uFFFC", "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function proofImageCount(html) {
  return html ? (html.match(/<img\b[^>]*\ssrc=/gi) || []).length : 0;
}

module.exports = { proofText, proofImageCount, proofHasImage: (html) => proofImageCount(html) > 0 };
