import { renderEmail } from "../shell.js";
import { renderSourceRow, esc } from "../components.js";
import { T } from "../tokens.js";

const GRADE_LABEL = {
  high:         "HIGH",
  moderate:     "MODERATE",
  limited:      "LIMITED",
  insufficient: "INSUFFICIENT",
};

export function renderResearchNewPaper({ user, topic, paper, readUrl, reason, unsubscribeUrl }) {
  const grade = GRADE_LABEL[String(paper.grade || "").toLowerCase()] || "GRADED";
  const meta = `${paper.journal} · ${paper.year} · ${grade}`;
  const body = `
    <p style="margin:0 0 14px;">A new paper matching <strong style="color:${T.ink};">${esc(topic)}</strong> just landed in your follow list.</p>
    ${renderSourceRow({ index: 1, title: paper.title, meta, href: `https://doi.org/${paper.doi}` })}
    <p style="margin:14px 0 4px; color:${T.muted}; font-size:14px; line-height:1.6;">${esc(paper.abstract)}</p>
    <p style="margin:8px 0 0; color:${T.dim}; font-size:12px; font-family:${T.stack.mono}; letter-spacing:0.12em; text-transform:uppercase;">${esc(reason)}</p>
  `;
  return renderEmail({
    preheader: `New paper on ${topic}: ${paper.title.slice(0, 60)}…`,
    eyebrow: "Research",
    title: "New paper in your follow list.",
    body,
    cta: { label: "Read on Emersus →", href: readUrl },
    footer: { toEmail: user.email },
    marketing: true,
    unsubscribeUrl,
  });
}
