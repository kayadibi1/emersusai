import { generateRecommendationStream, parseJsonBody } from './workflow.js';
import {
  buildRequestMeta,
  checkAnonAskRateLimit,
  decrementAnonAskRateLimit,
} from './rate-limit.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(405).json({ message: 'Method not allowed.' });
    }

    const body = parseJsonBody(req);
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return res.status(400).json({ message: 'Question is required.' });
    }

    const rateLimit = checkAnonAskRateLimit(req);
    res.setHeader('X-Anon-Ask-Asked', rateLimit.asked);
    res.setHeader('X-Anon-Ask-Limit', rateLimit.limit);

    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'rate_limit',
        asked: rateLimit.asked,
        limit: rateLimit.limit,
        resetAt: rateLimit.resetAt,
      });
    }

    // Anonymous pipeline input: no user, no thread, no memory.
    // sanitize.js returns empty stableUserId/supabaseUserId for empty userId,
    // and every downstream persistence gate (profile, token log, memory
    // extraction) no-ops when supabaseUserId is empty.
    const pipelineInput = {
      question,
      userId: '',
      threadId: '',
      threadState: {},
      recentMessages: [],
      profile: {},
      requestMeta: buildRequestMeta(req),
    };

    let completed = false;
    const rollbackIfAborted = () => { if (!completed) decrementAnonAskRateLimit(req); };
    res.on('close', rollbackIfAborted);

    try {
      await generateRecommendationStream(pipelineInput, res);
      completed = true;
    } catch (err) {
      if (!res.headersSent) {
        console.error('anon-ask handler error:', err);
        return res.status(500).json({ message: 'Unable to generate a response. Please try again.' });
      }
      // Mid-stream error: generateRecommendationStream writes an error SSE
      // event itself. Leave completed=false so the close handler rolls back.
    }
  } catch (error) {
    if (!res.headersSent) {
      console.error('anon-ask handler outer error:', error);
      return res.status(500).json({ message: 'Unable to generate a response. Please try again.' });
    }
  }
}
