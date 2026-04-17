// Landing hero demo — three-rotation loop.
// Phases per rotation: composer-typing → send-flight → thinking →
// intro-stream → widget-skeleton → widget-filled → cite-pill → thread-swap.
// Stylized only — widgets are pre-rendered DOM toggled via data-rotation.
// Reduced-motion users see rotation A in its final state, no loop.

let started = false;
let stopped = false;

export function stop() {
  stopped = true;
}

export function start() {
  if (started) return;
  started = true;

  const demoRoot   = document.getElementById('demo');
  const main       = document.querySelector('.demo-main');
  if (!demoRoot || !main) return;

  const composerInput = document.getElementById('demo-composer-input');
  const composerHint  = document.getElementById('demo-composer-hint');
  const userBubble    = document.getElementById('demo-user-bubble');
  const introText     = document.getElementById('demo-intro-text');
  const citePill      = document.getElementById('demo-cite-pill');
  const threadTitle   = document.getElementById('demo-thread-title');
  const threadMeta    = document.getElementById('demo-thread-meta');
  const sideItems     = document.querySelectorAll('.demo-side .side-item[data-slot]');

  const ROTATIONS = [
    {
      id: 'b',
      slot: 'creatine',
      prompt: 'Creatine vs. beta-alanine — which actually works?',
      threadTitle: 'Creatine vs. beta-alanine',
      chromeTitle: 'emersus.ai — creatine vs beta-alanine',
      intro: 'Both work, but not equally. Creatine has the broader, stronger literature.',
      cite: { tag: 'Kreider et al · J Int Soc Sports Nutr · 2017', grade: 'HIGH', gradeClass: 'strong' }
    },
    {
      id: 'c',
      slot: 'cut-macros',
      prompt: "I'm 82 kg and want to cut. What's my TDEE?",
      threadTitle: 'Cutting calories on 82 kg',
      chromeTitle: 'emersus.ai — cut macros',
      intro: 'Mifflin-St Jeor + 1.55 activity multiplier. A 20% cut lands here:',
      cite: { tag: 'Mifflin-St Jeor · Am J Clin Nutr · 1990', grade: 'STANDARD', gradeClass: 'std' }
    },
    {
      id: 'a',
      slot: 'protein',
      prompt: 'How much protein per day for hypertrophy?',
      threadTitle: 'Protein intake for hypertrophy',
      chromeTitle: 'emersus.ai — protein intake',
      intro: 'The evidence centers on <strong>1.6–2.2 g/kg/day</strong>. Above ~1.6, gains plateau.',
      cite: { tag: 'Morton et al · Br J Sports Med · 2018', grade: 'HIGH', gradeClass: 'strong' }
    }
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function typeComposer(text, speed, jitter) {
    composerInput.innerHTML = '<span class="typed"></span><span class="caret"></span>';
    const typedEl = composerInput.querySelector('.typed');
    for (let i = 0; i < text.length; i++) {
      typedEl.textContent += text[i];
      await sleep(speed + (Math.random() * jitter * 2 - jitter));
    }
  }

  async function streamText(el, html, speed) {
    el.innerHTML = '';
    const tokens = html.split(/(<[^>]+>)/).filter(Boolean);
    let plain = '';
    for (const tok of tokens) {
      if (tok.startsWith('<')) { plain += tok; el.innerHTML = plain; continue; }
      for (const ch of tok) {
        plain += ch;
        el.innerHTML = plain;
        await sleep(speed);
      }
    }
  }

  async function countTo(el, target, duration) {
    const start = Number((el.textContent || '').replace(/[^\d-]/g, '')) || 0;
    const t0 = performance.now();
    return new Promise((resolve) => {
      function frame(t) {
        const k = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - k, 2);
        const val = Math.round(start + (target - start) * eased);
        el.textContent = val.toLocaleString();
        if (k < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function setActiveSidebar(slot) {
    sideItems.forEach((el) => {
      el.classList.toggle('active', el.dataset.slot === slot);
    });
  }

  function renderCite(cite) {
    citePill.innerHTML =
      '<span class="tag">' + cite.tag + '</span>' +
      '<span class="grade ' + cite.gradeClass + '">' + cite.grade + '</span>';
  }

  function showThinkingDots() {
    introText.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span>';
  }

  function clearBubbleContents() {
    userBubble.textContent = '';
    introText.innerHTML = '';
    citePill.innerHTML = '';
    citePill.classList.remove('show');
  }

  async function animateWidgetC() {
    const tdeeEl = document.getElementById('demo-wgc-tdee');
    const cutEl  = document.getElementById('demo-wgc-cut');
    if (!tdeeEl || !cutEl) return;
    tdeeEl.textContent = '0';
    cutEl.textContent = '0';
    await countTo(tdeeEl, 2630, 700);
    await sleep(200);
    await countTo(cutEl, 2100, 600);
  }

  async function runRotation(cfg) {
    // Thread-swap: fade titles down, update text + sidebar while faded,
    // then fade back in with new content. The chrome title is now static
    // ("emersus.ai — ask anything below") so only the thread header fades.
    main.dataset.swapping = 'true';
    await sleep(220);

    // Reset + update titles + sidebar while faded. Thread-title goes to
    // "New chat" while welcome is visible; swaps to topic on send.
    main.dataset.rotation = cfg.id;
    main.dataset.phase = 'composer';
    clearBubbleContents();
    document.querySelectorAll('.demo-widget').forEach((w) => w.classList.remove('skeleton', 'filled'));
    setActiveSidebar(cfg.slot);
    threadTitle.textContent = 'New chat';
    threadMeta.textContent = '';

    // Fade thread header back in with new text
    main.removeAttribute('data-swapping');
    await sleep(200);

    // Type prompt into composer (faster, snappier)
    await typeComposer(cfg.prompt, 22, 8);
    await sleep(900);

    // Send-flight — user bubble appears, welcome fades, titles update
    userBubble.textContent = cfg.prompt;
    composerHint.classList.add('pulse');
    threadTitle.textContent = cfg.threadTitle;
    threadMeta.textContent = 'EMERSUS · 1 WIDGET';
    main.dataset.phase = 'send';
    await sleep(250);
    composerInput.innerHTML = '<span class="composer-placeholder">Ask anything…</span>';
    composerHint.classList.remove('pulse');
    main.dataset.phase = 'assist';

    // Thinking dots
    showThinkingDots();
    await sleep(400);

    // Intro text streams
    await streamText(introText, cfg.intro, 14);

    // Widget skeleton
    const widget = document.querySelector('.demo-widget[data-widget="' + cfg.id + '"]');
    widget.classList.add('skeleton');
    await sleep(200);

    // Widget filled
    widget.classList.remove('skeleton');
    widget.classList.add('filled');
    if (cfg.id === 'c') { await animateWidgetC(); }
    await sleep(1400);

    // Cite pill
    renderCite(cfg.cite);
    citePill.classList.add('show');

    // Hold full state for read pause before next rotation's swap-in
    await sleep(1800);
  }

  async function loop() {
    let i = 0;
    while (!stopped) {
      await runRotation(ROTATIONS[i % ROTATIONS.length]);
      i++;
    }
  }

  const reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function renderStaticA() {
    // Reduced-motion fallback: render rotation A (protein/dose-response)
    // fully built, since it's the most legible at-a-glance.
    const cfg = ROTATIONS.find((r) => r.id === 'a') || ROTATIONS[0];
    main.dataset.rotation = cfg.id;
    main.dataset.phase = 'assist';
    setActiveSidebar(cfg.slot);
    threadTitle.textContent = cfg.threadTitle;
    threadMeta.textContent = 'EMERSUS · 1 WIDGET';
    userBubble.textContent = cfg.prompt;
    introText.innerHTML = cfg.intro;
    const widget = document.querySelector('.demo-widget[data-widget="' + cfg.id + '"]');
    widget.classList.add('filled');
    renderCite(cfg.cite);
    citePill.classList.add('show');
    composerInput.innerHTML = '<span class="composer-placeholder">Ask anything…</span>';
  }

  if (reduced) { renderStaticA(); return; }

  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { loop(); obs.disconnect(); }
    });
  }, { threshold: 0.3 });
  obs.observe(demoRoot);
}
