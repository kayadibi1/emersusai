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

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    return res.status(200).json({ message: "You are on the list." });
  }

  const errorText = await response.text();

  if (response.status === 409) {
    return res.status(409).json({ message: "This email is already on the waitlist." });
  }

  console.error("Supabase waitlist insert failed:", errorText);
  return res.status(500).json({ message: "Unable to save your signup right now." });
};
