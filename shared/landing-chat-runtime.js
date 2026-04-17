// Anonymous landing chat runtime. Mounted into the demo frame after takeover.
// No Supabase, no auth, no persistence beyond localStorage. Talks to
// /api/emersus/anon-ask over SSE. Renders plain text — widget-v2 tool
// events become sign-up placeholders rather than interactive components
// (interactivity requires the React-based chat app, which we don't ship
// to anonymous visitors).

const STORAGE_KEY_PREFIX = 'emersus.anon.';
const LIMIT = 3;

function todayKey() {
  return STORAGE_KEY_PREFIX + new Date().toISOString().slice(0, 10);
}

function loadState() {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return { asked: 0, messages: [], capped: false };
    const parsed = JSON.parse(raw);
    return {
      asked: Number(parsed.asked) || 0,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      capped: Boolean(parsed.capped),
    };
  } catch {
    return { asked: 0, messages: [], capped: false };
  }
}

function saveState(state) {
  try { localStorage.setItem(todayKey(), JSON.stringify(state)); }
  catch { /* quota or disabled — ignore */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function appendUserBubble(msgsContainer, text) {
  const row = el('div', 'msg msg-user');
  row.appendChild(el('div', 'bubble', text));
  msgsContainer.appendChild(row);
  return row;
}

function appendAssistBubble(msgsContainer) {
  const row = el('div', 'msg msg-assist');
  const bubble = el('div', 'bubble');
  row.appendChild(bubble);
  msgsContainer.appendChild(row);
  return { row, bubble };
}

function scrollToBottom(msgsContainer) {
  msgsContainer.scrollTop = msgsContainer.scrollHeight;
}

// Stream a POST SSE response from /api/emersus/anon-ask. Calls:
//   onChunk(textDelta) — each "prose" event's .delta
//   onTool(name, data) — each "tool" event (widget emission)
//   onDone({ sources, confidence }) — terminal success
//   onError({ kind, ... }) — rate_limit | http | stream_error | network
async function streamAnonAsk(question, { onChunk, onTool, onDone, onError }) {
  try {
    const resp = await fetch('/api/emersus/anon-ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (resp.status === 429) {
      const body = await resp.json().catch(() => ({}));
      return onError({ kind: 'rate_limit', asked: body.asked || LIMIT });
    }
    if (!resp.ok) {
      return onError({ kind: 'http', status: resp.status });
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      // Pipeline may ShortCircuit (safety refusal, onboarding guardrail) and
      // return plain JSON. Surface the message and signal a refusal-type done.
      const body = await resp.json().catch(() => ({}));
      const message = body.summary || body.answer_text || body.message || '';
      if (message) onChunk(message);
      return onDone({ shortCircuit: true, body, sources: [] });
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        try {
          const msg = JSON.parse(payload);
          if (msg.type === 'prose') {
            onChunk(msg.delta || '');
          } else if (msg.type === 'tool') {
            onTool && onTool(msg.name, msg.data);
          } else if (msg.type === 'tool_error') {
            console.warn('[anon-ask] tool_error', msg.name, msg.errors);
          } else if (msg.type === 'error') {
            return onError({ kind: 'stream_error', message: msg.message });
          } else if (msg.type === 'done') {
            return onDone({
              sources: msg.sources || [],
              confidence: msg.confidence,
            });
          }
        } catch {
          /* pipeline always emits JSON — ignore unparseable payloads */
        }
      }
    }
    onDone({ sources: [] });
  } catch (err) {
    onError({ kind: 'network', error: err });
  }
}

function renderBlockCard(msgsContainer, composer) {
  const card = el('div', 'anon-block-card');
  card.appendChild(el('p', 'anon-block-card-title',
    "You've used your 3 free questions."));
  card.appendChild(el('p', 'anon-block-card-copy',
    'Sign up — free — to save this conversation and keep asking.'));
  const actions = el('div', 'anon-block-card-actions');
  const signup = el('a', 'btn btn-accent', 'Sign up →');
  signup.href = '/auth/?panel=signup';
  const login = el('a', 'btn', 'Log in');
  login.href = '/auth/';
  actions.append(signup, login);
  card.appendChild(actions);
  msgsContainer.appendChild(card);

  composer.dataset.disabled = 'true';
  const input = composer.querySelector('.composer-input');
  if (input) {
    input.setAttribute('contenteditable', 'false');
    input.innerHTML = '<span class="composer-placeholder">Sign up to ask more</span>';
  }
  setTimeout(() => signup.focus(), 0);
}

export function boot({ msgsContainer, composer, composerInput, threadTitle, threadMeta, sidebar }) {
  const state = loadState();

  // Restore prior messages (if any) from localStorage.
  for (const m of state.messages) {
    if (m.role === 'user') appendUserBubble(msgsContainer, m.text);
    else {
      const { bubble } = appendAssistBubble(msgsContainer);
      bubble.textContent = m.text;
    }
  }
  if (state.capped) renderBlockCard(msgsContainer, composer);
  scrollToBottom(msgsContainer);

  composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  });

  composerInput.setAttribute('contenteditable', 'true');
  composerInput.focus();

  async function handleSubmit() {
    if (state.capped || composer.dataset.disabled === 'true') return;
    const question = (composerInput.textContent || '').trim();
    if (!question) return;

    composerInput.textContent = '';
    appendUserBubble(msgsContainer, question);
    const { bubble } = appendAssistBubble(msgsContainer);
    composer.dataset.disabled = 'true';
    state.messages.push({ role: 'user', text: question });
    scrollToBottom(msgsContainer);

    let accumulated = '';

    await streamAnonAsk(question, {
      onChunk: (delta) => {
        accumulated += delta;
        bubble.textContent = accumulated;
        scrollToBottom(msgsContainer);
      },
      onTool: (_name, _data) => {
        /* Task 9 renders the sign-up placeholder. */
      },
      onDone: (_info) => {
        state.messages.push({ role: 'assistant', text: accumulated });
        state.asked += 1;
        if (state.asked >= LIMIT) {
          state.capped = true;
          renderBlockCard(msgsContainer, composer);
        } else {
          composer.dataset.disabled = 'false';
          composerInput.focus();
        }
        saveState(state);
        scrollToBottom(msgsContainer);
      },
      onError: (errInfo) => {
        if (errInfo.kind === 'rate_limit') {
          state.asked = LIMIT;
          state.capped = true;
          bubble.remove();
          renderBlockCard(msgsContainer, composer);
          saveState(state);
          return;
        }
        bubble.remove();
        const err = el('div', 'anon-inline-error',
          'Something went wrong — try again.');
        msgsContainer.appendChild(err);
        composer.dataset.disabled = 'false';
        composerInput.focus();
        scrollToBottom(msgsContainer);
      },
    });
  }
}
