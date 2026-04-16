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
    svg += `<text x="${b.x + b.barW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.3)" font-family="system-ui,sans-serif">${b.label}</text>`;
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
    svg += `<text x="${p.x}" y="${height - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.3)" font-family="system-ui,sans-serif">${shortDate(p.date)}</text>`;
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

/**
 * Ghost sparkline SVG for momentum cards.
 * @param {number[]} values - Weekly max e1RM (can include zeros for missing weeks)
 * @param {number[]} prWeeks - Indices of PR weeks
 */
export function momentumSparkline(values, prWeeks = []) {
  if (!values || values.length < 2) return "";
  const W = 200, H = 60;
  const max = Math.max(...values) || 1;
  const min = Math.min(...values.filter(v => v > 0)) || 0;
  const range = max - min || 1;
  const pad = 4;
  const plotH = H - pad * 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = v > 0
      ? pad + plotH - ((v - min) / range) * plotH
      : H - pad;
    return { x, y };
  });

  const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} ` +
    points.slice(1).map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${points[points.length - 1].x.toFixed(1)},${H} L${points[0].x.toFixed(1)},${H} Z`;

  const prDots = (prWeeks || []).map(i => {
    const p = points[i];
    if (!p) return "";
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--gold)" stroke="var(--bg)" stroke-width="1"/>`;
  }).join("");

  return `<svg class="pg-momentum-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${areaPath}" fill="var(--accent)" opacity="0.35" stroke="none"/>
    <polyline points="${polyline}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${prDots}
  </svg>`;
}

/**
 * Beeswarm plot: every set as a dot, x = week column, y = load.
 * Deterministic jitter (no d3-force dependency).
 * @param {{sets: Array, weeks: number, pr_load_kg: number}} data
 * @param {{weightUnit?: "kg"|"lbs", mobile?: boolean}} opts
 */
