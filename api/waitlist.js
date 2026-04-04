const { Resend } = require("resend");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

module.exports = async function handler(req, res) {
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
  const waitlistNotificationEmail =
    process.env.WAITLIST_NOTIFICATION_EMAIL ||
    process.env.CONTACT_NOTIFICATION_EMAIL ||
    "";

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      message:
        "Server is missing Supabase environment variables.",
    });
  }

  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const name = req.body?.name ? String(req.body.name).trim() : null;
  const surname = req.body?.surname ? String(req.body.surname).trim() : null;
  const company = req.body?.company ? String(req.body.company).trim() : null;
  const source = String(req.body?.source || "landing-page").trim();
  const pageUrl = req.body?.page_url ? String(req.body.page_url).trim() : null;
  const referrer = req.body?.referrer ? String(req.body.referrer).trim() : null;
  const userAgent = req.headers["user-agent"] || null;

  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: "Please provide a valid email." });
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

  const response = await fetch(`${supabaseUrl}/rest/v1/waitlist_signups`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      name,
      surname,
      company,
      email,
      source,
      page_url: pageUrl,
      referrer,
      user_agent: userAgent,
    }),
  });

  if (response.ok) {
    if (!resendApiKey) {
      return res.status(500).json({
        message:
          "Your signup was saved, but waitlist email delivery is not configured yet.",
      });
    }

    const resend = new Resend(resendApiKey);
    const displayName =
      [name, surname].filter(Boolean).join(" ").trim() || "there";

    try {
      await resend.emails.send({
        from: resendFromEmail,
        to: email,
        subject: "You are on the Emersus waitlist",
        html: createEmailShell({
          eyebrow: "Emersus Waitlist",
          title: "You're on the list.",
          body: `
            <p style="margin:0 0 16px;">Hi ${displayName},</p>
            <p style="margin:0 0 16px;">Thanks for joining the Emersus AI waitlist.</p>
            <p style="margin:0 0 24px;">We will reach out as soon as we open the next round of access.</p>
            <div style="margin:0 0 24px; padding:20px 22px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-family:'Space Grotesk',Inter,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:0.24em; text-transform:uppercase; color:#85adff; margin-bottom:12px;">
                What Emersus covers
              </div>
              <ul style="margin:0; padding-left:20px; color:#f9f9fd;">
                <li style="margin-bottom:8px;">hypertrophy planning and workout adaptation</li>
                <li style="margin-bottom:8px;">nutrition and recovery guidance</li>
                <li>mental performance support for focus, studying, and preparation</li>
              </ul>
            </div>
            <p style="margin:0;">We appreciate your interest.</p>
          `,
          footer: "2026 Emersus AI. Optimize or obsolete.",
        }),
      });

      if (waitlistNotificationEmail) {
        await resend.emails.send({
          from: resendFromEmail,
          to: waitlistNotificationEmail,
          replyTo: email,
          subject: "New Emersus waitlist signup",
          html: createEmailShell({
            eyebrow: "Waitlist Alert",
            title: "New waitlist signup",
            body: `
              <div style="display:grid; gap:12px;">
                <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                  <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Email</div>
                  <div style="font-size:16px; color:#f9f9fd;">${email}</div>
                </div>
                <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                  <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Name</div>
                  <div style="font-size:16px; color:#f9f9fd;">${name || "Not provided"} ${surname || ""}</div>
                </div>
                <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                  <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Company</div>
                  <div style="font-size:16px; color:#f9f9fd;">${company || "Not provided"}</div>
                </div>
                <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                  <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Source</div>
                  <div style="font-size:16px; color:#f9f9fd;">${source}</div>
                </div>
                <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                  <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Page URL</div>
                  <div style="font-size:16px; color:#f9f9fd;">${pageUrl || "Not provided"}</div>
                </div>
                <div style="padding:16px 18px; background:#12161b; border:1px solid rgba(255,255,255,0.06);">
                  <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#8f96a0; margin-bottom:6px;">Referrer</div>
                  <div style="font-size:16px; color:#f9f9fd;">${referrer || "Not provided"}</div>
                </div>
              </div>
            `,
            footer: "Incoming lead from emersus.ai",
          }),
        });
      }
    } catch (error) {
      console.error("Resend waitlist email failed:", error);
      return res.status(500).json({
        message:
          "Your signup was saved, but the waitlist confirmation email failed to send.",
      });
    }

    return res.status(200).json({ message: "You are on the list." });
  }

  const errorText = await response.text();

  if (response.status === 409) {
    return res.status(409).json({ message: "This email is already on the waitlist." });
  }

  console.error("Supabase waitlist insert failed:", errorText);
  return res.status(500).json({ message: "Unable to save your signup right now." });
};
