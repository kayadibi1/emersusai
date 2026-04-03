module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ message: "Method not allowed." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const workflowId = process.env.OPENAI_WORKFLOW_ID;

    if (!apiKey || !workflowId) {
      return res.status(500).json({
        message: "Missing OPENAI_API_KEY or OPENAI_WORKFLOW_ID.",
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const rawUserId = typeof body.userId === "string" ? body.userId.trim() : "";

    if (!rawUserId) {
      return res.status(400).json({ message: "A stable userId is required." });
    }

    const userId = rawUserId.slice(0, 128);

    const response = await fetch("https://api.openai.com/v1/chatkit/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "chatkit_beta=v1",
      },
      body: JSON.stringify({
        workflow: { id: workflowId },
        user: userId,
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.client_secret) {
      return res.status(response.status || 500).json({
        message:
          payload?.error?.message ||
          payload?.message ||
          "Unable to create ChatKit session.",
      });
    }

    return res.status(200).json({
      client_secret: payload.client_secret,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to create ChatKit session.",
    });
  }
};
