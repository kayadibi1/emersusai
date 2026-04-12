// Share card Canvas renderer — 6 variants (gym, cardio+map, cardio time-only, swim, climb, hybrid).
// Exports renderShareCard(data, opts) → Promise<Blob>.
//
// Data shape varies by variant; common fields:
//   title, date, user_name, watermark, variant
// Variant-specific fields documented inline.

import { privacyCrop, mapboxStaticUrl } from "/shared/mapbox.js";
import { formatDistance, formatPaceUnit, formatWeight, formatVolumeWithUnit } from "/shared/unit-conversion.js";
import { hardestSent, compareGrades } from "/shared/climbing-grades.js";

const CARD_W = 1080;
const CARD_H = 1350;
const PAD = 80;

// ── Font loading ────────────────────────────────────────────────────

const FONT_URL_BASE = "https://fonts.gstatic.com/s/inter/v13/";
const FONTS_TO_LOAD = [
  { weight: 400, name: "Inter" },
  { weight: 600, name: "Inter" },
  { weight: 700, name: "Inter" },
  { weight: 800, name: "Inter" },
  { weight: 900, name: "Inter" },
];

let fontLoadPromise = null;
async function ensureFontsLoaded() {
  if (fontLoadPromise) return fontLoadPromise;
  fontLoadPromise = (async () => {
    // Use the FontFace API to force-load Inter via Google Fonts CSS import
    // The @font-face declarations are already available from the pages that load Inter,
    // but we explicitly call document.fonts.load() to ensure they're rasterized.
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all([
      document.fonts.load("400 16px Inter"),
      document.fonts.load("600 16px Inter"),
      document.fonts.load("700 16px Inter"),
      document.fonts.load("800 16px Inter"),
      document.fonts.load("900 16px Inter"),
    ]);
  })();
  return fontLoadPromise;
}

// ── Color constants ─────────────────────────────────────────────────

const COLORS = {
  bg: "#0c0e11",
  bgDark: "#161922",
  ink: "#e8e8e8",
  muted: "#666",
  primary: "#78dc14",
  secondary: "#78dc14",
  gold: "#FFD700",
  line: "rgba(255, 255, 255, 0.08)",
  lineHeavy: "rgba(255, 255, 255, 0.18)",
};

// ── Main entry ──────────────────────────────────────────────────────

/**
 * Render a share card and return a PNG blob.
 * @param {Object} data - card data (see variants below)
 * @param {Object} opts - { mapboxToken, weightUnit, distanceUnit }
 * @returns {Promise<Blob>}
 */
export async function renderShareCard(data, opts = {}) {
  await ensureFontsLoaded().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, data.variant);
  drawHeader(ctx, data);

  switch (data.variant) {
    case "gym":
      await drawGymBody(ctx, data, opts);
      break;
    case "cardio_map":
      await drawCardioBody(ctx, data, opts);
      break;
    case "cardio_time":
      drawCardioTimeBody(ctx, data, opts);
      break;
    case "swim":
      drawSwimBody(ctx, data, opts);
      break;
    case "climb":
      drawClimbBody(ctx, data, opts);
      break;
    case "hybrid":
      drawHybridBody(ctx, data, opts);
      break;
    default:
      throw new Error(`Unknown variant: ${data.variant}`);
  }

  drawFooter(ctx, data);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      "image/png",
      0.95
    );
  });
}

// ── Shared sections ─────────────────────────────────────────────────

function drawBackground(ctx, variant) {
  // Base fill
  const base = ctx.createLinearGradient(0, 0, 0, CARD_H);
  base.addColorStop(0, COLORS.bg);
  base.addColorStop(1, COLORS.bgDark);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Radial glows (different tints per variant)
  const topGlow = ctx.createRadialGradient(CARD_W * 0.2, 0, 0, CARD_W * 0.2, 0, CARD_W);
  const bottomGlow = ctx.createRadialGradient(CARD_W * 0.8, CARD_H, 0, CARD_W * 0.8, CARD_H, CARD_W);

  if (variant === "climb") {
    topGlow.addColorStop(0, "rgba(255, 215, 0, 0.18)");
    bottomGlow.addColorStop(0, "rgba(159, 251, 0, 0.14)");
  } else if (variant === "swim") {
    topGlow.addColorStop(0, "rgba(109, 159, 255, 0.38)");
    bottomGlow.addColorStop(0, "rgba(100, 200, 255, 0.18)");
  } else {
    topGlow.addColorStop(0, "rgba(109, 159, 255, 0.35)");
    bottomGlow.addColorStop(0, "rgba(159, 251, 0, 0.22)");
  }
  topGlow.addColorStop(1, "rgba(0,0,0,0)");
  bottomGlow.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = bottomGlow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function drawHeader(ctx, data) {
  // Brand strip
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("EMERSUS · SESSION LOG", PAD, PAD);

  // Kicker
  ctx.fillStyle = COLORS.secondary;
  ctx.font = "700 28px Inter, system-ui, sans-serif";
  ctx.fillText("COMPLETED", PAD, PAD + 110);

  // Title
  ctx.fillStyle = COLORS.ink;
  ctx.font = "900 90px Inter, system-ui, sans-serif";
  ctx.fillText(data.title || "Session", PAD, PAD + 150);

  // Date
  ctx.fillStyle = COLORS.muted;
  ctx.font = "500 28px Inter, system-ui, sans-serif";
  ctx.fillText(data.date || "", PAD, PAD + 260);
}

function drawFooter(ctx, data) {
  const y = CARD_H - PAD - 40;
  ctx.textBaseline = "top";

  // User name (left)
  if (data.user_name) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 24px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(data.user_name, PAD, y);
  }

  // Watermark (right)
  ctx.fillStyle = COLORS.secondary;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("emersus.ai", CARD_W - PAD, y + 2);
  ctx.textAlign = "left";
}

