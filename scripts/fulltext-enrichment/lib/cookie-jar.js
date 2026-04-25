// scripts/fulltext-enrichment/lib/cookie-jar.js
//
// Minimal cookie jar — loads a Netscape-format cookies.txt, indexes by
// domain, and produces a Cookie header for a given URL.
//
// Scoped: by default only keeps cookies whose domain matches known
// publisher/library/SSO patterns. Everything else (ad trackers, social, etc.)
// is dropped to minimize what we send out.

import fs from "node:fs";
import { URL } from "node:url";

const DEFAULT_ALLOWED = [
  // publishers
  "elsevier.com", "sciencedirect.com", "sciencedirectassets.com", "linkinghub.elsevier.com",
  "wiley.com", "onlinelibrary.wiley.com",
  "springer.com", "springernature.com", "link.springer.com", "nature.com",
  "sagepub.com", "journals.sagepub.com",
  "oup.com", "academic.oup.com", "sams-sigma.com",
  "tandfonline.com", "t-f.sams-sigma.com",
  "rsc.org", "pubs.rsc.org",
  "karger.com", "lww.com", "jamanetwork.com", "nejm.org", "bmj.com", "bmjopen.bmj.com",
  "cambridge.org", "mdpi.com", "apa.org", "ieee.org", "ieeexplore.ieee.org",
  "acs.org", "pubs.acs.org", "thieme-connect.com", "pnas.org",
  "cell.com", "thelancet.com", "plos.org", "journals.plos.org", "frontiersin.org",
  "mdpi.com",
  // SSO + library
  "openathens.net", "shibboleth", "athensams.net", "jhu.edu", "library.jhu.edu",
  "my.openathens.net", "signon.openathens.net", "idp.jhu.edu",
];

function domainMatches(cookieDomain, requestHost) {
  // cookie with leading "." is for *.domain; without it, exact match.
  const norm = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  const rh = requestHost.toLowerCase();
  if (cookieDomain.startsWith(".")) {
    return rh === norm || rh.endsWith("." + norm);
  }
  return rh === norm;
}

function inAllowlist(domain, allowlist) {
  const d = domain.startsWith(".") ? domain.slice(1) : domain;
  return allowlist.some((a) => d === a || d.endsWith("." + a));
}

export function loadCookieJar(path, { allowlist = DEFAULT_ALLOWED } = {}) {
  const text = fs.readFileSync(path, "utf8");
  const cookies = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 7) continue;
    const [domain, _includeSub, pathField, secure, expires, name, value] = fields;
    if (!domain || !name) continue;
    if (!inAllowlist(domain, allowlist)) continue;
    cookies.push({
      domain,
      path: pathField,
      secure: String(secure).toUpperCase() === "TRUE",
      expires: Number(expires) || 0,
      name,
      value,
    });
  }
  return {
    cookies,
    cookieHeaderFor(url) {
      let u;
      try { u = new URL(url); } catch { return null; }
      const host = u.hostname.toLowerCase();
      const isHttps = u.protocol === "https:";
      const now = Math.floor(Date.now() / 1000);
      const matched = cookies.filter((c) => {
        if (c.secure && !isHttps) return false;
        if (c.expires > 0 && c.expires < now) return false;
        if (!domainMatches(c.domain, host)) return false;
        if (c.path && !u.pathname.startsWith(c.path)) return false;
        return true;
      });
      if (!matched.length) return null;
      // Per-cookie name=value joined by "; "
      return matched.map((c) => `${c.name}=${c.value}`).join("; ");
    },
    summary() {
      const byDomain = new Map();
      for (const c of cookies) byDomain.set(c.domain, (byDomain.get(c.domain) || 0) + 1);
      return {
        total: cookies.length,
        domains: [...byDomain.entries()].sort((a, b) => b[1] - a[1]),
      };
    },
  };
}
