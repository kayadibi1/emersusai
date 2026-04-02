const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      message: "Server is missing Supabase environment variables.",
    });
  }

  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const category = String(req.body?.category || "").trim();
  const message = String(req.body?.message || "").trim();
  const pageUrl = req.body?.page_url ? String(req.body.page_url).trim() : null;
  const userAgent = req.headers["user-agent"] || null;

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
    return res.status(200).json({
      message: "Message received. We will get back to you soon.",
    });
  }

  const errorText = await response.text();
  console.error("Supabase contact insert failed:", errorText);

  return res.status(500).json({
    message: "Unable to send your message right now.",
  });
};
