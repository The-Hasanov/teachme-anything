(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const saved = vscode.getState() ?? {};
  let tab = saved.tab ?? 'path';
  let state = { data: undefined, screen: undefined, up: false };
  const widths = new Map();
  let slot;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pct = (done, total) => total ? Math.round(done / total * 100) : 0;
  const icon = (name) => `<i class="codicon codicon-${name}" aria-hidden="true"></i>`;
  const bar = (key, done, total) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i data-key="${esc(key)}" data-w="${pct(done, total)}"></i></div>`;

  const PHASE_ICON = { ok: 'pass-filled', now: 'record', todo: 'circle-outline' };
  const TONE_ICON = { right: 'pass', wrong: 'warning', wait: 'loading', info: 'info' };
  const TABS = ['path', 'control'];
  const LESSON_TEXT = { done: 'Done', now: '', ready: 'Ready', writing: 'Being written…', failed: 'Could not be written', todo: 'Written when you get there' };

  function header(d) {
    const p = pct(d.overall.done, d.overall.total);
    return `<header class="hero">
      <div class="badge" aria-hidden="true">${icon('mortar-board')}</div>
      <div class="hero-text"><h1>${esc(d.title)}</h1><p class="goal">${esc(d.goal)}</p></div>
      <div class="ring" data-p="${p}"><span>${p}%</span></div>
    </header>
    <div class="overall"><span>${esc(d.overall.label)}</span>${bar('overall', d.overall.done, d.overall.total)}</div>`;
  }

  function pathTab(d) {
    return `<section class="phases">${d.phases.map((p, i) => `
      <article class="card phase ${p.mark}" data-i="${i}">
        <div class="phase-head">${icon(PHASE_ICON[p.mark])}<h2>${esc(p.title)}</h2><span class="count">${p.done} of ${p.total} lesson${p.total === 1 ? '' : 's'}</span>${p.mark === 'todo' ? '' : `<button class="ghost" data-reset="${esc(p.id)}" data-title="${esc(p.title)}" title="Reset ${esc(p.title)}" aria-label="Reset ${esc(p.title)}">${icon('discard')}</button>`}</div>
        ${bar(`phase-${i}`, p.done, p.total)}
        <ol class="lessons">${p.lessons.map(l => `
          <li class="lesson ${l.status}"><span class="dot" aria-hidden="true"></span><span class="name">${esc(l.title)}</span><span class="state">${esc(l.steps ?? LESSON_TEXT[l.status])}</span></li>`).join('')}
        </ol>
      </article>`).join('')}</section>`;
  }

  function controlTab(s, up) {
    const actions = s?.actions ?? [];
    return `<section class="control">
      <article class="card status ${up ? 'up' : 'down'}">
        <span class="pulse" aria-hidden="true"></span>
        <div><h2>${up ? 'Connected to Claude Code' : 'Not connected'}</h2>
        <p>${up ? 'Buttons here drive the lesson running in your Claude Code session.' : 'Start Claude Code in this folder; the lesson connects by itself.'}</p></div>
      </article>
      ${s ? `<article class="card now">
        <span class="label">Now</span><h2>${esc(s.title)}</h2>
        ${s.progress ? `<div class="overall"><span>${esc(s.progress.label)}</span>${bar('step', s.progress.done, s.progress.total)}</div>` : ''}
        ${s.result ? `<p class="result ${esc(s.result.tone)}">${icon(TONE_ICON[s.result.tone] ?? 'info')}<span>${esc(s.result.text)}</span></p>` : ''}
        ${actions.length ? `<div class="actions">${actions.map(a => `<button class="btn ${a.primary ? 'primary' : ''}" data-press="${esc(a.id)}" ${up ? '' : 'disabled'}>${esc(a.label)}</button>`).join('')}</div>` : ''}
      </article>` : ''}
      <article class="card tools">
        <span class="label">Open</span>
        <div class="actions">
          <button class="btn" data-lesson>${icon('book')} Lesson view</button>
          <button class="btn" data-press="tutor" ${up ? '' : 'disabled'}>${icon('terminal')} Lesson in the terminal</button>
          <button class="btn" data-press="progress" ${up ? '' : 'disabled'}>${icon('graph-line')} Progress</button>
        </div>
      </article>
      <article class="card danger">
        <span class="label">Start over</span>
        <p>Clears every answer, hint and review for the course. Your practice files are backed up first. You can also have every lesson written again.</p>
        <div class="actions"><button class="btn warn" data-reset="" data-title="${esc(state.data?.title ?? 'the course')}" ${up ? '' : 'disabled'}>${icon('discard')} Reset the whole course</button></div>
      </article>
    </section>`;
  }

  // anim: 'first' plays every entrance, 'tab' only the tab body's; plain updates play none and keep focus
  function render(anim = '', focus = selector(document.activeElement)) {
    const d = state.data;
    root.className = anim;
    if (!d) { root.innerHTML = `<div class="empty">${icon('mortar-board')}<p>No course yet. In Claude Code, say "teach me &lt;subject&gt;".</p></div>`; return; }
    root.innerHTML = `${header(d)}
      <nav class="tabs" role="tablist">
        <button role="tab" id="tab-path" data-tab="path" aria-selected="${tab === 'path'}" aria-controls="panel" tabindex="${tab === 'path' ? 0 : -1}">${icon('milestone')} Path</button>
        <button role="tab" id="tab-control" data-tab="control" aria-selected="${tab === 'control'}" aria-controls="panel" tabindex="${tab === 'control' ? 0 : -1}">${icon('remote')} Control</button>
        <span class="indicator"></span>
      </nav>
      <main class="tab-body" id="panel" role="tabpanel" aria-labelledby="tab-${tab}" data-tab="${tab}">${tab === 'path' ? pathTab(d) : controlTab(state.screen, state.up)}</main>`;
    root.querySelectorAll('[data-i]').forEach(el => el.style.setProperty('--i', el.dataset.i));
    animateBars(); // before placeIndicator reads layout, so bars start from their last width, not from 0
    placeIndicator();
    if (focus) root.querySelector(focus)?.focus();
    vscode.postMessage({ type: 'rendered', tab, text: root.innerText });
  }

  function selector(el) {
    const k = ['tab', 'press', 'reset', 'lesson'].find(k => el?.dataset?.[k] !== undefined);
    return k && `[data-${k}="${el.dataset[k]}"]`;
  }

  function show(t) { tab = t; vscode.setState({ tab }); render('tab', `[data-tab="${t}"]`); }

  function placeIndicator() {
    const on = root.querySelector('.tabs [aria-selected="true"]');
    const ind = root.querySelector('.tabs .indicator');
    if (!on || !ind) return;
    const put = ([w, x]) => { ind.style.width = `${w}px`; ind.style.transform = `translateX(${x}px)`; };
    // A redraw makes a new indicator: start it where the last one was, so it slides only when the tab changes
    if (slot) { ind.style.transition = 'none'; put(slot); void ind.offsetWidth; ind.style.transition = ''; }
    put(slot = [on.offsetWidth, on.offsetLeft]);
  }

  function animateBars() {
    const fills = [...root.querySelectorAll('.bar > i')];
    const ring = root.querySelector('.ring');
    for (const f of fills) f.style.width = `${widths.get(f.dataset.key) ?? 0}%`;
    ring?.style.setProperty('--p', widths.get('ring') ?? 0);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const f of fills) { f.style.width = `${f.dataset.w}%`; widths.set(f.dataset.key, Number(f.dataset.w)); }
      if (ring) { ring.style.setProperty('--p', ring.dataset.p); widths.set('ring', Number(ring.dataset.p)); }
    }));
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.tab) return show(t.dataset.tab);
    if (t.dataset.lesson !== undefined) return vscode.postMessage({ type: 'lesson' });
    if (t.dataset.reset !== undefined) return vscode.postMessage({ type: 'reset', phase: t.dataset.reset || undefined, title: t.dataset.title });
    if (t.dataset.press) vscode.postMessage({ type: 'press', press: { action: t.dataset.press } });
  });
  root.addEventListener('keydown', (e) => {
    if (!e.target.dataset?.tab) return;
    const i = TABS.indexOf(tab), n = TABS.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    show(TABS[to]);
  });
  window.addEventListener('resize', placeIndicator);
  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') { const first = !state.data; state = e.data; render(first ? 'first' : ''); }
    if (e.data.type === 'click') root.querySelector(e.data.selector)?.click();
  });
  render('first');
  vscode.postMessage({ type: 'ready' });
})();
