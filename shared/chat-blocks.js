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

function createNode(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text) {
    node.textContent = text;
  }
  return node;
}

function getToolLabel(name) {
  const normalized = String(name || "").toLowerCase();
  const labels = {
    bash: "Bash",
    read: "Read file",
    write: "Write file",
    edit: "Edit file",
    search: "Search",
    retrieval: "Retrieval",
    grep: "Search files",
    glob: "File scan",
    rail_update: "System status",
    metrics_card: "System status",
    insight_card: "Evidence card",
    sources_card: "Sources",
    group: "Grouped tools",
  };

  return labels[normalized] || normalizeText(name || "Tool", 40);
}

function toolIcon(name) {
  const normalized = String(name || "").toLowerCase();
  const icons = {
    bash: "terminal",
    read: "article",
    write: "edit_document",
    edit: "difference",
    search: "search",
    retrieval: "search_insights",
    grep: "search",
    glob: "folder_open",
    rail_update: "monitoring",
    metrics_card: "monitoring",
    insight_card: "science",
    sources_card: "library_books",
    group: "account_tree",
  };

  return icons[normalized] || "auto_awesome";
}

function toneClass(tone) {
  const normalized = String(tone || "").toLowerCase();
  if (["good", "high", "strong", "success", "done"].includes(normalized)) {
    return "is-good";
  }
  if (["medium", "moderate", "running"].includes(normalized)) {
    return "is-medium";
  }
  if (["caution", "low", "weak", "error"].includes(normalized)) {
    return "is-caution";
  }
  return "";
}

function toneWeight(tone) {
  const normalized = String(tone || "").toLowerCase();
  if (["good", "high", "strong", "success", "done"].includes(normalized)) {
    return 0.88;
  }
  if (["medium", "moderate", "running"].includes(normalized)) {
    return 0.66;
  }
  if (["caution", "low", "weak", "error"].includes(normalized)) {
    return 0.42;
  }
  return 0.56;
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt || completedAt < startedAt) {
    return "";
  }

  const duration = completedAt - startedAt;
  if (duration < 1000) {
    return `${duration}ms`;
  }
  return `${(duration / 1000).toFixed(1)}s`;
}

function renderStatusBadge({
  status = "",
  startedAt = 0,
  completedAt = 0,
  isError = false,
  isRunning = false,
} = {}) {
  const badge = createNode("span", `chat-tool-status ${toneClass(isError ? "error" : status || (isRunning ? "running" : ""))}`.trim());
  const icon = createNode("span", "material-symbols-outlined chat-tool-status-icon");
  const label = createNode("span", "chat-tool-status-label");

  const duration = formatDuration(startedAt, completedAt);

  if (isRunning) {
    icon.textContent = "progress_activity";
    label.textContent = duration || "Running";
    badge.append(icon, label);
    return badge;
  }
  if (isError) {
    icon.textContent = "error";
    label.textContent = duration ? `${duration} Error` : "Error";
    badge.append(icon, label);
    return badge;
  }
  icon.textContent = "check_circle";
  label.textContent = duration || normalizeText(status || "Done", 18);
  badge.append(icon, label);
  return badge;
}

function createBubbleShell(role = "assistant") {
  const shell = createNode("div", `chat-bubble chat-bubble-${role}`);
  return shell;
}

