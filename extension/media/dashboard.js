(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const saved = vscode.getState() ?? {};
  let tab = saved.tab ?? 'path';
  let state = { data: undefined, screen: undefined, up: false };
  const widths = new Map();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pct = (done, total) => total ? Math.round(done / total * 100) : 0;
  const icon = (name) => `<i class="codicon codicon-${name}" aria-hidden="true"></i>`;
  const bar = (key, done, total) => `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i data-key="${esc(key)}" data-w="${pct(done, total)}"></i></div>`;

  const PHASE_ICON = { ok: 'pass-filled', now: 'record', todo: 'circle-outline' };
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
      <article class="card phase ${p.mark}" style="--i:${i}">
        <div class="phase-head">${icon(PHASE_ICON[p.mark])}<h2>${esc(p.title)}</h2><span class="count">${p.done} of ${p.total} lessons</span>${p.mark === 'todo' ? '' : `<button class="ghost" data-reset="${esc(p.id)}" data-title="${esc(p.title)}" title="Reset ${esc(p.title)}" aria-label="Reset ${esc(p.title)}">${icon('discard')}</button>`}</div>
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
        ${s.result ? `<p class="result ${esc(s.result.tone)}">${esc(s.result.text)}</p>` : ''}
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

  function render() {
    const d = state.data;
    if (!d) { root.innerHTML = `<div class="empty">${icon('mortar-board')}<p>No course yet. In Claude Code, say "teach me &lt;subject&gt;".</p></div>`; return; }
    root.innerHTML = `${header(d)}
      <nav class="tabs" role="tablist">
        <button role="tab" data-tab="path" aria-selected="${tab === 'path'}">${icon('milestone')} Path</button>
        <button role="tab" data-tab="control" aria-selected="${tab === 'control'}">${icon('remote')} Control</button>
        <span class="indicator"></span>
      </nav>
      <main class="tab-body" data-tab="${tab}">${tab === 'path' ? pathTab(d) : controlTab(state.screen, state.up)}</main>`;
    placeIndicator();
    animateBars();
    vscode.postMessage({ type: 'rendered', tab, text: root.innerText });
  }

  function placeIndicator() {
    const on = root.querySelector('.tabs [aria-selected="true"]');
    const ind = root.querySelector('.tabs .indicator');
    if (on && ind) { ind.style.width = `${on.offsetWidth}px`; ind.style.transform = `translateX(${on.offsetLeft}px)`; }
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
    if (t.dataset.tab) { tab = t.dataset.tab; vscode.setState({ tab }); render(); return; }
    if (t.dataset.lesson !== undefined) return vscode.postMessage({ type: 'lesson' });
    if (t.dataset.reset !== undefined) return vscode.postMessage({ type: 'reset', phase: t.dataset.reset || undefined, title: t.dataset.title });
    if (t.dataset.press) vscode.postMessage({ type: 'press', press: { action: t.dataset.press } });
  });
  window.addEventListener('resize', placeIndicator);
  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') { state = e.data; render(); }
    if (e.data.type === 'click') root.querySelector(e.data.selector)?.click();
  });
  render();
  vscode.postMessage({ type: 'ready' });
})();
