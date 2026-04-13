// Debug-page entry point. Mounts:
//   - <ChatApp> into #debug-chat-root (reuses the production chat UI)
//   - <DebugPanel> into #debug-panel-root (live stage events + final data)
//
// Wired together via a shared React state: ChatApp calls onProgress for
// each SSE frame and onDebugData once the final response lands; the
// DebugPanel reads both and renders. A custom `fetcher` swaps in the
// streaming endpoint with a fallback to the non-streaming one if the
// SSE path errors out.
//
// Access control: requireAdmin() gates the page to ADMIN_EMAILS. Anyone
// else is redirected to /app/ before React mounts, so the debug panel
// never appears for unauthorized users.

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "/shared/react-chat-app.js";
import { getSession, requireAdmin } from "/shared/supabase.js";

const h = React.createElement;

// ---------------------------------------------------------------------------
// Streaming fetcher â€” SSE with automatic fallback
// ---------------------------------------------------------------------------
//
// Returns an object like { data, error? }. On success the `data` field is
// the final /api/emersus/recommendation JSON response (whether it came via
// SSE or the fallback endpoint). On fetch failure both endpoints are
// exhausted and an error is surfaced.
//
// Important: `onProgress` is called for every SSE frame EXCEPT the "final"
// one that carries the full response. The final frame's payload is
// returned via the promise's resolved value. This matches what ChatApp
// expects from its fetcher prop.
function createStreamingFetcher({ onProgress }) {
  return async function streamingFetcher(requestBody) {
    const session = await getSession();
    if (!session?.access_token) {
      throw new Error("Sign in again to use the debug panel.");
    }

    const authHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };

    // Attempt SSE first.
    try {
      const response = await fetch("/api/emersus/recommendation-stream", {
        method: "POST",
        headers: {
          ...authHeaders,
          Accept: "text/event-stream",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // If we get a non-200 BEFORE streaming starts, fall back to the
        // classic endpoint. Server rejected the request somehow â€” maybe
        // rate limit, maybe bad payload. Parse the JSON error for the
        // fallback to re-throw if it also fails.
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `Streaming endpoint returned ${response.status}.`);
      }

      // Parse the SSE stream. Standard frame format is
      //   "data: {json}\n\n"
      // and we only use "message" events (no custom event names), which
      // is the default when no "event:" line precedes the data line.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload = null;
      let sawErrorFrame = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on the frame boundary "\n\n". Leave any trailing partial
        // in the buffer for the next chunk.
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!frame.trim()) continue;

          // A frame may have multiple lines but we only care about the
          // "data:" ones (one per frame is the norm here).
          const dataLines = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());
          if (!dataLines.length) continue;

          let parsed;
          try {
            parsed = JSON.parse(dataLines.join("\n"));
          } catch (_parseError) {
            continue;
          }

          if (parsed.stage === "final") {
            finalPayload = parsed.response || null;
            continue;
          }
          if (parsed.stage === "error") {
            sawErrorFrame = parsed.message || "Streaming pipeline error.";
            continue;
          }
          if (parsed.stage === "complete") {
            // Server signalled clean end-of-stream. We'll exit the
            // read loop on the next .read() returning done=true.
            continue;
          }

          // All other stages are live progress updates â€” forward them
          // to onProgress so the debug panel fills in.
          if (typeof onProgress === "function") {
            try {
              onProgress(parsed);
            } catch (observerError) {
              console.error("onProgress observer threw:", observerError);
            }
          }
        }
      }

      if (sawErrorFrame) throw new Error(sawErrorFrame);
      if (!finalPayload) throw new Error("Streaming endpoint closed without a final frame.");
      return { data: finalPayload };
    } catch (streamError) {
      // Fall back to the non-streaming endpoint. The debug panel will
      // lose the live stage events (that's expected) but we still get
      // the same final response shape with debug.stage_timings filled
      // in by the backend.
      console.warn("SSE streaming failed, falling back to /api/emersus/recommendation:", streamError);
      if (typeof onProgress === "function") {
        try {
          onProgress({ stage: "fallback_engaged", reason: String(streamError.message || streamError) });
        } catch (_) {
          // ignore
        }
      }
      const fallbackResponse = await fetch("/api/emersus/recommendation", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(requestBody),
      });
      const fallbackData = await fallbackResponse.json().catch(() => ({}));
      if (!fallbackResponse.ok) {
        throw new Error(fallbackData.message || "Both streaming and non-streaming endpoints failed.");
      }
      return { data: fallbackData };
    }
  };
}

