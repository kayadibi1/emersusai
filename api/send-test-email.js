import { Resend } from "resend";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  if (!apiKey) {
    return res.status(500).json({
      message:
        "Missing RESEND_API_KEY. Replace re_xxxxxxxxx with your real API key in your environment variables.",
    });
  }

  const resend = new Resend(apiKey);

  try {
    const data = await resend.emails.send({
      from,
      to: "sidarvig@gmail.com",
      subject: "Hello World",
      html: "<p>Congrats on sending your <strong>first email</strong>!</p>",
    });

    return res.status(200).json({
      message: "Test email sent.",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to send test email.",
    });
  }
}
