// scripts/fulltext-enrichment/lib/tei-parser.js
//
// Regex-based TEI XML parser for Grobid output. Produces the same shape
// as jats-parser: { text, sections: [{title, type, text}] }.

const DROP_TAGS_RE = /<(listBibl|figure|table|formula|ref|graphic|note)\b[\s\S]*?<\/\1>/gi;

function decodeEntities(text) {
  if (typeof text !== "string" || !text.length) return "";
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(text) { return String(text).replace(/<[^>]+>/g, " "); }
function clean(text) { return decodeEntities(stripTags(text)).replace(/ /g, " ").replace(/\s+/g, " ").trim(); }

function classify(title, typeAttr) {
  const f = (typeAttr || "").toLowerCase();
  if (f) {
    if (f.includes("intro") || f.includes("backgr")) return "body_intro";
    if (f.includes("method") || f.includes("materials")) return "body_methods";
    if (f.includes("result")) return "body_results";
    if (f.includes("discuss")) return "body_discussion";
    if (f.includes("conclu")) return "body_conclusion";
  }
  const t = (title || "").toLowerCase().trim();
  if (/^introduction\b|^background\b/.test(t)) return "body_intro";
  if (/^method|^materials and methods|^study (population|design)|^participants\b|^procedure\b/.test(t)) return "body_methods";
  if (/^result/.test(t)) return "body_results";
  if (/^discussion/.test(t)) return "body_discussion";
  if (/^conclusion|^summary\b/.test(t)) return "body_conclusion";
  return "body_other";
}

function extractTeiBody(xml) {
  // Grobid TEI: <TEI>/<text>/<body>
  const m = xml.match(/<text\b[^>]*>[\s\S]*?<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : null;
}

// Walk <div> elements (top-level inside body), extract @type + <head> + <p>
function topLevelDivs(xml) {
  const out = [];
  let i = 0;
  while (i < xml.length) {
    const open = xml.indexOf("<div", i);
    if (open === -1) break;
    const openEnd = xml.indexOf(">", open);
    if (openEnd === -1) break;
    const openTag = xml.slice(open, openEnd + 1);
    let depth = 1;
    let j = openEnd + 1;
    while (j < xml.length && depth > 0) {
      const nOpen = xml.indexOf("<div", j);
      const nClose = xml.indexOf("</div", j);
      if (nClose === -1) break;
      if (nOpen !== -1 && nOpen < nClose) {
        depth++;
        const no = xml.indexOf(">", nOpen);
        j = no === -1 ? nClose + 5 : no + 1;
      } else {
        depth--;
        const ne = xml.indexOf(">", nClose);
        j = ne === -1 ? nClose + 6 : ne + 1;
      }
    }
    const inner = xml.slice(openEnd + 1, j - "</div>".length);
    const typeMatch = openTag.match(/\stype\s*=\s*["']([^"']+)["']/i);
    const type = typeMatch ? typeMatch[1] : "";
    out.push({ inner, type });
    i = j;
  }
  return out;
}

function flattenDiv({ inner, type }, inheritedTitle) {
  const headMatch = inner.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const thisTitle = headMatch ? clean(headMatch[1]) : "";
  const fullTitle = inheritedTitle ? (thisTitle ? `${inheritedTitle} / ${thisTitle}` : inheritedTitle) : thisTitle;
  const minusChildDivs = inner.replace(/<div\b[\s\S]*?<\/div>/gi, "");
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const paragraphs = [];
  let m;
  while ((m = pRe.exec(minusChildDivs)) !== null) {
    const body = m[1].replace(DROP_TAGS_RE, " ");
    const txt = clean(body);
    if (txt.length >= 20) paragraphs.push(txt);
  }
  const out = [];
  if (paragraphs.length) {
    out.push({
      title: fullTitle,
      type: classify(fullTitle, type),
      text: paragraphs.join("\n"),
    });
  }
  for (const child of topLevelDivs(inner)) out.push(...flattenDiv(child, fullTitle));
  return out;
}

/**
 * @param {string} xml — raw TEI XML from Grobid
 * @returns {null | { text, sections: [{title, type, text}] }}
 */
export function parseTeiFullText(xml) {
  if (!xml || typeof xml !== "string") return null;
  const body = extractTeiBody(xml);
  if (!body) return null;
  const cleaned = body.replace(DROP_TAGS_RE, " ");
  const divs = topLevelDivs(cleaned);
  const sections = [];
  for (const d of divs) sections.push(...flattenDiv(d, ""));
  const kept = sections.filter((s) => s.text && s.text.length >= 80);
  if (!kept.length) return null;
  const text = kept.map((s) => (s.title ? `${s.title}\n${s.text}` : s.text)).join("\n\n");
  return { text, sections: kept };
}
