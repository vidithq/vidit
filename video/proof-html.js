// Reads of a proof body, which the API serves as a sanitized HTML string.

const LINE_TAGS = new Set(["br", "p", "h2", "h3", "li", "blockquote", "pre", "hr", "ul", "ol"]);
// The server's sanitizer (html5ever) escapes text with these four entities only.
const ENTITIES = { amp: "&", lt: "<", gt: ">", nbsp: "\u00A0" };

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

// An approximate projection of `htmlText` in frontend/src/lib/proof.tsx, enough for the
// recorders; none of its callers needs exact parity.
function proofText(html) {
  if (!html) return "";
  return stripTags(html)
    .replace(/&(amp|lt|gt|nbsp);/g, (_, name) => ENTITIES[name])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function proofImageCount(html) {
  return html ? (html.match(/<img\b[^>]*\ssrc=/gi) || []).length : 0;
}

module.exports = { proofText, proofImageCount, proofHasImage: (html) => proofImageCount(html) > 0 };
