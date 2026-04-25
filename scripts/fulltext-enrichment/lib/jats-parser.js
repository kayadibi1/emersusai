// scripts/fulltext-enrichment/lib/jats-parser.js
//
// Regex-based JATS XML parser for EuropePMC fullTextXML. Mirrors the
// dependency-free style of scripts/lib/pubmed-xml.js.
//
// Extracts sections from <article>/<body>/<sec>. Drops xref, fig,
// table-wrap, graphic, formula subtrees. Returns:
//   { text, sections: [{title, type, text}] }
// or null when the XML has no body / no usable sections.

const DROP_TAG_RE = /<(xref|fig|table-wrap|graphic|disp-formula|inline-formula|ref-list|back|front)\b[\s\S]*?<\/\1>/gi;

function decodeEntities(text) {
  if (typeof text !== "string" || !text.length) return "";
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(text) {
  return String(text).replace(/<[^>]+>/g, " ");
}

function clean(text) {
  return decodeEntities(stripTags(text))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(title, secType) {
  const sf = (secType || "").toLowerCase();
  if (sf) {
    if (sf.includes("intro") || sf.includes("backgr")) return "body_intro";
    if (sf.includes("method") || sf.includes("materials")) return "body_methods";
    if (sf.includes("result")) return "body_results";
    if (sf.includes("discuss")) return "body_discussion";
    if (sf.includes("conclu")) return "body_conclusion";
  }
  const t = (title || "").toLowerCase().trim();
  if (!t) return "body_other";
  if (/^introduction\b|^background\b/.test(t)) return "body_intro";
  if (/^method|^materials and methods|^study (population|design)|^participants\b|^procedure\b/.test(t)) return "body_methods";
  if (/^result/.test(t)) return "body_results";
  if (/^discussion/.test(t)) return "body_discussion";
  if (/^conclusion|^summary\b/.test(t)) return "body_conclusion";
  return "body_other";
}

function extractBody(xml) {
  // Grab <body>…</body>, attribute-tolerant. JATS has exactly one <body> in article.
  const m = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : null;
}

// Extract all TOP-LEVEL <sec> elements inside a given XML substring.
// We walk char-by-char to correctly match nested <sec>.
function topLevelSections(xml) {
  const out = [];
  let i = 0;
  while (i < xml.length) {
    const openIdx = xml.indexOf("<sec", i);
    if (openIdx === -1) break;
    // Find the end of the opening tag
    const openEnd = xml.indexOf(">", openIdx);
    if (openEnd === -1) break;
    const openTag = xml.slice(openIdx, openEnd + 1);
    // Match until corresponding </sec> (accounting for nested <sec>).
    let depth = 1;
    let j = openEnd + 1;
    while (j < xml.length && depth > 0) {
      const nextOpen = xml.indexOf("<sec", j);
      const nextClose = xml.indexOf("</sec", j);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        const no = xml.indexOf(">", nextOpen);
        j = no === -1 ? nextClose + 5 : no + 1;
      } else {
        depth--;
        const ne = xml.indexOf(">", nextClose);
        j = ne === -1 ? nextClose + 6 : ne + 1;
      }
    }
    const inner = xml.slice(openEnd + 1, j - "</sec>".length);
    // Parse @sec-type attribute from openTag
    const secTypeMatch = openTag.match(/\ssec-type\s*=\s*["']([^"']+)["']/i);
    const secType = secTypeMatch ? secTypeMatch[1] : "";
    out.push({ inner, secType });
    i = j;
  }
  return out;
}

// Recursively flatten: each top-level <sec> with nested <sec> children
// becomes multiple "leaf" sections. We keep the top-level title + type
// in front of each leaf's paragraphs so context isn't lost.
function flattenSection({ inner, secType }, inheritedTitle) {
  const titleMatch = inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const thisTitle = titleMatch ? clean(titleMatch[1]) : "";
  const fullTitle = inheritedTitle ? (thisTitle ? `${inheritedTitle} / ${thisTitle}` : inheritedTitle) : thisTitle;

  // Strip nested secs from inner so we only grab this level's paragraphs
  const minusSecs = inner.replace(/<sec\b[\s\S]*?<\/sec>/gi, "");
  const paragraphs = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(minusSecs)) !== null) {
    const body = m[1].replace(DROP_TAG_RE, " ");
    const txt = clean(body);
    if (txt.length >= 20) paragraphs.push(txt);
  }

  const out = [];
  if (paragraphs.length) {
    out.push({
      title: fullTitle,
      type: classify(fullTitle, secType),
      text: paragraphs.join("\n"),
    });
  }
  // Recurse into children
  for (const child of topLevelSections(inner)) {
    out.push(...flattenSection(child, fullTitle));
  }
  return out;
}

/**
 * @param {string} xml — raw EuropePMC fullTextXML
 * @returns {null | { text: string, sections: Array<{title: string, type: string, text: string}> }}
 */
export function parseJatsFullText(xml) {
  if (!xml || typeof xml !== "string") return null;
  // Remove <back>/<front>/<ref-list> before body extraction — we don't want
  // them polluting if the file happens to be malformed.
  const scrubbed = xml.replace(/<(front|back)\b[\s\S]*?<\/\1>/gi, "");
  const body = extractBody(scrubbed);
  if (!body) return null;

  // Drop noise subtrees from the body content BEFORE section walk.
  const cleanBody = body.replace(DROP_TAG_RE, " ");

  const topSecs = topLevelSections(cleanBody);
  const sections = [];
  for (const s of topSecs) sections.push(...flattenSection(s, ""));

  // Some papers (often editorials, brief commentaries) put paragraphs
  // directly inside <body> without <sec> wrappers. Catch those too.
  if (!sections.length || sections.every((s) => s.text.length < 200)) {
    const bodyMinusSecs = cleanBody.replace(/<sec\b[\s\S]*?<\/sec>/gi, "");
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    const looseParas = [];
    let m;
    while ((m = pRe.exec(bodyMinusSecs)) !== null) {
      const txt = clean(m[1].replace(DROP_TAG_RE, " "));
      if (txt.length >= 30) looseParas.push(txt);
    }
    if (looseParas.length) {
      sections.push({
        title: "",
        type: "body_other",
        text: looseParas.join("\n"),
      });
    }
  }

  const kept = sections.filter((s) => s.text && s.text.length >= 80);
  if (!kept.length) return null;

  const text = kept.map((s) => (s.title ? `${s.title}\n${s.text}` : s.text)).join("\n\n");
  return { text, sections: kept };
}
