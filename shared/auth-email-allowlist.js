// Client-side proxy — the domain list now lives server-side at
// api/auth/email-allowlist.js so it isn't shipped to every browser.

export async function isAllowedEmailDomain(email) {
  try {
    const res = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return false;
    const { allowed } = await res.json();
    return allowed === true;
  } catch {
    // If the check endpoint is unreachable, allow the signup attempt
    // so Supabase's own validation can catch it.
    return true;
  }
}
