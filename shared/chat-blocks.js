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

export function renderToolResultBlock(block) {
  const tool = String(block?.tool || "").toLowerCase();

  if (tool === "sources" || tool === "sources_card" || tool === "retrieval") {
    return renderSourcesCard(block);
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