function drawHero(ctx, value, label, color = COLORS.secondary) {
  const y = PAD + 330;
  ctx.fillStyle = color;
  ctx.font = "900 180px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(value, PAD, y);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 28px Inter, system-ui, sans-serif";
  ctx.fillText(label, PAD, y + 190);
}

function drawMiniRow(ctx, tiles) {
  const y = PAD + 590;
  const colWidth = (CARD_W - PAD * 2) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = PAD + i * colWidth;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 52px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(tile.value, x, y);

    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 22px Inter, system-ui, sans-serif";
    ctx.fillText(tile.label, x, y + 70);
  });
}

function drawDivider(ctx, y) {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(CARD_W - PAD, y);
  ctx.stroke();
}

// ── Gym variant ─────────────────────────────────────────────────────
// data.variant = "gym"
// data.total_volume_display, data.set_count, data.exercise_count, data.duration_display
// data.top_exercises = [{name, best_set_display, is_pr}]

async function drawGymBody(ctx, data, opts) {
  drawHero(ctx, data.total_volume_display || "0", "TOTAL VOLUME");
  drawMiniRow(ctx, [
    { value: String(data.set_count || 0), label: "SETS" },
    { value: String(data.exercise_count || 0), label: "EXERCISES" },
    { value: data.duration_display || "--", label: "DURATION" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Top exercises
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("TOP LIFTS", PAD, dividerY + 30);

  const exercises = (data.top_exercises || []).slice(0, 3);
  exercises.forEach((ex, i) => {
    const y = dividerY + 80 + i * 60;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "500 34px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(ex.name || "", PAD, y);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 34px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    const valText = ex.best_set_display || "";
    ctx.fillText(valText, CARD_W - PAD, y);

    if (ex.is_pr) {
      ctx.fillStyle = COLORS.gold;
      ctx.font = "700 20px Inter, system-ui, sans-serif";
      const prX = CARD_W - PAD - ctx.measureText(valText).width - 20;
      ctx.fillText("PR", prX, y + 8);
    }

    ctx.textAlign = "left";
  });
}

// ── Cardio with map variant ─────────────────────────────────────────
// data.variant = "cardio_map"
// data.distance_display, data.duration_display, data.pace_display, data.activity_type
// data.gps_path (cropped)

async function drawCardioBody(ctx, data, opts) {
  drawHero(ctx, data.distance_display || "--", "DISTANCE");
  drawMiniRow(ctx, [
    { value: data.duration_display || "--", label: "TIME" },
    { value: data.pace_display || "--", label: "PACE" },
    { value: data.activity_label || "Cardio", label: "ACTIVITY" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Map section header
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("ROUTE", PAD, dividerY + 30);

  // Fetch and draw map
  const mapX = PAD;
  const mapY = dividerY + 80;
  const mapW = CARD_W - PAD * 2;
  const mapH = 280;

  const url = mapboxStaticUrl(data.gps_path || [], opts.mapboxToken, {
    width: 900,
    height: 500,
  });

  if (url) {
    try {
      const img = await fetchImage(url);
      ctx.save();
      roundRectPath(ctx, mapX, mapY, mapW, mapH, 20);
      ctx.clip();
      ctx.drawImage(img, mapX, mapY, mapW, mapH);
      ctx.restore();
    } catch (err) {
      // Fallback: draw a placeholder
      drawMapPlaceholder(ctx, mapX, mapY, mapW, mapH);
    }
  } else {
    drawMapPlaceholder(ctx, mapX, mapY, mapW, mapH);
  }
}

function drawMapPlaceholder(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRectPath(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 24px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Route map unavailable", x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

// ── Cardio time-only variant ───────────────────────────────────────
// data.variant = "cardio_time"
// data.duration_display, data.activity_label

function drawCardioTimeBody(ctx, data, opts) {
  drawHero(ctx, data.duration_display || "--", "DURATION");
  drawMiniRow(ctx, [
    { value: data.distance_display || "--", label: "DISTANCE" },
    { value: data.pace_display || "--", label: "PACE" },
    { value: data.activity_label || "Cardio", label: "ACTIVITY" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Large activity label centered
  ctx.fillStyle = COLORS.ink;
  ctx.font = "800 80px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(data.activity_label || "Cardio", CARD_W / 2, dividerY + 180);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

// ── Swim variant ────────────────────────────────────────────────────
// data.variant = "swim"
// data.distance_display, data.duration_display, data.pace_per_100m_display
// data.lap_count, data.pool_length_m, data.lap_splits, data.stroke_label

function drawSwimBody(ctx, data, opts) {
  drawHero(ctx, data.distance_display || "--", "DISTANCE");
  drawMiniRow(ctx, [
    { value: data.duration_display || "--", label: "TIME" },
    { value: data.pace_per_100m_display || "--", label: "/100m" },
    { value: `${data.lap_count || 0}`, label: `LAPS (${data.pool_length_m || "?"}m)` },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Lap splits bar chart
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("LAP SPLITS", PAD, dividerY + 30);

  const splits = data.lap_splits || [];
  if (splits.length > 0) {
    const chartX = PAD;
    const chartY = dividerY + 90;
    const chartW = CARD_W - PAD * 2;
    const chartH = 220;
    const maxSplit = Math.max(...splits);
    const minSplit = Math.min(...splits);
    const barW = Math.max(8, (chartW - 4 * (splits.length - 1)) / splits.length);

    splits.forEach((split, i) => {
      const barH = Math.max(6, ((split - minSplit * 0.6) / (maxSplit - minSplit * 0.6 + 0.01)) * chartH);
      const bx = chartX + i * (barW + 4);
      const by = chartY + chartH - barH;
      ctx.fillStyle = split === minSplit ? COLORS.gold : "rgba(109, 159, 255, 0.55)";
      ctx.fillRect(bx, by, barW, barH);
    });
  } else {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "500 24px Inter, system-ui, sans-serif";
    ctx.fillText("No lap splits recorded", PAD, dividerY + 150);
  }
}

// ── Climb variant ──────────────────────────────────────────────────
// data.variant = "climb"
// data.hardest_grade, data.total_routes, data.flash_count, data.style_label
// data.top_routes = [{grade, name?, send_type}]

function drawClimbBody(ctx, data, opts) {
  drawHero(ctx, data.hardest_grade || "--", "HARDEST SENT", COLORS.gold);
  drawMiniRow(ctx, [
    { value: String(data.total_routes || 0), label: "ROUTES" },
    { value: String(data.flash_count || 0), label: "FLASHES" },
    { value: data.style_label || "Climb", label: "STYLE" },
  ]);

  const dividerY = PAD + 750;
  drawDivider(ctx, dividerY);

  // Top sends list
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("TOP SENDS", PAD, dividerY + 30);

  const routes = (data.top_routes || []).slice(0, 3);
  routes.forEach((route, i) => {
    const y = dividerY + 80 + i * 60;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 40px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    const label = route.name ? `${route.grade} · ${route.name}` : route.grade;
    ctx.fillText(label, PAD, y);

    // Send type badge on right
    const badgeText = (route.send_type || "").toUpperCase();
    if (badgeText) {
      ctx.fillStyle =
        route.send_type === "flash"
          ? COLORS.secondary
          : route.send_type === "send"
          ? COLORS.primary
          : COLORS.muted;
      ctx.font = "800 20px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(badgeText, CARD_W - PAD, y + 10);
    }
    ctx.textAlign = "left";
  });
}

// ── Hybrid variant ─────────────────────────────────────────────────
// data.variant = "hybrid"
// data.total_volume_display, data.duration_display
// data.top_exercises = [{name, best_set_display}]

function drawHybridBody(ctx, data, opts) {
  // Two stacked heroes
  const y1 = PAD + 330;
  ctx.fillStyle = COLORS.secondary;
  ctx.font = "900 130px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(data.duration_display || "--", PAD, y1);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 26px Inter, system-ui, sans-serif";
  ctx.fillText("DURATION", PAD, y1 + 140);

  const y2 = y1 + 200;
  ctx.fillStyle = COLORS.primary;
  ctx.font = "900 110px Inter, system-ui, sans-serif";
  ctx.fillText(data.total_volume_display || "--", PAD, y2);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 26px Inter, system-ui, sans-serif";
  ctx.fillText("TOTAL VOLUME", PAD, y2 + 120);

  const dividerY = PAD + 800;
  drawDivider(ctx, dividerY);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText("HIGHLIGHTS", PAD, dividerY + 30);

  const exercises = (data.top_exercises || []).slice(0, 3);
  exercises.forEach((ex, i) => {
    const y = dividerY + 80 + i * 54;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "500 30px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(ex.name || "", PAD, y);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 30px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(ex.best_set_display || "", CARD_W - PAD, y);
    ctx.textAlign = "left";
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error("Image load failed"));
    img.src = url;
  });
}

// ── Data shaping helpers (used by session views) ──────────────────

/**
 * Build cardio card data from a session's completed_blocks.
 */
export function buildCardioCardData(session, completedBlock, profile, opts) {
  const distanceUnit = profile?.distance_unit || "km";
  const mapboxToken = opts?.mapboxToken;
  const privacyRadius = profile?.mapbox_privacy_radius_m ?? 100;

  const croppedPath = privacyCrop(completedBlock.gps_path || [], privacyRadius);
  const hasMap = mapboxToken && croppedPath.length >= 2;

  return {
    variant: hasMap ? "cardio_map" : "cardio_time",
    title: session.title || "Cardio",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    gps_path: croppedPath,
    distance_display: formatDistance(completedBlock.total_distance_m, distanceUnit, { decimals: 2 }),
    duration_display: formatDurationMMSS(completedBlock.duration_seconds),
    pace_display: completedBlock.avg_pace_sec_per_km
      ? formatPaceUnit(completedBlock.avg_pace_sec_per_km, distanceUnit)
      : "--",
    activity_label: labelForActivity(completedBlock.activity_type),
  };
}

export function buildSwimCardData(session, completedBlock, profile) {
  return {
    variant: "swim",
    title: session.title || "Swim",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    distance_display: `${completedBlock.total_distance_m || 0}m`,
    duration_display: formatDurationMMSS(completedBlock.duration_seconds),
    pace_per_100m_display: formatPace100m(completedBlock.duration_seconds, completedBlock.total_distance_m),
    lap_count: completedBlock.lap_count || 0,
    pool_length_m: completedBlock.pool_length_m || 25,
    lap_splits: completedBlock.lap_splits || [],
    stroke_label: labelForStroke(completedBlock.stroke_type),
  };
}

export function buildClimbCardData(session, completedBlock, profile) {
  const routes = completedBlock.routes || [];
  const sent = routes.filter(r => r.send_type === "flash" || r.send_type === "send");
  const hardest = hardestSent(routes);
  const flashes = routes.filter(r => r.send_type === "flash").length;

  const topRoutes = [...sent].sort((a, b) => {
    // Sort by grade index desc within same system (harder first).
    // localeCompare would treat "V10" as less than "V9" because '1' < '9'.
    if (a.grade_system !== b.grade_system) return 0;
    return compareGrades(b.grade, a.grade, a.grade_system);
  }).slice(0, 3);

  return {
    variant: "climb",
    title: session.title || "Climb",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    hardest_grade: hardest?.grade || "--",
    total_routes: routes.length,
    flash_count: flashes,
    style_label: labelForClimbStyle(completedBlock.style),
    top_routes: topRoutes,
  };
}

export function buildGymCardData(session, profile, summary) {
  const weightUnit = profile?.weight_unit || "kg";
  return {
    variant: "gym",
    title: session.title || "Workout",
    date: formatDate(new Date()),
    user_name: profile?.display_name_public || "",
    total_volume_display: formatVolumeWithUnit(summary.totalVolumeKg, weightUnit),
    set_count: summary.setCount,
    exercise_count: summary.exerciseCount,
    duration_display: formatDurationMMSS(summary.durationSeconds),
    top_exercises: summary.topExercises,
  };
}

// ── Label helpers ───────────────────────────────────────────────────

function labelForActivity(type) {
  if (!type) return "Cardio";
  const map = {
    running: "Run",
    cycling: "Bike",
    walking: "Walk",
    hiking: "Hike",
  };
  return map[type] || "Cardio";
}

function labelForStroke(stroke) {
  if (!stroke) return "Swim";
  return stroke.charAt(0).toUpperCase() + stroke.slice(1);
}

function labelForClimbStyle(style) {
  if (!style) return "Climb";
  const map = {
    bouldering: "Boulder",
    sport_climbing: "Sport",
    top_rope_climbing: "Top-rope",
    trad_climbing: "Trad",
  };
  return map[style] || "Climb";
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function formatDurationMMSS(seconds) {
  if (!seconds || seconds < 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace100m(seconds, meters) {
  if (!seconds || !meters || meters < 100) return "--";
  const secPer100 = (seconds * 100) / meters;
  const m = Math.floor(secPer100 / 60);
  const s = Math.round(secPer100 % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
