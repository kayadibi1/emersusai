const {
  generateRecommendation,
  parseJsonBody,
  validateRequest,
} = require("./workflow");

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

    const body = validateRequest(parseJsonBody(req));
    const recommendation = await generateRecommendation(body);

    return res.status(200).json(recommendation);
  } catch (error) {
    const statusCode = Number(error.statusCode || error.status || 500);

    return res.status(statusCode).json({
      message: error.message || "Unable to generate an Emersus recommendation.",
    });
  }
};
