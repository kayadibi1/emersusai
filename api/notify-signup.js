// api/notify-signup.js
// Client-invoked hook that sends an admin notification email when a new
// account is created. Called from shared/auth-pages.js right after a
// successful supabase.auth.signUp() or OAuth callback.
//
// Security: the client can fire this with any email, so we validate
// server-side by hitting Supabase auth admin API (service-role) to
// confirm the user actually exists and was created recently (< 5min).
// This keeps spoofed pings from flooding the operator inbox.
//
// Non-blocking: if Supabase lookup or Resend send fails, we return 200
// anyway so the signup UX isn't tied to alert delivery. Errors are
// logged to stderr for debugging.

import {
  getResendTemplateId,
  sendResendEmail,
} from "./lib/resend-mail.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECENT_SIGNUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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

/**
 * Look up a user by email via Supabase auth admin API. Returns the
 * user row if found, null otherwise. Uses service-role token.
 */
async function findAuthUser({ supabaseUrl, serviceRoleKey, email }) {
  // Supabase admin API: GET /auth/v1/admin/users?email=... (exact match)
  const url = `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`supabase admin users lookup failed: ${response.status} ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  // Response shape: { users: [ { id, email, created_at, ... } ] }
  const users = Array.isArray(data?.users) ? data.users : [];
  return users.find(u => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendFromEmail =
    process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const notificationEmail =
    process.env.SIGNUP_NOTIFICATION_EMAIL ||
    process.env.CONTACT_NOTIFICATION_EMAIL ||
    "";

  // Basic request validation
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 320);
  const provider = String(req.body?.provider || "email").trim().slice(0, 20);
  const fullName = req.body?.full_name ? String(req.body.full_name).trim().slice(0, 255) : null;

  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "Invalid email." });
  }

  // Non-fatal config check — if anything is missing, we log and 200 so the
  // signup UX isn't blocked. The operator will only discover this via the
  // server logs, which is acceptable for an internal notification.
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[notify-signup] Missing Supabase env vars — skipping notify");
    return res.status(200).json({ notified: false, reason: "supabase_not_configured" });
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("[notify-signup] Missing RESEND_API_KEY — skipping notify");
    return res.status(200).json({ notified: false, reason: "resend_not_configured" });
  }
  if (!notificationEmail) {
    console.error("[notify-signup] Missing SIGNUP_NOTIFICATION_EMAIL / CONTACT_NOTIFICATION_EMAIL — skipping notify");
    return res.status(200).json({ notified: false, reason: "recipient_not_configured" });
  }

  // Verify the user actually exists and was created recently (anti-spoof guard)
  let user;
  try {
    user = await findAuthUser({ supabaseUrl, serviceRoleKey, email });
  } catch (err) {
    console.error("[notify-signup] supabase lookup failed:", err.message);
    return res.status(200).json({ notified: false, reason: "lookup_failed" });
  }
  if (!user) {
    // User doesn't exist yet — could be a race with Supabase replication,
    // could be spoofed. Either way, don't notify.
    console.error(`[notify-signup] user not found for email=${email} — skipping`);
    return res.status(200).json({ notified: false, reason: "user_not_found" });
  }

  const createdAt = user.created_at ? new Date(user.created_at) : null;
  const ageMs = createdAt ? Date.now() - createdAt.getTime() : Infinity;
  if (ageMs > RECENT_SIGNUP_WINDOW_MS) {
    // User exists but was created more than 5 minutes ago — not a fresh
    // signup, probably a duplicate ping. Don't notify.
    console.error(`[notify-signup] user email=${email} is stale (age=${Math.round(ageMs / 1000)}s) — skipping`);
    return res.status(200).json({ notified: false, reason: "not_recent" });
  }

  // Send the notification via Resend
  const displayName = fullName || user.user_metadata?.full_name || "(not provided)";
  const confirmed = user.email_confirmed_at ? "yes" : "pending confirmation";
  const signupTemplateId = getResendTemplateId("SIGNUP_ALERT");

  try {
    await sendResendEmail({
      from: resendFromEmail,
      to: notificationEmail,
      replyTo: email,
      subject: `[Emersus] New signup: ${esc(email)}`,
      templateId: signupTemplateId,
      templateVariables: {
        email,
        full_name: displayName,
        provider,
        email_confirmed: confirmed,
        user_id: user.id,
        created_at: user.created_at,
      },
      html: createEmailShell({
        eyebrow: "Signup Alert",
        title: "New account created",
        body: `
          <div style="display:grid; gap:12px;">
            <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Email</div>
              <div style="font-size:16px; color:#f9f9fd;">${esc(email)}</div>
            </div>
            <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Name</div>
              <div style="font-size:16px; color:#f9f9fd;">${esc(displayName)}</div>
            </div>
            <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Provider</div>
              <div style="font-size:16px; color:#f9f9fd;">${esc(provider)}</div>
            </div>
            <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Email confirmed</div>
              <div style="font-size:16px; color:#f9f9fd;">${esc(confirmed)}</div>
            </div>
            <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Supabase user id</div>
              <div style="font-size:13px; color:#f9f9fd; font-family:ui-monospace,monospace;">${esc(user.id)}</div>
            </div>
            <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Created at</div>
              <div style="font-size:16px; color:#f9f9fd;">${esc(user.created_at)}</div>
            </div>
          </div>
        `,
        footer: "Reply directly to this email to reach the user.",
      }),
    });
  } catch (err) {
    console.error("[notify-signup] Resend send failed:", err.message);
    return res.status(200).json({ notified: false, reason: "send_failed" });
  }

  return res.status(200).json({ notified: true });
}
