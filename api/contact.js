import { Resend } from "resend";

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
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const contactNotificationEmail = process.env.CONTACT_NOTIFICATION_EMAIL || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      message: "Server is missing Supabase environment variables.",
    });
  }

  const name = String(req.body?.name || "").trim().slice(0, 255);
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
  const category = String(req.body?.category || "").trim().slice(0, 100);
  const message = String(req.body?.message || "").trim().slice(0, 3000);
  const pageUrl = req.body?.page_url ? String(req.body.page_url).trim().slice(0, 2000) : null;
  const userAgent = req.headers["user-agent"]
    ? String(req.headers["user-agent"]).slice(0, 500)
    : null;

  if (!name || !email || !category || !message || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      message: "Please provide a name, valid email, category, and message.",
    });
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/contact_messages`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      name,
      email,
      category,
      message,
      page_url: pageUrl,
      user_agent: userAgent,
    }),
  });

  if (response.ok) {
    if (!resendApiKey || !contactNotificationEmail) {
      console.error("Contact notification email is not configured.");
      return res.status(500).json({
        message:
          "Your message was saved, but the email notification is not configured yet.",
      });
    }

    const resend = new Resend(resendApiKey);

    try {
      await resend.emails.send({
        from: resendFromEmail,
        to: contactNotificationEmail,
        replyTo: email,
        subject: `New Emersus contact submission: ${esc(category)}`,
        html: createEmailShell({
          eyebrow: "Contact Alert",
          title: "New contact submission",
          body: `
            <div style="display:grid; gap:12px; margin-bottom:20px;">
              <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Name</div>
                <div style="font-size:16px; color:#f9f9fd;">${esc(name)}</div>
              </div>
              <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Email</div>
                <div style="font-size:16px; color:#f9f9fd;">${esc(email)}</div>
              </div>
              <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Category</div>
                <div style="font-size:16px; color:#f9f9fd;">${esc(category)}</div>
              </div>
              <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Page URL</div>
                <div style="font-size:16px; color:#f9f9fd;">${esc(pageUrl || "Not provided")}</div>
              </div>
            </div>
            <div style="padding:20px 22px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:10px;">Message</div>
              <div style="font-size:16px; color:#f9f9fd;">${esc(message).replace(/\n/g, "<br>")}</div>
            </div>
          `,
          footer: "Reply directly to this email to respond to the sender.",
        }),
      });
    } catch (error) {
      console.error("Resend contact notification failed:", error);
      return res.status(500).json({
        message:
          "Your message was saved, but the notification email failed to send.",
      });
    }

    return res.status(200).json({
      message: "Message received. We will get back to you soon.",
    });
  }

  const errorText = await response.text();
  console.error("Supabase contact insert failed:", errorText);

  return res.status(500).json({
    message: "Unable to send your message right now.",
  });
}