function createToolCardShell({
  tool = "",
  title = "",
  status = "",
  bodyClass = "",
  collapsible = false,
  expanded = false,
  isError = false,
  isRunning = false,
  startedAt = 0,
  completedAt = 0,
} = {}) {
  const card = createNode(
    "section",
    `chat-card chat-tool-card ${isRunning ? "is-running" : ""} ${isError ? "is-error" : ""}`.trim()
  );
  const header = createNode("div", "chat-tool-header");
  const left = createNode("div", "chat-tool-header-left");

  if (collapsible) {
    const toggle = createNode("button", "chat-tool-toggle");
    toggle.type = "button";
    toggle.className = "chat-tool-toggle material-symbols-outlined";
    toggle.textContent = expanded ? "keyboard_arrow_down" : "keyboard_arrow_right";
    toggle.setAttribute("aria-label", expanded ? "Collapse card" : "Expand card");
    left.appendChild(toggle);
  }

  left.appendChild(createNode("span", "material-symbols-outlined chat-tool-icon", toolIcon(tool)));

  const titleGroup = createNode("div", "chat-tool-title-group");
  titleGroup.appendChild(createNode("strong", "chat-tool-title", normalizeText(title || getToolLabel(tool), 60)));
  if (tool) {
    titleGroup.appendChild(createNode("span", "chat-tool-subtitle", getToolLabel(tool)));
  }
  left.appendChild(titleGroup);

  header.append(left, renderStatusBadge({ status, startedAt, completedAt, isError, isRunning }));

  const body = createNode("div", `chat-card-body chat-tool-body${bodyClass ? ` ${bodyClass}` : ""}`);

  card.append(header, body);

  if (collapsible) {
    const toggle = left.querySelector(".chat-tool-toggle");
    const setExpanded = (nextExpanded) => {
      card.classList.toggle("is-collapsed", !nextExpanded);
      body.hidden = !nextExpanded;
      toggle.textContent = nextExpanded ? "keyboard_arrow_down" : "keyboard_arrow_right";
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      toggle.setAttribute("aria-label", nextExpanded ? "Collapse card" : "Expand card");
    };

    setExpanded(Boolean(expanded));
    header.addEventListener("click", () => setExpanded(card.classList.contains("is-collapsed")));
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setExpanded(card.classList.contains("is-collapsed"));
    });
  }

  return { card, header, body };
}

function createInfoCardShell({ title = "", status = "Done", bodyClass = "", tool = "insight_card" } = {}) {
  return createToolCardShell({
    tool,
    title,
    status,
    bodyClass,
    collapsible: true,
    expanded: true,
  });
}

export function renderTextBlock(block) {
  const wrapper = createBubbleShell(block?.role || "assistant");
  wrapper.classList.add("chat-text-block");
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

    const bulletLines = lines.filter((line) => /^(?:[-*]|\u2022)\s+/.test(line));
    const proseLines = lines.filter((line) => !/^(?:[-*]|\u2022)\s+/.test(line));

    if (proseLines.length) {
      wrapper.appendChild(createNode("p", "", proseLines.join(" ")));
    }

    if (bulletLines.length) {
      const list = createNode("ul");
      for (const line of bulletLines) {
        list.appendChild(createNode("li", "", line.replace(/^(?:[-*]|\u2022)\s+/, "")));
      }
      wrapper.appendChild(list);
    }
  }

  return wrapper;
}

export function renderToolUseBlock(block) {
  const { card, body } = createToolCardShell({
    tool: block?.tool || "",
    title: block?.title || "",
    status: block?.status || "",
    isError: block?.status === "error",
    isRunning: block?.status === "running",
    startedAt: Number(block?.startedAt || 0),
    completedAt: Number(block?.completedAt || 0),
    collapsible: true,
    expanded: block?.status === "running",
  });

  const copy = createNode(
    "p",
    "chat-tool-copy",
    normalizeText(block?.description || block?.text || "", 240)
  );
  body.appendChild(copy);
  return card;
}

