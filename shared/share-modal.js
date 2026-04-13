// Share modal â€” reusable React component for all session views.
// Renders a card preview, then Web Share API / Download / Copy / Close.

import React, { useEffect, useState } from "react";
import { renderShareCard } from "/shared/share-card.js";
import { computeCanShareFiles } from "/shared/share-capability.js";

const h = React.createElement;

// Cache the Web Share API capability check at module-load time. The
// result depends only on navigator + File constructor, both stable for
// the lifetime of the page, so recomputing per render (or even per
// component mount via useMemo) is wasted work.
const CAN_SHARE_FILES =
  typeof navigator !== "undefined" && typeof File !== "undefined"
    ? computeCanShareFiles(navigator, File)
    : false;

/**
 * Props:
 *   cardData    â€” variant-specific data object for renderShareCard
 *   cardOpts    â€” { mapboxToken, weightUnit, distanceUnit }
 *   onClose     â€” function to call on dismiss
 */
export function ShareModal({ cardData, cardOpts, onClose }) {
  const [state, setState] = useState("rendering"); // rendering | ready | sharing | shared | error
  const [blob, setBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const resultBlob = await renderShareCard(cardData, cardOpts);
        if (cancelled) return;
        const url = URL.createObjectURL(resultBlob);
        setBlob(resultBlob);
        setPreviewUrl(url);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[share-modal] render failed:", err);
        setError(err.message || String(err));
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const filename = `${(cardData.title || "emersus").replace(/[^\w-]/g, "_")}.png`;

  async function doShare() {
    if (!blob) return;
    try {
      setState("sharing");
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: cardData.title,
          text: `${cardData.title}. Logged on emersus.ai`,
        });
        setState("shared");
        setTimeout(onClose, 1500);
      } else {
        doDownload();
        setState("ready");
      }
    } catch (err) {
      // User cancelled or share failed â€” return to ready
      setState("ready");
    }
  }

  function doDownload() {
    if (!blob || !previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function doCopy() {
    if (!blob) return;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        // Flash a quick inline confirmation
        const btn = document.querySelector("[data-share-copy]");
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => { btn.textContent = orig; }, 1200);
        }
      }
    } catch (_err) {
      // Silent â€” some browsers block programmatic clipboard image writes
    }
  }

  return h(
    "div",
    { className: "share-modal-backdrop", onClick: onClose },
    h(
      "div",
      { className: "share-modal", onClick: (e) => e.stopPropagation() },
      h("div", { className: "share-modal-title" },
        state === "rendering" ? "Generating card..." :
        state === "error" ? "Could not generate card" :
        state === "shared" ? "Shared!" : "Session saved. Share?"
      ),

      state === "rendering" &&
        h("div", { className: "share-modal-spinner" }, "â€¦"),

      state === "error" &&
        h("div", { className: "share-modal-error" }, error || "Unknown error"),

      (state === "ready" || state === "sharing") && previewUrl &&
        h("img", { className: "share-modal-preview", src: previewUrl, alt: "Share card preview" }),

      (state === "ready") && h(
        "div",
        { className: "share-modal-buttons" },
        CAN_SHARE_FILES && h("button", { className: "share-btn-primary", onClick: doShare }, "Share"),
        h("button", { className: "share-btn-secondary", onClick: doDownload }, "Download"),
        h("button", {
          className: "share-btn-secondary",
          "data-share-copy": "",
          onClick: doCopy,
        }, "Copy to clipboard"),
        h("button", { className: "share-btn-tertiary", onClick: onClose }, "Close"),
      ),

      state === "error" && h(
        "div",
        { className: "share-modal-buttons" },
        h("button", { className: "share-btn-tertiary", onClick: onClose }, "Close"),
      ),
    )
  );
}

// CSS for the modal â€” callers should include this or equivalent
export const SHARE_MODAL_CSS = `
.share-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.share-modal {
  background: #0c0e11;
  border-radius: 20px;
  padding: 20px;
  max-width: 360px;
  width: 100%;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  border: 1px solid rgba(255,255,255,0.08);
}
.share-modal-title {
  font-size: 0.95rem;
  font-weight: 700;
  text-align: center;
  color: #f9f9fd;
  margin-bottom: 14px;
}
.share-modal-spinner {
  text-align: center;
  padding: 40px 0;
  color: #a7adb4;
  font-size: 1.4rem;
}
.share-modal-error {
  color: #ff8f9d;
  text-align: center;
  padding: 20px 0;
  font-size: 0.85rem;
}
.share-modal-preview {
  width: 100%;
  border-radius: 12px;
  display: block;
  margin-bottom: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}
.share-modal-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.share-btn-primary {
  background: #78dc14;
  color: #0c0e11;
  font-weight: 800;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  padding: 14px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
}
.share-btn-secondary {
  background: rgba(255,255,255,0.04);
  color: #f9f9fd;
  font-weight: 700;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
}
.share-btn-tertiary {
  background: transparent;
  color: #a7adb4;
  font-size: 0.72rem;
  padding: 8px;
  border: none;
  cursor: pointer;
}
`;