// ---------------------------------------------------------------------------
// DebugPanel â€” the right-hand inspector
// ---------------------------------------------------------------------------
//
// State model: we keep one "current run" object in React state. The
// `progress` object accumulates the latest payload for each stage seen
// (keyed by stage name, so later events overwrite earlier ones). `data`
// holds the final response when it arrives. The rendering is a
// well-defined cascade: if data is present render the "ready" view,
// otherwise if progress has anything render partial stages, otherwise
// render the empty state.

function DebugPanel({ progress, data, runState }) {
  const finalDebug = data && data.debug ? data.debug : null;
  const stageTimings = useMemo(() => {
    if (finalDebug && finalDebug.stage_timings) return finalDebug.stage_timings;
    // Build a partial timings object from whatever progress events we've
    // seen so far. This is how the panel feels live BEFORE the final
    // frame lands.
    const live = {};
    if (progress.profile_loaded && typeof progress.profile_loaded.at_ms === "number") live.profile_load_ms = progress.profile_loaded.at_ms;
    if (progress.planning_done && typeof progress.planning_done.at_ms === "number") live.planning_at_ms = progress.planning_done.at_ms;
    if (progress.retrieval_done && typeof progress.retrieval_done.at_ms === "number") live.retrieval_at_ms = progress.retrieval_done.at_ms;
    if (progress.prompt_built && typeof progress.prompt_built.at_ms === "number") live.prompt_built_at_ms = progress.prompt_built.at_ms;
    if (progress.synthesis_primary_done && typeof progress.synthesis_primary_done.at_ms === "number") live.synthesis_at_ms = progress.synthesis_primary_done.at_ms;
    return live;
  }, [progress, finalDebug]);

  const evidence = useMemo(() => {
    if (finalDebug && finalDebug.vector_database && Array.isArray(finalDebug.vector_database.evidence)) {
      return finalDebug.vector_database.evidence;
    }
    if (progress.retrieval_done && progress.retrieval_done.vector_database && Array.isArray(progress.retrieval_done.vector_database.evidence)) {
      return progress.retrieval_done.vector_database.evidence;
    }
    return [];
  }, [progress.retrieval_done, finalDebug]);

  const openaiInput = useMemo(() => {
    if (finalDebug && finalDebug.openai_input) return finalDebug.openai_input;
    if (progress.prompt_built && progress.prompt_built.openai_input) return progress.prompt_built.openai_input;
    return null;
  }, [progress.prompt_built, finalDebug]);

  const tokenUsage = (finalDebug && finalDebug.token_usage) || (progress.synthesis_primary_done && progress.synthesis_primary_done.token_usage) || null;
  const rawOutput = (finalDebug && finalDebug.raw_output_text) || (progress.synthesis_primary_done && progress.synthesis_primary_done.raw_output_text) || "";

  // Empty state â€” nothing has happened yet.
  if (!progress || (Object.keys(progress).length === 0 && !data)) {
    return h(
      "div",
      null,
      h(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
        h("h2", null, "Debug panel"),
        h("span", { className: "debug-status", "data-state": runState || "idle" }, runState || "idle")
      ),
      h(
        "p",
        { className: "debug-empty" },
        "Send a chat message. This panel streams the retrieval hits, the exact OpenAI input, stage timings, token usage, and the raw API response as the pipeline runs."
      )
    );
  }

  const statusState = runState || (data ? "ready" : "loading");
  const stageCount = Object.keys(progress).length;

  return h(
    "div",
    null,
    h(
      "div",
      { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
      h("h2", null, "Debug panel"),
      h("span", { className: "debug-status", "data-state": statusState }, statusState)
    ),

    // Fallback warning
    progress.fallback_engaged
      ? h(
          "div",
          { className: "debug-warn" },
          "Streaming endpoint failed â€” showing data from the non-streaming fallback. ",
          progress.fallback_engaged.reason ? h("span", { style: { opacity: 0.8 } }, `(${progress.fallback_engaged.reason})`) : null
        )
      : null,

    // Stage timings
    h(
      "section",
      { className: "debug-section" },
      h("h3", null, `Stage timings${finalDebug ? "" : ` Â· ${stageCount} stages received`}`),
      Object.entries(stageTimings).length
        ? Object.entries(stageTimings).map(([key, value]) =>
            h(
              "div",
              { key, className: "debug-stage-row" },
              h("span", { className: "label" }, formatTimingLabel(key)),
              h("span", { className: "value" }, formatMs(value))
            )
          )
        : h("p", { className: "debug-empty" }, "Waiting for first stage...")
    ),

    // Token usage + cost estimate
    tokenUsage
      ? h(
          "section",
          { className: "debug-section" },
          h("h3", null, "Tokens"),
          h(
            "div",
            { className: "debug-token-row" },
            h("span", { className: "label" }, "Prompt"),
            h("span", { className: "value" }, formatNumber(tokenUsage.prompt_tokens))
          ),
          typeof tokenUsage.cached_prompt_tokens === "number" && tokenUsage.cached_prompt_tokens > 0
            ? h(
                "div",
                { className: "debug-token-row" },
                h("span", { className: "label" }, "Cached"),
                h("span", { className: "value" }, formatNumber(tokenUsage.cached_prompt_tokens))
              )
            : null,
          h(
            "div",
            { className: "debug-token-row" },
            h("span", { className: "label" }, "Completion"),
            h("span", { className: "value" }, formatNumber(tokenUsage.completion_tokens))
          ),
          h(
            "div",
            { className: "debug-token-row" },
            h("span", { className: "label" }, "Total"),
            h("span", { className: "value" }, formatNumber(tokenUsage.total_tokens))
          ),
          h(
            "div",
            { className: "debug-token-row" },
            h("span", { className: "label" }, "Est. cost"),
            h("span", { className: "value" }, estimateCostLabel(tokenUsage, (finalDebug && finalDebug.synthesis_model) || "gpt-4.1-mini"))
          )
        )
      : null,

    // Retrieved evidence
    evidence && evidence.length
      ? h(
          "section",
          { className: "debug-section" },
          h("h3", null, `Retrieved evidence Â· ${evidence.length}`),
          evidence.slice(0, 10).map((source, index) =>
            h(
              "div",
              { key: `${source?.pmid || source?.doi || index}`, className: "debug-evidence-item" },
              h("div", { className: "title" }, source.title || "Untitled"),
              h(
                "div",
                { className: "meta" },
                [
                  source.publication_year || source.year || source.published_at || "",
                  source.journal || "",
                  source.publication_type || source.evidence_level || "",
                  typeof source.similarity === "number" ? `sim ${source.similarity.toFixed(3)}` : "",
                ]
                  .filter(Boolean)
                  .join(" Â· ")
              ),
              source.why_it_matters
                ? h("div", { className: "snippet" }, truncate(source.why_it_matters, 240))
                : null,
              source.chunk_text
                ? h(
                    "details",
                    null,
                    h("summary", null, "Full chunk"),
                    h("div", { className: "debug-code" }, source.chunk_text)
                  )
                : null
            )
          )
        )
      : null,

    // OpenAI input (system prompt + user JSON)
    openaiInput
      ? h(
          "section",
          { className: "debug-section" },
          h("h3", null, "OpenAI input (actual prompt sent)"),
          Array.isArray(openaiInput)
            ? openaiInput.map((message, index) =>
                h(
                  "details",
                  { key: index, open: false },
                  h(
                    "summary",
                    { style: { cursor: "pointer", fontSize: "0.75rem", color: "rgba(138, 179, 255, 0.9)", marginBottom: 4 } },
                    `${(message.role || "unknown").toUpperCase()} Â· ${String(message.content || "").length.toLocaleString()} chars`
                  ),
                  h(
                    "div",
                    { className: "debug-code", style: { maxHeight: 360 } },
                    String(message.content || "")
                  )
                )
              )
            : h("div", { className: "debug-code" }, JSON.stringify(openaiInput, null, 2))
        )
      : null,

    // Raw model output
    rawOutput
      ? h(
          "section",
          { className: "debug-section" },
          h("h3", null, "Raw model output"),
          h("div", { className: "debug-code" }, rawOutput)
        )
      : null,

    // Full response JSON (bottom escape hatch)
    data
      ? h(
          "details",
          { className: "debug-raw" },
          h("summary", null, "Full API response JSON"),
          h("div", { className: "debug-code" }, JSON.stringify(data, null, 2))
        )
      : null
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimingLabel(key) {
  return String(key)
    .replace(/_ms$/, "")
    .replace(/_at_ms$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "â€”";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "â€”";
  return value.toLocaleString();
}

// Rough cost estimate based on OpenAI published pricing for gpt-4.1-mini:
//   input:  $0.40 / 1M tokens    (cached: $0.10 / 1M)
//   output: $1.60 / 1M tokens
// Adjusts automatically to the fallback model if the synthesis model differs.
// This is a sanity check, not an invoice â€” don't use it for billing.
const COST_TABLE = {
  "gpt-4.1-mini": { input: 0.40, cached: 0.10, output: 1.60 },
  "gpt-4.1": { input: 2.00, cached: 0.50, output: 8.00 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.60 },
  "gpt-4o": { input: 2.50, cached: 1.25, output: 10.00 },
};
function estimateCostLabel(usage, model) {
  const rates = COST_TABLE[model] || COST_TABLE["gpt-4.1-mini"];
  const cached = Number(usage.cached_prompt_tokens || 0);
  const promptNoCache = Math.max(0, Number(usage.prompt_tokens || 0) - cached);
  const completion = Number(usage.completion_tokens || 0);
  const costUsd =
    (promptNoCache / 1_000_000) * rates.input +
    (cached / 1_000_000) * rates.cached +
    (completion / 1_000_000) * rates.output;
  if (costUsd < 0.0001) return `~$0 Â· ${model}`;
  return `$${costUsd.toFixed(4)} Â· ${model}`;
}

function truncate(value, max) {
  const s = String(value || "");
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim() + "â€¦";
}

// ---------------------------------------------------------------------------
// DebugPage â€” the actual React root component
// ---------------------------------------------------------------------------
//
// Renders nothing directly; it owns the live progress/data state and
// calls out to createRoot twice: once for ChatApp in the left column
// and once for DebugPanel in the right column. This two-root pattern
// keeps ChatApp's internal state isolated from DebugPanel (so chat
// re-renders don't trigger expensive DebugPanel recomputations and
// vice versa) while still letting them share live data via the
// module-level refs below.

function DebugPage() {
  const [progress, setProgress] = useState({});
  const [data, setData] = useState(null);
  const [runState, setRunState] = useState("idle");

  const handleProgress = (event) => {
    if (!event || !event.stage) return;
    setRunState("loading");
    setProgress((prev) => ({ ...prev, [event.stage]: event }));
  };

  const handleDebugData = (responseData) => {
    setData(responseData);
    setRunState("ready");
  };

  // Memoize the fetcher so ChatApp doesn't see a fresh reference on every
  // render (which would confuse its submitQuestionRef closures).
  const fetcher = useMemo(
    () => createStreamingFetcher({ onProgress: handleProgress }),
    []
  );

  // Reset for the next request â€” ChatApp calls onProgress for the first
  // frame of a new message, but we want to clear stale stage data BEFORE
  // that first frame arrives. Trigger on the user hitting Enter in the
  // chat composer by watching for a "connected" or "profile_loaded"
  // event when we already have final data; that's the "starting over"
  // signal.
  useEffect(() => {
    if (!progress.connected && !progress.profile_loaded) return;
    if (runState !== "ready") return;
    // Moving from "ready" back to "loading" means the user sent a new
    // message. Clear the final data so the panel shows the incoming
    // stages without the previous final response still overlaying.
    setData(null);
    setRunState("loading");
  }, [progress.connected, progress.profile_loaded]);

  return h(DebugPanel, { progress, data, runState });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async function boot() {
  // Admin gate. Non-admins get redirected in requireAdmin() before
  // anything renders, so we never leak an empty debug page to the
  // wrong person. If requireAdmin returns null the redirect has
  // already fired; bail.
  const session = await requireAdmin();
  if (!session) return;

  // Mount the DebugPage FIRST so the panel root is ready to receive
  // progress events as soon as ChatApp starts submitting messages.
  let debugApi = null;
  const debugRootEl = document.getElementById("debug-panel-root");
  if (debugRootEl) {
    // We need the DebugPage's state setters to be reachable from
    // ChatApp's onProgress/onDebugData props. Lift them via a tiny
    // wrapper that stores refs on module scope.
    let progressSetter = null;
    let dataSetter = null;
    let runStateSetter = null;

    function DebugPageLifted() {
      const [progress, setProgress] = useState({});
      const [data, setData] = useState(null);
      const [runState, setRunState] = useState("idle");
      // Capture setters on first render so the ChatApp-side callbacks
      // can reach them. This is safer than a useEffect because it
      // runs synchronously during the first render, before ChatApp
      // mounts and tries to submit anything.
      progressSetter = setProgress;
      dataSetter = setData;
      runStateSetter = setRunState;
      return h(DebugPanel, { progress, data, runState });
    }

    const debugRoot = createRoot(debugRootEl);
    debugRoot.render(h(DebugPageLifted));

    debugApi = {
      onProgress(event) {
        if (!event || !event.stage) return;
        if (progressSetter) {
          progressSetter((prev) => {
            // A "connected" or "profile_loaded" event on top of existing
            // progress means a new request â€” clear the old state.
            const isFirstFrame = event.stage === "connected" || event.stage === "profile_loaded";
            if (isFirstFrame && Object.keys(prev).length > 0) {
              if (dataSetter) dataSetter(null);
              return { [event.stage]: event };
            }
            return { ...prev, [event.stage]: event };
          });
        }
        if (runStateSetter) runStateSetter("loading");
      },
      onDebugData(responseData) {
        if (dataSetter) dataSetter(responseData);
        if (runStateSetter) runStateSetter("ready");
      },
    };
  }

  const chatRootEl = document.getElementById("debug-chat-root");
  if (!chatRootEl) {
    console.error("Debug page: missing #debug-chat-root");
    return;
  }
  const chatRoot = createRoot(chatRootEl);
  const fetcher = createStreamingFetcher({
    onProgress: (event) => debugApi && debugApi.onProgress(event),
  });
  chatRoot.render(
    h(ChatApp, {
      onDebugData: (data) => debugApi && debugApi.onDebugData(data),
      onProgress: (event) => debugApi && debugApi.onProgress(event),
      fetcher,
    })
  );
})().catch((error) => {
  console.error("Debug page boot failed:", error);
  const debugRootEl = document.getElementById("debug-panel-root");
  if (debugRootEl) {
    debugRootEl.innerHTML = `<div class="debug-empty">Debug page failed to load: ${String(error && error.message || error).replace(/</g, "&lt;")}</div>`;
  }
});

// `DebugPage` isn't actually rendered (we use the module-scoped "lifted"
// variant above), but keep it exported for future reuse / tests.
export { DebugPage, DebugPanel, createStreamingFetcher };