export function renderMetricsCard(block) {
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

  const { card, body } = createInfoCardShell({
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
    const item = createNode("div", "chat-metric-item");
    item.append(
      createNode("span", "chat-metric-label", metric.label),
      createNode("strong", "chat-metric-value", metric.value)
    );
    body.appendChild(item);
  }

  return card;
}

export function renderArticleVizCard(block) {
  const data = block?.data || {};
  const { card, body } = createInfoCardShell({
    title: data?.title || block?.title || "Research snapshot",
    bodyClass: "chat-article-viz",
  });

  const sections = [];

  if (Array.isArray(data?.timeline) && data.timeline.length) {
    const section = createNode("section", "chat-viz-section");
    section.appendChild(createNode("h5", "chat-viz-heading", "Publication timeline"));

    const timeline = createNode("div", "chat-viz-bars");
    const maxCount = Math.max(...data.timeline.map((item) => Number(item?.count || 0)), 1);

    for (const item of data.timeline) {
      const row = createNode("div", "chat-viz-row");
      row.appendChild(createNode("span", "chat-viz-label", normalizeText(item?.label || "", 30)));
      const track = createNode("div", "chat-viz-track");
      const fill = createNode("div", "chat-viz-fill");
      fill.style.width = `${Math.round((Number(item?.count || 0) / maxCount) * 100)}%`;
      track.appendChild(fill);
      row.append(track, createNode("span", "chat-viz-value", String(item?.count || 0)));
      timeline.appendChild(row);
    }

    section.appendChild(timeline);
    sections.push(section);
  }

  if (Array.isArray(data?.typeMix) && data.typeMix.length) {
    const section = createNode("section", "chat-viz-section");
    section.appendChild(createNode("h5", "chat-viz-heading", "Study mix"));

    const chips = createNode("div", "chat-viz-chip-grid");
    for (const item of data.typeMix) {
      const chip = createNode("div", "chat-viz-chip");
      chip.append(
        createNode("span", "chat-viz-chip-label", normalizeText(item?.label || "", 44)),
        createNode("strong", "chat-viz-chip-value", String(item?.count || 0))
      );
      chips.appendChild(chip);
    }
    section.appendChild(chips);
    sections.push(section);
  }

  if (Array.isArray(data?.journals) && data.journals.length) {
    const section = createNode("section", "chat-viz-section");
    section.appendChild(createNode("h5", "chat-viz-heading", "Top journals"));
    const list = createNode("ul", "chat-viz-journal-list");
    for (const item of data.journals) {
      const li = createNode("li", "chat-viz-journal-item");
      li.append(
        createNode("span", "chat-viz-journal-name", normalizeText(item?.label || "", 60)),
        createNode("span", "chat-viz-journal-count", String(item?.count || 0))
      );
      list.appendChild(li);
    }
    section.appendChild(list);
    sections.push(section);
  }

  if (!sections.length) {
    return null;
  }
  for (const section of sections) {
    body.appendChild(section);
  }

  return card;
}

export function renderQuantVizCard(block) {
  const data = block?.data || {};
  const findings = Array.isArray(data?.findings) ? data.findings.slice(0, 4) : [];

  if (!findings.length) {
    return null;
  }

  const { card, body } = createInfoCardShell({
    title: data?.title || block?.title || "Quantitative findings",
    bodyClass: "chat-quant-viz",
  });

  if (!findings.length) {
    body.appendChild(
      createNode(
        "p",
        "chat-card-footnote",
        "No clear quantitative finding was extracted from the top retrieved excerpts."
      )
    );
    return card;
  }

  const groups = findings.reduce((map, finding) => {
    const key = `${finding?.label || "Finding"}:${finding?.unitType || "value"}`;
    const items = map.get(key) || [];
    items.push(finding);
    map.set(key, items);
    return map;
  }, new Map());

  for (const [key, groupFindings] of groups.entries()) {
    const [label, unitType] = key.split(":");
    const group = createNode("section", "chat-quant-group");
    const head = createNode("div", "chat-quant-group-head");
    head.append(
      createNode("h5", "chat-quant-label", normalizeText(label, 100)),
      createNode("span", "chat-quant-unit", normalizeText(unitType, 32))
    );
    group.appendChild(head);

    if (groupFindings.length >= 2) {
      const values = groupFindings
        .map((finding) => Number(finding?.normalizedValue || 0))
        .filter((value) => Number.isFinite(value));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const spread = Math.max(max - min, 1);
      const range = createNode("div", "chat-quant-range");
      const rail = createNode("div", "chat-quant-range-rail");

      for (const finding of groupFindings) {
        const dot = createNode("span", "chat-quant-dot");
        dot.title = `${finding?.displayValue || ""} ${finding?.sourceTitle || ""}`.trim();
        dot.style.left = `${Math.round(((Number(finding?.normalizedValue || 0) - min) / spread) * 100)}%`;
        rail.appendChild(dot);
      }

      const scale = createNode("div", "chat-quant-scale");
      scale.append(
        createNode("span", "", normalizeText(groupFindings.find((item) => Number(item?.normalizedValue || 0) === min)?.displayValue || String(min), 24)),
        createNode("span", "", normalizeText(groupFindings.find((item) => Number(item?.normalizedValue || 0) === max)?.displayValue || String(max), 24))
      );
      range.append(rail, scale);
      group.appendChild(range);
    }

    for (const finding of groupFindings) {
      const row = createNode("article", "chat-quant-row");
      const value = createNode("strong", "chat-quant-value", normalizeText(finding?.displayValue || "", 40));
      const content = createNode("div", "chat-quant-content");
      if (finding?.sentence) {
        content.appendChild(createNode("p", "chat-quant-sentence", trimSnippet(finding.sentence, 220)));
      }
      const meta = createNode("div", "chat-quant-meta");
      const sourceLabel = [finding?.sourceTitle, finding?.sourceId, finding?.detail].filter(Boolean).join(" - ");
      if (sourceLabel) {
        meta.appendChild(createNode("span", "chat-quant-source", normalizeText(sourceLabel, 160)));
      }
      content.appendChild(meta);
      row.append(value, content);
      group.appendChild(row);
    }

    body.appendChild(group);
  }

  return card;
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

function renderActionGridGraphic(cardData) {
  const { card, body } = createInfoCardShell({
    title: cardData?.title || "Key takeaways",
    bodyClass: "chat-insight-card",
  });

  const grid = createNode("div", "chat-action-columns");
  for (const column of Array.isArray(cardData?.columns) ? cardData.columns.slice(0, 3) : []) {
    const panel = createNode("section", `chat-action-panel ${toneClass(column?.tone)}`.trim());
    panel.appendChild(
      createNode("h4", "chat-action-heading", normalizeText(column?.label || "Actions", 80))
    );
    const list = createNode("ul", "chat-action-list");
    for (const item of Array.isArray(column?.items) ? column.items.slice(0, 4) : []) {
      list.appendChild(createNode("li", "", normalizeText(item, 180)));
    }
    panel.appendChild(list);
    grid.appendChild(panel);
  }

  if (!grid.childNodes.length) {
    return null;
  }
  body.appendChild(grid);

  return card;
}

function renderWatchoutsGraphic(cardData) {
  const { card, body } = createInfoCardShell({
    title: cardData?.title || "Watchouts",
    status: String(cardData?.tone || "").toUpperCase(),
    bodyClass: "chat-insight-card",
  });

  const list = createNode("ul", "chat-watchout-list");
  for (const item of Array.isArray(cardData?.items) ? cardData.items.slice(0, 4) : []) {
    const text = normalizeText(item, 180);
    if (text) {
      list.appendChild(createNode("li", "", text));
    }
  }
  if (!list.childNodes.length) {
    return null;
  }
  body.appendChild(list);
  return card;
}

function renderSourceHighlightsGraphic(cardData) {
  const items = Array.isArray(cardData?.items) ? cardData.items.slice(0, 3) : [];

  if (!items.length) {
    return null;
  }

  const { card, body } = createInfoCardShell({
    title: cardData?.title || "Best sources",
    bodyClass: "chat-source-preview",
    tool: "sources_card",
  });

  for (const item of items) {
    const row = createNode("article", "chat-source-item");
    row.appendChild(createNode("strong", "", normalizeText(item?.title || "Source", 140)));

    if (item?.meta) {
      row.appendChild(createNode("div", "chat-source-meta", normalizeText(item.meta, 160)));
    }

    const takeaway = trimSnippet(item?.takeaway || item?.summary || "", 220);
    if (takeaway) {
      row.appendChild(createNode("p", "", takeaway));
    }

    const links = Array.isArray(item?.links) ? item.links.slice(0, 2) : [];
    if (links.length) {
      const linkRow = createNode("div", "chat-source-links");
      for (const link of links) {
        if (!link?.url) {
          continue;
        }
        const anchor = createNode("a", "chat-source-link", normalizeText(link?.label || "Open", 40));
        anchor.href = link.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        linkRow.appendChild(anchor);
      }
      if (linkRow.childNodes.length) {
        row.appendChild(linkRow);
      }
    }

    body.appendChild(row);
  }

  return card;
}

function renderMetricGridGraphic(cardData) {
  const metrics = Array.isArray(cardData?.metrics) ? cardData.metrics.slice(0, 4) : [];
  const populated = metrics.filter((m) => normalizeText(m?.value || "", 40) || normalizeText(m?.label || "", 80));
  if (!populated.length) {
    return null;
  }

  const { card, body } = createInfoCardShell({
    title: cardData?.eyebrow || cardData?.title || "Quantitative findings",
    bodyClass: "chat-insight-card",
  });

  if (cardData?.title && cardData?.eyebrow) {
    body.appendChild(createNode("h3", "chat-insight-title", normalizeText(cardData.title, 120)));
  }

  const grid = createNode("div", "chat-metric-grid chat-metric-grid-quad");
  for (const metric of populated) {
    const tile = createNode("div", `chat-metric-tile ${toneClass(metric?.tone)}`.trim());
    tile.appendChild(createNode("div", "chat-metric-tile-value", normalizeText(metric?.value || "", 40)));
    tile.appendChild(createNode("div", "chat-metric-tile-label", normalizeText(metric?.label || "", 80)));
    if (metric?.sub) {
      tile.appendChild(createNode("div", "chat-metric-tile-sub", normalizeText(metric.sub, 80)));
    }
    grid.appendChild(tile);
  }
  body.appendChild(grid);

  // Per-tile sentence excerpts with source attribution.
  const evidenceList = createNode("ul", "chat-metric-evidence");
  for (const metric of populated) {
    if (!metric?.sentence && !metric?.sourceTitle) continue;
    const li = createNode("li", "chat-metric-evidence-item");
    if (metric.sentence) {
      li.appendChild(createNode("p", "chat-metric-evidence-sentence", trimSnippet(metric.sentence, 220)));
    }
    const sourceLabel = [metric.sourceTitle, metric.sourceId].filter(Boolean).join(" - ");
    if (sourceLabel) {
      li.appendChild(createNode("span", "chat-metric-evidence-source", normalizeText(sourceLabel, 160)));
    }
    evidenceList.appendChild(li);
  }
  if (evidenceList.childNodes.length) {
    body.appendChild(evidenceList);
  }

  return card;
}

function renderInsightCard(block) {
  const cardData = block?.data || {};
  const type = String(cardData?.type || "").toLowerCase();

  let card = null;
  if (type === "metric_grid") card = renderMetricGridGraphic(cardData);
  else if (type === "action_grid") card = renderActionGridGraphic(cardData);
  else if (type === "watchouts") card = renderWatchoutsGraphic(cardData);
  else if (type === "source_highlights") card = renderSourceHighlightsGraphic(cardData);

  if (card && type) {
    card.classList.add(`chat-insight--${type}`);
    card.dataset.cardType = type;
  }
  return card;
}

export function renderSearchCard(block) {
  const results = Array.isArray(block?.result) ? block.result : Array.isArray(block?.data) ? block.data : [];
  const { card, body } = createToolCardShell({
    tool: block?.tool || "search",
    title: block?.title || block?.input?.query || "Search",
    status: results.length ? `${results.length} results` : "",
    bodyClass: "chat-search-results",
    collapsible: true,
    expanded: true,
  });

  for (const result of results.slice(0, 5)) {
    const row = createNode("article", "chat-search-row");
    row.appendChild(createNode("strong", "chat-search-title", normalizeText(result?.title || "Result", 140)));
    const secondary = normalizeText(result?.url || result?.path || "", 120);
    if (secondary) {
      row.appendChild(createNode("div", "chat-search-secondary", secondary));
    }
    const snippet = trimSnippet(result?.snippet || result?.summary || "", 180);
    if (snippet) {
      row.appendChild(createNode("p", "chat-search-snippet", snippet));
    }
    body.appendChild(row);
  }

  return card;
}

export function renderBashCard(block) {
  const { card, body } = createToolCardShell({
    tool: "bash",
    title: block?.title || "Terminal",
    status: block?.status || "",
    bodyClass: "chat-bash-card",
    isError: block?.status === "error" || /exit code:\s*[1-9]/i.test(String(block?.result || "")),
    isRunning: block?.status === "running",
    startedAt: Number(block?.startedAt || 0),
    completedAt: Number(block?.completedAt || 0),
    collapsible: true,
    expanded: true,
  });

  const commandStrip = createNode("div", "chat-command-strip");
  commandStrip.append(
    createNode("span", "chat-command-prompt", "$"),
    createNode("code", "chat-command-text", normalizeText(block?.input?.command || "", 240))
  );
  body.appendChild(commandStrip);

  const output = createNode("pre", "chat-terminal-output", String(block?.result || "").trim());
  body.appendChild(output);
  return card;
}

export function renderFileReadCard(block) {
  const { card, body } = createToolCardShell({
    tool: block?.tool || "read",
    title: block?.input?.file_path || block?.title || "File read",
    status: block?.status || "",
    bodyClass: "chat-file-read-card",
    collapsible: true,
    expanded: true,
  });

  const pathRow = createNode("div", "chat-file-path", normalizeText(block?.input?.file_path || "", 180));
  body.appendChild(pathRow);
  body.appendChild(createNode("pre", "chat-code-pane", String(block?.result || "").trim()));
  return card;
}

export function renderDiffBlock(block) {
  const { card, body } = createToolCardShell({
    tool: block?.tool || "edit",
    title: block?.input?.file_path || block?.title || "File change",
    status: block?.status || "",
    bodyClass: "chat-diff-card",
    collapsible: true,
    expanded: true,
  });

  body.appendChild(createNode("div", "chat-file-path", normalizeText(block?.input?.file_path || "", 180)));
  body.appendChild(createNode("pre", "chat-code-pane", String(block?.result || "").trim()));
  return card;
}

export function renderGroupBlock(block) {
  const { card, body } = createToolCardShell({
    tool: "group",
    title: block?.label || "Grouped tools",
    status: block?.status || "",
    bodyClass: "chat-group-card",
    collapsible: true,
    expanded: true,
  });

  for (const item of Array.isArray(block?.items) ? block.items : []) {
    const row = createNode("div", "chat-group-row");
    row.append(
      createNode("span", "chat-group-tool", getToolLabel(item?.tool || "")),
      createNode("span", `chat-group-status ${toneClass(item?.status)}`.trim(), normalizeText(item?.summary || item?.status || "", 120))
    );
    body.appendChild(row);
  }

  return card;
}

export function renderToolResultBlock(block) {
  const tool = String(block?.tool || "").toLowerCase();

  if (tool === "bash") {
    return renderBashCard(block);
  }
  if (tool === "read") {
    return renderFileReadCard(block);
  }
  if (tool === "write" || tool === "edit") {
    return renderDiffBlock(block);
  }
  if (tool === "search" || tool === "retrieval" || tool === "grep" || tool === "glob") {
    return renderSearchCard(block);
  }
  if (tool === "article_viz") {
    return renderArticleVizCard(block);
  }
  if (tool === "quant_viz") {
    return renderQuantVizCard(block);
  }
  if (tool === "insight_card") {
    return renderInsightCard(block);
  }
  if (tool === "metrics_card" || tool === "rail_update") {
    return renderMetricsCard(block);
  }

  return renderToolUseBlock(block);
}

export function renderBlock(block) {
  if (!block || typeof block !== "object") {
    return null;
  }

  switch (block.type) {
    case "text":
      return renderTextBlock(block);
    case "tool_use":
      return renderToolUseBlock(block);
    case "tool_result":
      return renderToolResultBlock(block);
    case "group":
      return renderGroupBlock(block);
    default:
      return null;
  }
}

export function renderMessageBlocks(blocks) {
  const fragment = document.createDocumentFragment();

  for (const block of Array.isArray(blocks) ? blocks : []) {
    const node = renderBlock(block);
    if (node) {
      fragment.appendChild(node);
    }
  }

  return fragment;
}
