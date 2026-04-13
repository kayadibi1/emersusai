import { Resend } from "resend";
import {
  getWaitlistVerificationSecret,
  verifyWaitlistVerificationToken,
} from "./lib/waitlist-verification.js";

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createEmailShell({ eyebrow, title, body, footer }) {
  return `
    <div style="margin:0; padding:32px 16px; background:#090b0e;">
      <div style="margin:0 auto; max-width:640px; border:1px solid rgba(255,255,255,0.08); background:#0c0e11; color:#f9f9fd; font-family:Inter,Arial,sans-serif;">
        <div style="height:4px; background:linear-gradient(90deg,#6d9fff 0%,#9ffb00 100%);"></div>
        <div style="padding:40px 32px 24px;">
          <div style="font-family:'Space Grotesk',Inter,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.32em; text-transform:uppercase; color:#9ffb00; margin-bottom:18px;">
            ${eyebrow}
          </div>
          <h1 style="margin:0 0 18px; font-family:'Space Grotesk',Inter,Arial,sans-serif; font-size:32px; line-height:1.05; font-weight:800; letter-spacing:-0.04em; text-transform:uppercase; color:#f9f9fd;">
            ${title}
          </h1>
          <div style="font-size:16px; line-height:1.75; color:#c8cdd4;">
            ${body}
          </div>
        </div>
        <div style="padding:24px 32px 32px; border-top:1px solid rgba(255,255,255,0.06); color:#8f96a0; font-size:12px; line-height:1.8; letter-spacing:0.08em; text-transform:uppercase;">
          ${footer}
        </div>
      </div>
    </div>
  `;
}

function renderPage({ title, message, tone = "success" }) {
  const accent = tone === "success" ? "#9ffb00" : "#ff7b7b";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(109,159,255,0.18), transparent 35%),
          linear-gradient(180deg, #06080b 0%, #090b0e 100%);
        color: #f9f9fd;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        padding: 24px;
      }
      main {
        max-width: 640px;
        width: 100%;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(12,14,17,0.96);
        padding: 32px;
        box-sizing: border-box;
      }
      .eyebrow {
        color: ${accent};
        font-size: 12px;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        margin-bottom: 16px;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 32px;
        line-height: 1.1;
      }
      p {
        margin: 0 0 20px;
        color: #c8cdd4;
        line-height: 1.7;
      }
      a {
        color: #f9f9fd;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">${tone === "success" ? "Waitlist Confirmed" : "Waitlist Error"}</div>
      <h1>${esc(title)}</h1>
      <p>${esc(message)}</p>
      <a href="/">Return to emersus.ai</a>
    </main>
  </body>
</html>`;
}

async function upsertWaitlistSignup({ supabaseUrl, serviceRoleKey, payload }) {
  const existingResponse = await fetch(
    `${supabaseUrl}/rest/v1/waitlist_signups?select=id&email=eq.${encodeURIComponent(payload.email)}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!existingResponse.ok) {
    const errorText = await existingResponse.text().catch(() => "(unreadable)");
    throw new Error(`waitlist lookup failed: ${existingResponse.status} ${errorText.slice(0, 200)}`);
  }

  const existingRows = await existingResponse.json();
  if (Array.isArray(existingRows) && existingRows.length > 0) {
    return { created: false, alreadyExists: true };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/waitlist_signups`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(unreadable)");
    throw new Error(`waitlist insert failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  return { created: true, alreadyExists: false };
}

async function sendInternalNotification({
  resendApiKey,
  resendFromEmail,
  waitlistNotificationEmail,
  payload,
}) {
  if (!resendApiKey || !waitlistNotificationEmail) {
    return;
  }

  const resend = new Resend(resendApiKey);
  await resend.emails.send({
    from: resendFromEmail,
    to: waitlistNotificationEmail,
    replyTo: payload.email,
    subject: "New confirmed Emersus waitlist signup",
    html: createEmailShell({
      eyebrow: "Waitlist Alert",
      title: "Confirmed waitlist signup",
      body: `
        <div style="display:grid; gap:12px;">
          <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Email</div>
            <div style="font-size:16px; color:#f9f9fd;">${esc(payload.email)}</div>
          </div>
          <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Name</div>
            <div style="font-size:16px; color:#f9f9fd;">${esc(payload.name || "Not provided")} ${esc(payload.surname || "")}</div>
          </div>
          <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Company</div>
            <div style="font-size:16px; color:#f9f9fd;">${esc(payload.company || "Not provided")}</div>
          </div>
          <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Source</div>
            <div style="font-size:16px; color:#f9f9fd;">${esc(payload.source)}</div>
          </div>
        </div>
      `,
      footer: "Lead confirmed via double opt-in.",
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send(renderPage({
      title: "Invalid request",
      message: "This confirmation link only supports GET requests.",
      tone: "error",
    }));
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const waitlistNotificationEmail =
    process.env.WAITLIST_NOTIFICATION_EMAIL ||
    process.env.CONTACT_NOTIFICATION_EMAIL ||
    "";

  const token = String(req.query?.token || "").trim();
  const secret = getWaitlistVerificationSecret();

  if (!supabaseUrl || !serviceRoleKey || !secret) {
    return res.status(500).send(renderPage({
      title: "Configuration error",
      message: "Waitlist confirmation is temporarily unavailable. Please try again later.",
      tone: "error",
    }));
  }

  let payload;
  try {
    payload = verifyWaitlistVerificationToken(token, secret);
  } catch (error) {
    return res.status(400).send(renderPage({
      title: "Confirmation link invalid",
      message: error.message || "This confirmation link is invalid or expired.",
      tone: "error",
    }));
  }

  try {
    const result = await upsertWaitlistSignup({
      supabaseUrl,
      serviceRoleKey,
      payload: {
        name: payload.name,
        surname: payload.surname,
        company: payload.company,
        email: payload.email,
        source: payload.source,
      },
    });

    if (result.created) {
      await sendInternalNotification({
        resendApiKey,
        resendFromEmail,
        waitlistNotificationEmail,
        payload,
      });
    }

    return res.status(200).send(renderPage({
      title: result.alreadyExists ? "You're already confirmed" : "Your spot is confirmed",
      message: result.alreadyExists
        ? "That email is already on the Emersus waitlist."
        : "Thanks for confirming your email. You're officially on the Emersus waitlist now.",
      tone: "success",
    }));
  } catch (error) {
    console.error("[waitlist-confirm] failed:", error);
    return res.status(500).send(renderPage({
      title: "Confirmation failed",
      message: "We couldn't confirm your waitlist signup right now. Please try again later.",
      tone: "error",
    }));
  }
}