export function beeswarmPlot(data, { weightUnit = "kg", mobile = false } = {}) {
  if (!data || !data.sets || data.sets.length === 0) return "";
  const W = 800, H = mobile ? 220 : 280;
  const pad = { top: 30, right: 20, bottom: 40, left: 60 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const weeks = data.weeks;
  const effectiveCols = mobile ? Math.ceil(weeks / 2) : weeks;
  const dotRadius = mobile ? 3 : 4;
  const prDotRadius = mobile ? 4 : 5;

  const loads = data.sets.map(s => s.load_kg);
  const minL = Math.min(...loads) * 0.95;
  const maxL = Math.max(Math.max(...loads), data.pr_load_kg) * 1.08;
  const range = maxL - minL || 1;
  const yFor = (loadKg) => pad.top + chartH - ((loadKg - minL) / range) * chartH;
  const xForCol = (col) => pad.left + (col + 0.5) * (chartW / effectiveCols);

  const dispLoad = (kg) => weightUnit === "lbs" ? Math.round(kg * 2.20462) : Math.round(kg);

  let svg = `<svg class="pg-beeswarm" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  for (let i = 0; i < 5; i++) {
    const y = pad.top + (chartH / 4) * i;
    svg += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3"/>`;
  }
  for (let i = 0; i < 5; i++) {
    const y = pad.top + (chartH / 4) * i;
    const v = maxL - (range / 4) * i;
    svg += `<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" fill="var(--dim)">${dispLoad(v)}</text>`;
  }

  if (data.pr_load_kg > 0) {
    const prY = yFor(data.pr_load_kg);
    svg += `<line x1="${pad.left}" y1="${prY.toFixed(1)}" x2="${W - pad.right}" y2="${prY.toFixed(1)}" stroke="var(--gold)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"/>`;
    svg += `<text x="${W - pad.right - 10}" y="${(prY - 4).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" font-weight="600" fill="var(--gold)">PR ${dispLoad(data.pr_load_kg)}</text>`;
  }

  const setsByCol = {};
  for (const s of data.sets) {
    const col = mobile ? Math.floor(s.week_idx / 2) : s.week_idx;
    if (!setsByCol[col]) setsByCol[col] = [];
    setsByCol[col].push(s);
  }
  for (const col of Object.keys(setsByCol)) {
    const sets = setsByCol[col];
    const xBase = xForCol(Number(col));
    const jitterWidth = Math.min(14, (chartW / effectiveCols) * 0.35);
    sets.forEach((s, i) => {
      const seed = (s.performed_at || "").length + i * 7 + Number(col) * 13;
      const jitter = Math.sin(seed * 1.3) * jitterWidth;
      const x = xBase + jitter;
      const y = yFor(s.load_kg);
      const isCurrent = Number(col) === (effectiveCols - 1);
      if (s.is_pr) {
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${prDotRadius}" fill="var(--gold)" stroke="var(--bg)" stroke-width="1.5"/>`;
      } else if (isCurrent) {
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotRadius}" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5"/>`;
      } else {
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotRadius}" fill="var(--accent)" opacity="0.7"/>`;
      }
    });
  }

  if (mobile) {
    const positions = [0, Math.floor(effectiveCols / 2), effectiveCols - 1];
    const labels = ["START", "MID", "NOW"];
    positions.forEach((col, i) => {
      const x = xForCol(col);
      const fill = i === positions.length - 1 ? "var(--accent)" : "var(--dim)";
      svg += `<text x="${x.toFixed(1)}" y="${(H - pad.bottom + 18).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="9" fill="${fill}" font-weight="${i === positions.length - 1 ? 600 : 400}">${labels[i]}</text>`;
    });
  } else {
    for (let i = 0; i < effectiveCols; i++) {
      const x = xForCol(i);
      const label = i === effectiveCols - 1 ? "NOW" : `W${i + 1}`;
      const fill = i === effectiveCols - 1 ? "var(--accent)" : "var(--dim)";
      const weight = i === effectiveCols - 1 ? 600 : 400;
      svg += `<text x="${x.toFixed(1)}" y="${(H - pad.bottom + 18).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="9" fill="${fill}" font-weight="${weight}">${label}</text>`;
    }
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Zone River stream chart. 5 stacked streams across weekly columns.
 * @param {{weeks: Array}} data
 * @param {{mobile?: boolean}} opts
 */
export function zoneRiver(data, { mobile = false } = {}) {
  if (!data || !data.weeks || data.weeks.length === 0) return "";
  const weeks = data.weeks;
  const N = weeks.length;
  const W = 800, H = mobile ? 180 : 240;
  const pad = { top: 10, right: 20, bottom: 30, left: 20 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const xForCol = (i) => pad.left + (i / (N - 1)) * chartW;

  const order = ["z5", "z4", "z3", "z2", "z1"];
  const perWeekTotals = weeks.map(w => order.reduce((s, k) => s + (w[k] || 0), 0));
  const maxTotal = Math.max(...perWeekTotals, 1);

  const stacks = weeks.map((w, i) => {
    const total = perWeekTotals[i];
    const scale = total > 0 ? (chartH * (total / maxTotal)) / total : 0;
    const heights = {};
    for (const k of order) heights[k] = (w[k] || 0) * scale;
    let y = pad.top + chartH - (chartH * (total / maxTotal));
    const yTop = {};
    for (const k of order) {
      yTop[k] = y;
      y += heights[k];
    }
    return { yTop, heights };
  });

  let svg = `<svg class="pg-zone-river" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;

  for (const k of order) {
    let d = "";
    for (let i = 0; i < N; i++) {
      const x = xForCol(i);
      const y = stacks[i].yTop[k];
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
    }
    for (let i = N - 1; i >= 0; i--) {
      const x = xForCol(i);
      const y = stacks[i].yTop[k] + stacks[i].heights[k];
      d += "L" + x.toFixed(1) + "," + y.toFixed(1) + " ";
    }
    d += "Z";
    svg += `<path fill="var(--${k})" opacity="0.85" d="${d}"/>`;
  }

  if (mobile) {
    const positions = [0, Math.floor(N / 2), N - 1];
    const labels = ["W1", `W${Math.floor(N / 2) + 1}`, "NOW"];
    positions.forEach((col, i) => {
      const x = xForCol(col);
      const fill = i === positions.length - 1 ? "var(--accent)" : "var(--dim)";
      const weight = i === positions.length - 1 ? 600 : 400;
      svg += `<text x="${x.toFixed(1)}" y="${(H - pad.bottom + 18).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="9" fill="${fill}" font-weight="${weight}">${labels[i]}</text>`;
    });
  } else {
    for (let i = 0; i < N; i++) {
      const x = xForCol(i);
      const label = i === N - 1 ? "NOW" : `W${i + 1}`;
      const fill = i === N - 1 ? "var(--accent)" : "var(--dim)";
      const weight = i === N - 1 ? 600 : 400;
      svg += `<text x="${x.toFixed(1)}" y="${(H - pad.bottom + 18).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="9" fill="${fill}" font-weight="${weight}">${label}</text>`;
    }
  }

  svg += `</svg>`;
  return svg;
}

/**
 * Control chart with mean + UCL/LCL/UWL/LWL lines.
 * @param {{weeks: Array, mean_acwr: number}} data
 * @param {{mobile?: boolean}} opts
 */
