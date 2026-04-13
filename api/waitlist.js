import { randomUUID } from "node:crypto";
import {
  createWaitlistVerificationToken,
  getPublicBaseUrl,
  getWaitlistVerificationSecret,
} from "./lib/waitlist-verification.js";
import {
  getResendTemplateId,
  sendResendEmail,
} from "./lib/resend-mail.js";
import {
  getTurnstileConfig,
  isTurnstileEnabled,
  verifyTurnstileToken,
} from "./lib/turnstile.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escape HTML entities to prevent XSS in email clients. */
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

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ message: "Method not allowed." });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const verificationSecret = getWaitlistVerificationSecret();
  const turnstileToken = String(req.body?.turnstileToken || "").trim();
  const { secretKey: turnstileSecretKey } = getTurnstileConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      message: "Server is missing Supabase environment variables.",
    });
  }

  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
  const name = req.body?.name ? String(req.body.name).trim().slice(0, 255) : null;
  const surname = req.body?.surname ? String(req.body.surname).trim().slice(0, 255) : null;
  const company = req.body?.company ? String(req.body.company).trim().slice(0, 255) : null;
  const source = String(req.body?.source || "landing-page").trim().slice(0, 100);
  const pageUrl = req.body?.page_url ? String(req.body.page_url).trim().slice(0, 2000) : null;
  const referrer = req.body?.referrer ? String(req.body.referrer).trim().slice(0, 2000) : null;
  const userAgent = req.headers["user-agent"]
    ? String(req.headers["user-agent"]).slice(0, 500)
    : null;
  const honeypot = req.body?.website ? String(req.body.website).trim() : "";

  if (honeypot) {
    return res.status(200).json({ message: "Check your inbox to confirm your waitlist spot." });
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: "Please provide a valid email." });
  }

  if (!process.env.RESEND_API_KEY || !verificationSecret) {
    return res.status(500).json({
      message: "Waitlist email verification is not configured yet.",
    });
  }

  if (isTurnstileEnabled()) {
    if (!turnstileToken) {
      return res.status(400).json({ message: "Complete the CAPTCHA to continue." });
    }

    try {
      const turnstileResult = await verifyTurnstileToken({
        token: turnstileToken,
        secretKey: turnstileSecretKey,
        remoteIp: req.ip || req.socket?.remoteAddress || "",
        idempotencyKey: randomUUID(),
      });

      if (!turnstileResult?.success) {
        return res.status(400).json({
          message: "CAPTCHA verification failed. Please try again.",
        });
      }
    } catch (error) {
      console.error("[waitlist] turnstile verification failed:", error);
      return res.status(500).json({
        message: "We couldn't verify the CAPTCHA right now. Please try again.",
      });
    }
  }

  const existingResponse = await fetch(
    `${supabaseUrl}/rest/v1/waitlist_signups?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!existingResponse.ok) {
    const errorText = await existingResponse.text();
    console.error("Supabase waitlist lookup failed:", errorText);
    return res.status(500).json({ message: "Unable to save your signup right now." });
  }

  const existingRows = await existingResponse.json();

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    return res.status(409).json({ message: "This email is already on the waitlist." });
  }

  const token = createWaitlistVerificationToken(
    {
      name,
      surname,
      company,
      email,
      source,
      pageUrl,
      referrer,
      userAgent,
    },
    verificationSecret
  );
  const baseUrl = getPublicBaseUrl(req);
  const confirmUrl = `${baseUrl}/api/waitlist/confirm?token=${encodeURIComponent(token)}`;
  const displayName =
    [name, surname].filter(Boolean).join(" ").trim() || "there";
  const waitlistTemplateId = getResendTemplateId("WAITLIST_CONFIRM");

  try {
    await sendResendEmail({
      from: resendFromEmail,
      to: email,
      subject: "Confirm your Emersus waitlist signup",
      templateId: waitlistTemplateId,
      templateVariables: {
        display_name: displayName,
        email,
        confirm_url: confirmUrl,
        expires_in: "3 days",
      },
      html: createEmailShell({
        eyebrow: "Emersus Waitlist",
        title: "Confirm your email to join.",
        body: `
          <p style="margin:0 0 16px;">Hi ${esc(displayName)},</p>
          <p style="margin:0 0 16px;">Someone requested early access to Emersus with this email address.</p>
          <p style="margin:0 0 24px;">To confirm your waitlist spot, click the button below. We only add confirmed addresses to the waitlist.</p>
          <div style="margin:0 0 24px;">
            <a href="${esc(confirmUrl)}" style="display:inline-block; padding:14px 22px; background:#9ffb00; color:#090b0e; text-decoration:none; font-weight:700; text-transform:uppercase; letter-spacing:0.12em;">
              Confirm waitlist signup
            </a>
          </div>
          <p style="margin:0 0 16px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="margin:0; word-break:break-all; color:#f9f9fd;">${esc(confirmUrl)}</p>
        `,
        footer: "This confirmation link expires in 3 days.",
      }),
    });
  } catch (error) {
    console.error("Resend waitlist verification email failed:", error);
    return res.status(500).json({
      message:
        "We couldn't send the confirmation email right now. Please try again.",
    });
  }

  return res.status(200).json({
    message: "Check your inbox to confirm your waitlist spot.",
  });
}
