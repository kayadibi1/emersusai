// SVG chart helpers for the progress dashboard.
// Each function returns an SVG markup string.
// No dependencies — pure functions that map data to coordinates.

/**
 * Stacked bar chart for weekly activity.
 * @param {Array<{week_start: string, resistance_volume_kg: number, cardio_duration_seconds: number}>} data
 * @param {{width?: number, height?: number}} opts
 * @returns {string} SVG markup
 */
export function weeklyActivityChart(data, { width = 400, height = 120 } = {}) {
  if (!data || data.length === 0) return emptyChart(width, height, "No activity data");

  const pad = { top: 4, bottom: 20, left: 0, right: 0 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const barGap = 6;
  const barW = Math.max(8, (chartW - barGap * (data.length - 1)) / data.length);

  // Normalize: resistance by max volume, cardio by max seconds
  const maxVol = Math.max(...data.map(d => d.resistance_volume_kg || 0), 1);
  const maxCardio = Math.max(...data.map(d => d.cardio_duration_seconds || 0), 1);

  // Scale both to share the chart height (stacked visually)
  const bars = data.map((d, i) => {
    const x = pad.left + i * (barW + barGap);
    const rH = ((d.resistance_volume_kg || 0) / maxVol) * chartH * 0.7;
    const cH = ((d.cardio_duration_seconds || 0) / maxCardio) * chartH * 0.3;
    const rY = pad.top + chartH - rH;
    const cY = rY - cH - 2; // 2px gap between stacks
    const label = weekLabel(d.week_start);
    return { x, rH, rY, cH, cY, label, barW };
  });

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  for (const b of bars) {
    if (b.cH > 0) {
      svg += `<rect x="${b.x}" y="${b.cY}" width="${b.barW}" height="${b.cH}" rx="3" fill="rgba(159,251,0,0.4)"/>`;
    }
    if (b.rH > 0) {
      svg += `<rect x="${b.x}" y="${b.rY}" width="${b.barW}" height="${b.rH}" rx="3" fill="rgba(109,159,255,0.55)"/>`;
    }
    svg += `<text x="${b.x + b.barW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.3)" font-family="Inter,system-ui,sans-serif">${b.label}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Line chart for exercise progression (e1RM or load over time).
 * @param {Array<{performed_at: string, value: number}>} data
 * @param {{width?: number, height?: number, color?: string, prDate?: string}} opts
 * @returns {string} SVG markup
 */
export function progressionLineChart(data, { width = 400, height = 140, color = "#78dc14", prDate = null } = {}) {
  if (!data || data.length < 2) return emptyChart(width, height, "Not enough data");

  const pad = { top: 12, bottom: 24, left: 8, right: 8 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const values = data.map(d => d.value);
  const minV = Math.min(...values) * 0.9;
  const maxV = Math.max(...values) * 1.05;
  const range = maxV - minV || 1;

  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * chartW,
    y: pad.top + chartH - ((d.value - minV) / range) * chartH,
    date: d.performed_at,
    value: d.value,
    isPR: prDate && d.performed_at === prDate,
  }));

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");

  // Area fill path
  const areaPath = `M${points[0].x},${points[0].y} ` +
    points.slice(1).map(p => `L${p.x},${p.y}`).join(" ") +
    ` L${points[points.length - 1].x},${pad.top + chartH} L${points[0].x},${pad.top + chartH} Z`;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  // Grid lines
  for (let i = 0; i < 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`;
  }

  // Area
  svg += `<path d="${areaPath}" fill="${color}" opacity="0.08"/>`;

  // Line
  svg += `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

  // Data points
  for (const p of points) {
    if (p.isPR) {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="none" stroke="#FFD700" stroke-width="1.5"/>`;
      svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#FFD700"/>`;
    } else {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color}"/>`;
    }
  }

  // X-axis labels (first, mid, last)
  const labelIndices = [0, Math.floor(points.length / 2), points.length - 1];
  for (const idx of [...new Set(labelIndices)]) {
    const p = points[idx];
    svg += `<text x="${p.x}" y="${height - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.3)" font-family="Inter,system-ui,sans-serif">${shortDate(p.date)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Horizontal bar for muscle volume display.
 * @param {number} pct - 0 to 100
 * @param {{color?: string}} opts
 * @returns {string} SVG markup (single bar, 100% width, 4px height)
 */
export function muscleBar(pct, { color = "var(--primary)" } = {}) {
  return `<div style="height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden">
    <div style="height:100%;width:${Math.min(100, pct)}%;border-radius:2px;background:linear-gradient(90deg,${color},var(--primary-dim));transition:width 500ms ease"></div>
  </div>`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function weekLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const month = d.toLocaleString("en", { month: "short" });
  return `${month} ${d.getDate()}`;
}

function shortDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.toLocaleString("en", { month: "short" })} ${d.getDate()}`;
}

function emptyChart(w, h, msg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.2)" font-family="Inter,system-ui,sans-serif">${msg}</text>
  </svg>`;
}

// ── Formatting helpers ──────────────────────────────────────────────

/**
 * Format a volume (total kg) for display. Unit-aware.
 * @param {number} kg
 * @param {"kg"|"lbs"} unit - Defaults to kg for backwards compatibility
 */
export function formatVolume(kg, unit = "kg") {
  if (kg == null || isNaN(kg)) return "0" + unit;
  if (unit === "lbs") {
    const lbs = kg * 2.20462;
    if (lbs >= 10000) return `${(lbs / 1000).toFixed(1)}k lbs`;
    return `${Math.round(lbs)} lbs`;
  }
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)}kg`;
}

/**
 * Format a single weight value (load) for display. Unit-aware.
 * @param {number} kg
 * @param {"kg"|"lbs"} unit
 */
export function formatLoad(kg, unit = "kg") {
  if (kg == null || isNaN(kg)) return "-";
  if (unit === "lbs") return `${Math.round(kg * 2.20462)}lbs`;
  return `${Math.round(kg)}kg`;
}

export function formatDuration(seconds) {
  if (!seconds) return "0min";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m > 0 ? m + "m" : ""}`.trim();
  return `${m}min`;
}

export function formatE1rm(loadKg, reps) {
  if (!loadKg || !reps) return null;
  return Math.round(loadKg * (1 + reps / 30));
}

export function formatPace(distanceMeters, seconds) {
  if (!distanceMeters || !seconds) return null;
  const minPerKm = (seconds / 60) / (distanceMeters / 1000);
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}
