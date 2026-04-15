// api/emersus/thread-title.js
//
// POST /api/emersus/thread-title
// Body: { question: string, answer: string }
// Returns: { title: string }
//
// Cheap one-shot OpenAI call to name a conversation from its first exchange.
// The client invokes this once per thread, right after the first assistant
// reply lands, so the sidebar shows a meaningful title instead of the raw
// first user message truncated to 42 chars.
//
// Model defaults to OPENAI_EMERSUS_TITLE_MODEL → OPENAI_EMERSUS_PARSER_MODEL
// → "gpt-5.4-mini" so operators can downshift without touching code.

import OpenAI from "openai";

let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const TITLE_MODEL =
  process.env.OPENAI_EMERSUS_TITLE_MODEL ||
  process.env.OPENAI_EMERSUS_PARSER_MODEL ||
  "gpt-5.4-mini";

const SYSTEM_PROMPT = [
  "You name chat conversations on an evidence-based fitness/nutrition app.",
  "Given a user's opening question and the assistant's first answer, produce a concise title that captures the topic.",
  "",
  "RULES:",
  "- 3 to 6 words. Absolute max 48 characters.",
  "- Plain sentence case. No quotes, no trailing period, no emoji, no markdown.",
  "- Be specific: prefer 'Creatine loading dose' over 'Creatine question'.",
  "- Skip filler ('about', 'how to', 'question on').",
  "- Never answer the question or include advice; emit only the title.",
  "- If the question is vague or small-talk, still name the underlying topic.",
  "",
  "Return ONLY the title text — nothing else.",
].join("\n");

function normalizeTitle(raw) {
  let t = String(raw || "").trim();
  // strip wrapping quotes
  t = t.replace(/^[\s"'`“”‘’]+/, "").replace(/[\s"'`“”‘’]+$/, "");
  // drop trailing punctuation
  t = t.replace(/[.!?]+$/, "").trim();
  // collapse whitespace
  t = t.replace(/\s+/g, " ");
  return t;
}

export default async function threadTitleHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const question = String(req.body?.question || "").trim().slice(0, 500);
  const answer = String(req.body?.answer || "").trim().slice(0, 1500);
  if (!question) {
    return res.status(400).json({ error: "Missing question." });
  }

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: TITLE_MODEL,
      temperature: 0.3,
      max_tokens: 24,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question:\n${question}\n\nAnswer:\n${answer || "(no answer available)"}`,
        },
      ],
    });

    const title = normalizeTitle(completion?.choices?.[0]?.message?.content);
    if (!title || title.length > 64) {
      return res.json({ title: "" });
    }
    return res.json({ title: title.length > 48 ? title.slice(0, 47).trim() + "…" : title });
  } catch (err) {
    console.error("thread-title handler error", err);
    // Silent failure — client keeps the auto-derived title.
    return res.json({ title: "" });
  }
}
