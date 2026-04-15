// shared/chat/sidebar-helpers.js — pure helpers for the chat_v2 sidebar.
//
// - groupThreadsByDate(threads, now) buckets threads into Today / Yesterday /
//   Previous 7 days / Earlier using the local clock.
// - filterThreadsBySearch(threads, query) returns the threads whose title or
//   preview contains the query (case-insensitive). Empty query → all.
//
// No React, no DOM. Used by react-chat-app.js so the rendering code stays
// thin.

import { localDateStr } from "../date-utils.js";

export const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Earlier"];

function emptyBuckets() {
  const buckets = {};
  for (const key of GROUP_ORDER) buckets[key] = [];
  return buckets;
}

function localDateOffsetFrom(reference, days) {
  const d = new Date(reference);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

function bucketFor(updatedAt, today, yesterday, sevenDaysAgo) {
  if (!updatedAt) return "Earlier";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const stamp = localDateStr(date);
  if (stamp === today) return "Today";
  if (stamp === yesterday) return "Yesterday";
  if (stamp >= sevenDaysAgo) return "Previous 7 days";
  return "Earlier";
}

export function groupThreadsByDate(threads, now = new Date()) {
  const buckets = emptyBuckets();
  if (!Array.isArray(threads)) return buckets;
  const today = localDateStr(now);
  const yesterday = localDateOffsetFrom(now, -1);
  const sevenDaysAgo = localDateOffsetFrom(now, -7);
  for (const thread of threads) {
    const bucket = bucketFor(thread?.updatedAt, today, yesterday, sevenDaysAgo);
    buckets[bucket].push(thread);
  }
  return buckets;
}

export function filterThreadsBySearch(threads, rawQuery) {
  const list = Array.isArray(threads) ? threads : [];
  const query = String(rawQuery || "").trim().toLowerCase();
  if (!query) return list;
  return list.filter((thread) => {
    const title = String(thread?.title || "").toLowerCase();
    const preview = String(thread?.preview || "").toLowerCase();
    return title.includes(query) || preview.includes(query);
  });
}