export function controlChart(data, { mobile = false } = {}) {
  if (!data || !data.weeks || data.weeks.length === 0) return "";
  const W = 800, H = mobile ? 220 : 260;
  const pad = { top: 20, right: mobile ? 20 : 80, bottom: 40, left: 50 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const yMin = 0.5, yMax = 2.0;
  const yFor = (v) => pad.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const xFor = (i) => pad.left + (i / (data.weeks.length - 1)) * chartW;

  const yCut = (v) => Math.max(pad.top, Math.min(pad.top + chartH, yFor(v)));

  let svg = `<svg class="pg-control-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;

  // Background bands
  svg += `<rect x="${pad.left}" y="${yCut(1.3).toFixed(1)}" width="${chartW}" height="${(yCut(0.8) - yCut(1.3)).toFixed(1)}" fill="var(--success,#15803d)" opacity="0.08"/>`;
  svg += `<rect x="${pad.left}" y="${yCut(1.5).toFixed(1)}" width="${chartW}" height="${(yCut(1.3) - yCut(1.5)).toFixed(1)}" fill="var(--warning)" opacity="0.06"/>`;
  svg += `<rect x="${pad.left}" y="${yCut(0.8).toFixed(1)}" width="${chartW}" height="${(yCut(0.5) - yCut(0.8)).toFixed(1)}" fill="var(--warning)" opacity="0.06"/>`;
  svg += `<rect x="${pad.left}" y="${pad.top}" width="${chartW}" height="${(yCut(1.5) - pad.top).toFixed(1)}" fill="var(--danger)" opacity="0.06"/>`;

  // Grid
  for (let v = 0.5; v <= 2.0; v += 0.3) {
    const y = yFor(v);
    svg += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3"/>`;
  }

  // Reference lines
  svg += `<line x1="${pad.left}" y1="${yFor(1.5).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(1.5).toFixed(1)}" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  svg += `<line x1="${pad.left}" y1="${yFor(1.3).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(1.3).toFixed(1)}" stroke="var(--warning)" stroke-width="1" stroke-dasharray="3 3"/>`;
  svg += `<line x1="${pad.left}" y1="${yFor(1.0).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(1.0).toFixed(1)}" stroke="var(--success,#15803d)" stroke-width="1.5"/>`;
  svg += `<line x1="${pad.left}" y1="${yFor(0.8).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(0.8).toFixed(1)}" stroke="var(--warning)" stroke-width="1" stroke-dasharray="3 3"/>`;
  svg += `<line x1="${pad.left}" y1="${yFor(0.5).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(0.5).toFixed(1)}" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="6 4"/>`;

  if (!mobile) {
    svg += `<text x="${(W - pad.right - 6).toFixed(1)}" y="${(yFor(1.5) - 3).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" fill="var(--danger)">UCL · 1.5</text>`;
    svg += `<text x="${(W - pad.right - 6).toFixed(1)}" y="${(yFor(1.3) - 3).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" fill="var(--warning)">UWL · 1.3</text>`;
    svg += `<text x="${(W - pad.right - 6).toFixed(1)}" y="${(yFor(1.0) - 3).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" font-weight="600" fill="var(--success,#15803d)">MEAN · 1.0</text>`;
    svg += `<text x="${(W - pad.right - 6).toFixed(1)}" y="${(yFor(0.8) + 11).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" fill="var(--warning)">LWL · 0.8</text>`;
  }

  for (let v = 0.5; v <= 2.0; v += 0.3) {
    const y = yFor(v);
    svg += `<text x="${(pad.left - 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" fill="var(--dim)">${v.toFixed(1)}</text>`;
  }

  const pts = data.weeks.map((w, i) => (w.acwr != null ? { x: xFor(i), y: yFor(w.acwr), w } : null));
  let pathD = "";
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p) {
      pathD += (pathD === "" || !pts[i - 1] ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1) + " ";
    }
  }
  if (pathD) {
    svg += `<path d="${pathD}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`;
  }

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    const isCurrent = i === pts.length - 1;
    const ooc = p.w.out_of_control;
    if (isCurrent) {
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="var(--accent)" stroke="var(--bg)" stroke-width="2"/>`;
    } else if (ooc) {
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="var(--danger)" stroke="var(--bg)" stroke-width="2"/>`;
    } else {
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--ink)" stroke="var(--bg)" stroke-width="1.5"/>`;
    }
  }

  const N = data.weeks.length;
  if (mobile) {
    const positions = [0, Math.floor(N / 2), N - 1];
    const labels = ["W1", `W${Math.floor(N / 2) + 1}`, "NOW"];
    positions.forEach((idx, i) => {
      const x = xFor(idx);
      const fill = i === positions.length - 1 ? "var(--accent)" : "var(--dim)";
      const weight = i === positions.length - 1 ? 600 : 400;
      svg += `<text x="${x.toFixed(1)}" y="${(H - pad.bottom + 18).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="9" fill="${fill}" font-weight="${weight}">${labels[i]}</text>`;
    });
  } else {
    const ticks = [0, Math.floor(N / 4), Math.floor(N / 2), Math.floor(3 * N / 4), N - 1];
    ticks.forEach((idx) => {
      const x = xFor(idx);
      const label = idx === N - 1 ? "NOW" : `W${idx + 1}`;
      const fill = idx === N - 1 ? "var(--accent)" : "var(--dim)";
      const weight = idx === N - 1 ? 600 : 400;
      svg += `<text x="${x.toFixed(1)}" y="${(H - pad.bottom + 18).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="9" fill="${fill}" font-weight="${weight}">${label}</text>`;
    });
  }

  svg += `</svg>`;
  return svg;
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
    <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.2)" font-family="system-ui,sans-serif">${msg}</text>
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
