// app/library/library.js — /app/library page entry.
//
// Renders the user's saved-sources list with search + sort + remove.
// Reads/writes through /api/emersus/saved-sources (see
// api/emersus/saved-sources.js).

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { getSession, requireAuth } from "/shared/supabase.js";
import { formatCitationUrl } from "/shared/citation-format.js";

const h = React.createElement;

const SORT_OPTIONS = [
  { id: "newest", label: "Newest saved" },
  { id: "oldest", label: "Oldest saved" },
  { id: "title",  label: "Title A–Z" },
  { id: "year",   label: "Year (newest)" },
];

function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function authorsShort(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return "";
  const fmt = (a) => typeof a === "string" ? a : (a?.name || "");
  const names = authors.map(fmt).filter(Boolean);
  if (names.length === 0) return "";
  const first = names[0].split(/\s+/).slice(-1)[0] || names[0];
  return names.length === 1 ? first : `${first} et al.`;
}

function metaRow(item) {
  const meta = item.meta_snapshot || {};
  const parts = [];
  if (meta.year) parts.push(String(meta.year));
  if (meta.journal) parts.push(meta.journal);
  const a = authorsShort(meta.authors);
  if (a) parts.unshift(a);
  return parts.join(" · ");
}

function LibraryApp({ accessToken }) {
  const [items, setItems] = useState(null);  // null = loading
  const [tier, setTier] = useState("free");
  const [cap, setCap] = useState(20);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/emersus/saved-sources", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`list ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setTier(data.tier || "free");
      setCap(data.cap ?? 20);
      setError(null);
    } catch (err) {
      console.error("library reload failed:", err);
      setError("Couldn't load your library. Try again.");
      setItems([]);
    }
  }, [accessToken]);

  useEffect(() => { reload(); }, [reload]);

  const handleRemove = useCallback(async (item) => {
    // Optimistic
    setItems((prev) => (prev || []).filter((it) => it.id !== item.id));
    try {
      const res = await fetch(`/api/emersus/saved-sources/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
    } catch (_) {
      // On error, reload to reconcile
      reload();
    }
  }, [accessToken, reload]);

  const filtered = useMemo(() => {
    const list = Array.isArray(items) ? items.slice() : [];
    const qLower = q.trim().toLowerCase();
    const filteredList = qLower
      ? list.filter((it) => {
          const meta = it.meta_snapshot || {};
          const hay = [
            meta.title || "",
            (meta.authors || []).map((a) => typeof a === "string" ? a : a?.name || "").join(" "),
            meta.journal || "",
          ].join(" ").toLowerCase();
          return hay.includes(qLower);
        })
      : list;
    const sorted = filteredList.slice().sort((a, b) => {
      if (sort === "newest") return (b.saved_at || "").localeCompare(a.saved_at || "");
      if (sort === "oldest") return (a.saved_at || "").localeCompare(b.saved_at || "");
      if (sort === "title") {
        const ta = (a.meta_snapshot?.title || "").toLowerCase();
        const tb = (b.meta_snapshot?.title || "").toLowerCase();
        return ta.localeCompare(tb);
      }
      if (sort === "year") {
        const ya = parseInt(a.meta_snapshot?.year || "0", 10) || 0;
        const yb = parseInt(b.meta_snapshot?.year || "0", 10) || 0;
        return yb - ya;
      }
      return 0;
    });
    return sorted;
  }, [items, q, sort]);

  const isLoading = items === null;
  const isEmpty = !isLoading && (items || []).length === 0;
  const countLabel = tier === "pro"
    ? `${(items || []).length}`
    : `${(items || []).length} / ${cap}`;
  const isOverCap = tier === "free" && (items || []).length >= cap;

  return h(
    "main",
    { className: "library-main" },
    h(
      "header",
      { className: "library-header" },
      h("h1", { className: "library-title" }, "Library"),
      h("div", { className: "library-count" }, countLabel),
    ),
    isOverCap
      ? h(
          "div",
          { className: "library-cap-banner" },
          h("span", null, `You've hit the Free library limit (${cap}). Remove sources or upgrade for unlimited saves.`),
          h("a", { href: "/pricing", className: "library-cap-cta" }, "Upgrade →"),
        )
      : null,
    !isEmpty
      ? h(
          "div",
          { className: "library-controls" },
          h("input", {
            className: "library-search",
            type: "search",
            placeholder: "Search titles, authors, journals…",
            value: q,
            onChange: (e) => setQ(e.target.value),
            "aria-label": "Search library",
          }),
          h(
            "select",
            {
              className: "library-sort",
              value: sort,
              onChange: (e) => setSort(e.target.value),
              "aria-label": "Sort library",
            },
            SORT_OPTIONS.map((o) =>
              h("option", { key: o.id, value: o.id }, o.label)
            )
          ),
        )
      : null,
    error
      ? h("div", { className: "library-error", role: "alert" }, error)
      : null,
    isLoading
      ? h("div", { className: "library-loading" }, "Loading…")
      : isEmpty
        ? h(
            "div",
            { className: "library-empty" },
            h("p", { className: "library-empty-lead" }, "No saved sources yet."),
            h("p", { className: "library-empty-sub" },
              "Bookmark papers from the Sources footer in chat to build your library."),
            h("a", { className: "library-empty-cta", href: "/app/" }, "Go to chat →"),
          )
        : h(
            "ul",
            { className: "library-list" },
            filtered.map((item) => {
              const meta = item.meta_snapshot || {};
              const url = formatCitationUrl({
                url: meta.url,
                source: meta.source,
                pmid: meta.pmid,
                doi: meta.doi,
              });
              const savedFrom = item.saved_from || {};
              return h(
                "li",
                { key: item.id, className: "library-item" },
                h(
                  "div",
                  { className: "library-item-main" },
                  url
                    ? h("a", {
                        href: url,
                        target: "_blank",
                        rel: "noopener noreferrer",
                        className: "library-item-title",
                      }, meta.title || "Untitled")
                    : h("span", { className: "library-item-title" }, meta.title || "Untitled"),
                  h("div", { className: "library-item-meta" }, metaRow(item)),
                  h(
                    "div",
                    { className: "library-item-sub" },
                    h("span", null, `Saved ${relativeTime(item.saved_at)}`),
                    savedFrom.thread_id
                      ? h(React.Fragment, null,
                          h("span", { className: "library-item-sep" }, " · "),
                          h("a", {
                            className: "library-item-thread",
                            href: `/app/?thread=${encodeURIComponent(savedFrom.thread_id)}`,
                          }, savedFrom.thread_title
                              ? `from "${savedFrom.thread_title}" ↗`
                              : "from this thread ↗"),
                        )
                      : null,
                  ),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "library-item-remove",
                    "aria-label": "Remove from library",
                    title: "Remove",
                    onClick: () => handleRemove(item),
                  },
                  "✕"
                ),
              );
            })
          ),
  );
}

async function boot() {
  await requireAuth();
  const session = await getSession();
  const root = createRoot(document.getElementById("library-root"));
  root.render(h(LibraryApp, { accessToken: session?.access_token || "" }));
}

boot();
