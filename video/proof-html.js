// Reads of a proof body, which the API serves as a sanitized HTML string.

const LINE_BREAKS = /<(?:br|\/?(?:p|h2|h3|li|blockquote|pre|hr|ul|ol))\b[^>]*>/gi;
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntity(match, body) {
  if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

// Mirrors `htmlText` in frontend/src/lib/proof.tsx; change both.
function proofText(html) {
  if (!html) return "";
  return html
    .replace(LINE_BREAKS, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replaceAll("￼", "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function proofImageCount(html) {
  return html ? (html.match(/<img\b[^>]*\ssrc=/gi) || []).length : 0;
}

module.exports = { proofText, proofImageCount, proofHasImage: (html) => proofImageCount(html) > 0 };
