function createCardShell({ title = "", status = "", bodyClass = "" } = {}) {
  const card = document.createElement("section");
  card.className = "chat-card";

  if (title || status) {
    const header = document.createElement("div");
    header.className = "chat-card-header";

    if (title) {
      const titleNode = document.createElement("h4");
      titleNode.className = "chat-card-title";
      titleNode.textContent = title;
      header.appendChild(titleNode);
    }

    if (status) {
      const statusNode = document.createElement("span");
      statusNode.className = "chat-card-status";
      statusNode.textContent = status;
      header.appendChild(statusNode);
    }

    card.appendChild(header);
  }

  const body = document.createElement("div");
  body.className = `chat-card-body${bodyClass ? ` ${bodyClass}` : ""}`;
  card.appendChild(body);

  return { card, body };
}

function normalizeText(value, maxLength = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function trimSnippet(value, maxLength = 180) {
  const text = normalizeText(value, maxLength + 1);
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

export function renderTextBlock(block) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-text-block";
  const source = String(block?.text || "").trim();

  if (!source) {
    return wrapper;
  }

  const chunks = source
    .split(/\r?\n\s*\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const bulletLines = lines.filter((line) => /^[-*•]\s+/.test(line));
    const proseLines = lines.filter((line) => !/^[-*•]\s+/.test(line));

    if (proseLines.length) {
      const paragraph = document.createElement("p");
      paragraph.textContent = proseLines.join(" ");
      wrapper.appendChild(paragraph);
    }

    if (bulletLines.length) {
      const list = document.createElement("ul");
      for (const line of bulletLines) {
        const item = document.createElement("li");
        item.textContent = line.replace(/^[-*•]\s+/, "");
        list.appendChild(item);
      }
      wrapper.appendChild(list);
    }
  }

  return wrapper;
}

export function renderToolUseBlock(block) {
  const { card, body } = createCardShell({
    title: block?.title || block?.tool || "Tool",
    status: block?.status || "",
  });

  const copy = document.createElement("p");
  copy.textContent = normalizeText(block?.description || block?.text || "", 220);
  body.appendChild(copy);
  return card;
}

function renderSourcesCard(block) {
  const sources = Array.isArray(block?.data) ? block.data.slice(0, 3) : [];
  const { card, body } = createCardShell({
    title: block?.title || "Sources",
    status: sources.length ? `${sources.length} attached` : "",
    bodyClass: "chat-source-preview",
  });

  if (!sources.length) {
    const empty = document.createElement("p");
    empty.textContent = "No sources attached.";
    body.appendChild(empty);
    return card;
  }

  for (const source of sources) {
    const item = document.createElement("article");
    item.className = "chat-source-item";

    const title = document.createElement("strong");
    title.textContent = normalizeText(source?.title || "Source", 180);
    item.appendChild(title);

    const meta = [
      source?.author_label || "",
      source?.journal || "",
      source?.year || source?.published_at || "",
      source?.pmid ? `PMID ${source.pmid}` : "",
    ]
      .filter(Boolean)
      .join(" - ");

    if (meta) {
      const metaNode = document.createElement("div");
      metaNode.className = "chat-source-meta";
      metaNode.textContent = meta;
      item.appendChild(metaNode);
    }

    const snippet = trimSnippet(source?.excerpt || source?.why_it_matters || "", 150);
    if (snippet) {
      const snippetNode = document.createElement("p");
      snippetNode.textContent = snippet;
      item.appendChild(snippetNode);
    }

    body.appendChild(item);
  }

  return card;
}

function renderMetricsCard(block) {
  const data = block?.data || {};
  const confidenceScore = Number(data?.confidence?.score || data?.score || 0);
  const confidencePercent = Math.round(Math.max(0, Math.min(confidenceScore, 1)) * 100);
  const sourceCount = Number(
    data?.sourceCount ??
      (Array.isArray(data?.sources) ? data.sources.length : data?.source_count || 0)
  );
  const synthesisMode = normalizeText(
    data?.synthesisMode || data?.debug?.synthesis_mode || data?.mode || "synthesized",
    60
  );

  const { card, body } = createCardShell({
    title: block?.title || "System Status",
    status: normalizeText(data?.confidence?.label || data?.label || "", 40),
    bodyClass: "chat-metric-grid",
  });

  const metrics = [
    { label: "Confidence", value: `${confidencePercent}%` },
    { label: "Source count", value: String(sourceCount) },
    { label: "Mode", value: synthesisMode.replace(/[_:]+/g, " ") },
  ];

  for (const metric of metrics) {
    const item = document.createElement("div");
    item.className = "chat-metric-item";

    const label = document.createElement("span");
    label.className = "chat-metric-label";
    label.textContent = metric.label;

    const value = document.createElement("strong");
    value.className = "chat-metric-value";
    value.textContent = metric.value;

    item.append(label, value);
    body.appendChild(item);
  }

  return card;
}

function toneClass(tone) {
  const normalized = String(tone || "").toLowerCase();
  if (["good", "high", "strong"].includes(normalized)) {
    return "is-good";
  }
  if (["medium", "moderate"].includes(normalized)) {
    return "is-medium";
  }
  if (["caution", "low", "weak"].includes(normalized)) {
    return "is-caution";
  }
  return "";
}

function toneWeight(tone) {
  const normalized = String(tone || "").toLowerCase();
  if (["good", "high", "strong"].includes(normalized)) {
    return 0.88;
  }
  if (["medium", "moderate"].includes(normalized)) {
    return 0.66;
  }
  if (["caution", "low", "weak"].includes(normalized)) {
    return 0.42;
  }
  return 0.56;
}

function buildSparklinePath(points, width = 180, height = 54) {
  if (!points.length) {
    return "";
  }

  if (points.length === 1) {
    const y = height - points[0] * height;
    return `M 0 ${y.toFixed(2)} L ${width} ${y.toFixed(2)}`;
  }

  return points
    .map((point, index) => {
      const x = (width / (points.length - 1)) * index;
      const y = height - point * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderVerdictHero(cardData) {
  const { card, body } = createCardShell({
    title: cardData?.eyebrow || "Evidence Verdict",
    bodyClass: "chat-insight-card",
  });

  const title = document.createElement("h3");
  title.className = "chat-insight-title";
  title.textContent = normalizeText(cardData?.title || "Evidence snapshot", 180);
  body.appendChild(title);

  const copy = trimSnippet(cardData?.body || "", 220);
  if (copy) {
    const paragraph = document.createElement("p");
    paragraph.className = "chat-insight-copy";
    paragraph.textContent = copy;
    body.appendChild(paragraph);
  }

  const metricRow = document.createElement("div");
  metricRow.className = "chat-chip-row";

  for (const metric of Array.isArray(cardData?.metrics) ? cardData.metrics.slice(0, 4) : []) {
    const chip = document.createElement("div");
    chip.className = `chat-data-chip ${toneClass(metric?.tone)}`.trim();

    const label = document.createElement("span");
    label.className = "chat-data-chip-label";
    label.textContent = normalizeText(metric?.label || "", 40);

    const value = document.createElement("strong");
    value.className = "chat-data-chip-value";
    value.textContent = normalizeText(metric?.value || "", 60);

    chip.append(label, value);
    metricRow.appendChild(chip);
  }

  if (metricRow.childNodes.length) {
    body.appendChild(metricRow);
  }

  const metrics = Array.isArray(cardData?.metrics) ? cardData.metrics.slice(0, 4) : [];
  if (metrics.length) {
    const comparison = document.createElement("div");
    comparison.className = "chat-comparison-bars";

    for (const metric of metrics) {
      const row = document.createElement("div");
      row.className = "chat-comparison-row";

      const head = document.createElement("div");
      head.className = "chat-comparison-head";

      const label = document.createElement("span");
      label.className = "chat-comparison-label";
      label.textContent = normalizeText(metric?.label || "", 40);

      const value = document.createElement("span");
      value.className = "chat-comparison-value";
      value.textContent = normalizeText(metric?.value || "", 60);

      head.append(label, value);

      const track = document.createElement("div");
      track.className = "chat-comparison-track";

      const fill = document.createElement("div");
      fill.className = `chat-comparison-fill ${toneClass(metric?.tone)}`.trim();
      fill.style.width = `${Math.round(toneWeight(metric?.tone) * 100)}%`;

      track.appendChild(fill);
      row.append(head, track);
      comparison.appendChild(row);
    }

    body.appendChild(comparison);
  }

  return card;
}

function renderEvidenceProfile(cardData) {
  const { card, body } = createCardShell({
    title: cardData?.title || "Evidence profile",
    bodyClass: "chat-insight-card",
  });

  const list = document.createElement("div");
  list.className = "chat-score-list";

  for (const item of Array.isArray(cardData?.items) ? cardData.items.slice(0, 4) : []) {
    const score = Number(item?.score || 0);
    const max = Math.max(1, Number(item?.max || 10));
    const ratio = Math.max(0, Math.min(score / max, 1));

    const row = document.createElement("div");
    row.className = "chat-score-row";

    const labelRow = document.createElement("div");
    labelRow.className = "chat-score-head";

    const label = document.createElement("span");
    label.className = "chat-score-label";
    label.textContent = normalizeText(item?.label || "", 80);

    const value = document.createElement("span");
    value.className = "chat-score-value";
    value.textContent = `${score}/${max}`;

    labelRow.append(label, value);

    const track = document.createElement("div");
    track.className = "chat-score-track";

    const fill = document.createElement("div");
    fill.className = `chat-score-fill ${toneClass(item?.tone)}`.trim();
    fill.style.width = `${Math.round(ratio * 100)}%`;
    track.appendChild(fill);

    row.append(labelRow, track);
    list.appendChild(row);
  }

  if (list.childNodes.length) {
    body.appendChild(list);
  }

  const scoredItems = (Array.isArray(cardData?.items) ? cardData.items : [])
    .slice(0, 4)
    .map((item) => {
      const score = Number(item?.score || 0);
      const max = Math.max(1, Number(item?.max || 10));
      return Math.max(0, Math.min(score / max, 1));
    });

  if (scoredItems.length >= 2) {
    const sparkline = document.createElement("div");
    sparkline.className = "chat-sparkline";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 180 54");
    svg.setAttribute("aria-hidden", "true");

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const path = buildSparklinePath(scoredItems);
    const areaPath = `${path} L 180 54 L 0 54 Z`;

    area.setAttribute("d", areaPath);
    area.setAttribute("class", "chat-sparkline-area");

    line.setAttribute("d", path);
    line.setAttribute("class", "chat-sparkline-line");

    svg.append(area, line);

    for (let index = 0; index < scoredItems.length; index += 1) {
      const point = scoredItems[index];
      const x = scoredItems.length === 1 ? 90 : (180 / (scoredItems.length - 1)) * index;
      const y = 54 - point * 54;
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x.toFixed(2));
      dot.setAttribute("cy", y.toFixed(2));
      dot.setAttribute("r", "2.75");
      dot.setAttribute("class", "chat-sparkline-dot");
      svg.appendChild(dot);
    }

    const label = document.createElement("span");
    label.className = "chat-sparkline-label";
    label.textContent = "Evidence shape";

    sparkline.append(svg, label);
    body.appendChild(sparkline);
  }

  if (cardData?.footnote) {
    const note = document.createElement("p");
    note.className = "chat-card-footnote";
    note.textContent = trimSnippet(cardData.footnote, 180);
    body.appendChild(note);
  }

  return card;
}

function renderActionGrid(cardData) {
  const { card, body } = createCardShell({
    title: cardData?.title || "Key takeaways",
    bodyClass: "chat-insight-card",
  });

  const grid = document.createElement("div");
  grid.className = "chat-action-columns";

  for (const column of Array.isArray(cardData?.columns) ? cardData.columns.slice(0, 3) : []) {
    const panel = document.createElement("section");
    panel.className = `chat-action-panel ${toneClass(column?.tone)}`.trim();

    const heading = document.createElement("h4");
    heading.className = "chat-action-heading";
    heading.textContent = normalizeText(column?.label || "Actions", 80);
    panel.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "chat-action-list";

    for (const item of Array.isArray(column?.items) ? column.items.slice(0, 4) : []) {
      const li = document.createElement("li");
      li.textContent = normalizeText(item, 180);
      list.appendChild(li);
    }

    panel.appendChild(list);
    grid.appendChild(panel);
  }

  if (grid.childNodes.length) {
    body.appendChild(grid);
  }

  return card;
}

function renderWatchouts(cardData) {
  const { card, body } = createCardShell({
    title: cardData?.title || "Watchouts",
    status: String(cardData?.tone || "").toUpperCase(),
    bodyClass: "chat-insight-card",
  });

  const list = document.createElement("ul");
  list.className = "chat-watchout-list";

  for (const item of Array.isArray(cardData?.items) ? cardData.items.slice(0, 4) : []) {
    const li = document.createElement("li");
    li.textContent = normalizeText(item, 180);
    list.appendChild(li);
  }

  if (list.childNodes.length) {
    body.appendChild(list);
  }

  return card;
}

function renderInsightCard(block) {
  const cardData = block?.data || {};
  const type = String(cardData?.type || "").toLowerCase();

  if (type === "verdict_hero") {
    return renderVerdictHero(cardData);
  }

  if (type === "evidence_profile") {
    return renderEvidenceProfile(cardData);
  }

  if (type === "action_grid") {
    return renderActionGrid(cardData);
  }

  if (type === "watchouts") {
    return renderWatchouts(cardData);
  }

  return null;
}

export function renderToolResultBlock(block) {
  const tool = String(block?.tool || "").toLowerCase();

  if (tool === "sources" || tool === "sources_card" || tool === "retrieval") {
    return renderSourcesCard(block);
  }

  if (tool === "insight_card") {
    return renderInsightCard(block) || renderToolUseBlock(block);
  }

  if (tool === "metrics_card" || tool === "rail_update") {
    return renderMetricsCard(block);
  }

  return renderToolUseBlock(block);
}

export function renderMessageBlocks(blocks) {
  const fragment = document.createDocumentFragment();

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") {
      continue;
    }

    let node = null;

    if (block.type === "text") {
      node = renderTextBlock(block);
    } else if (block.type === "tool_use") {
      node = renderToolUseBlock(block);
    } else if (block.type === "tool_result") {
      node = renderToolResultBlock(block);
    }

    if (node) {
      fragment.appendChild(node);
    }
  }

  return fragment;
}
