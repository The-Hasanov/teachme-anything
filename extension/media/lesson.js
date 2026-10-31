(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let screen = vscode.getState()?.screen;
  let connected = true;
  let isWaiting = false;
  let showKeys = false;
  let refocus;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = (p) => p
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c.replace(/\*/g, '&#42;')}</code>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const table = (p) => {
    const rows = p.split('\n').filter(l => !/^\|\s*-/.test(l.trim())).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim())));
    return `<table class="data"><thead><tr>${rows[0].map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  const block = (p) => {
    const ls = p.split('\n');
    const all = (re) => ls.every(l => re.test(l.trim()));
    if (all(/^\|/)) return table(p);
    if (all(/^[-*] /)) return `<ul class="doc">${ls.map(l => `<li>${inline(l.trim().slice(2))}</li>`).join('')}</ul>`;
    if (all(/^\d+[.)] /)) return `<ol class="doc">${ls.map(l => `<li>${inline(l.trim().replace(/^\d+[.)] /, ''))}</li>`).join('')}</ol>`;
    if (all(/^&gt; ?/)) return `<blockquote>${inline(ls.map(l => l.trim().replace(/^&gt; ?/, '')).join('<br>'))}</blockquote>`;
    const h = /^#{1,4} (.+)$/.exec(p.trim());
    if (h && ls.length === 1) return `<h3>${inline(h[1])}</h3>`;
    return `<p>${inline(p).replace(/\n/g, '<br>')}</p>`;
  };
  const md = (s) => esc(s).split(/\n{2,}/).map(block).join('');
  const COMMENT = { python: '#', py: '#', sh: '#', bash: '#', shell: '#', powershell: '#', ps1: '#', ruby: '#', yaml: '#', toml: '#', r: '#', sql: '--', js: '//', javascript: '//', ts: '//', typescript: '//', java: '//', c: '//', cpp: '//', cs: '//', go: '//', rust: '//', kotlin: '//', swift: '//', php: '//' };
  const KW = {
    python: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    js: 'async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while yield',
    rust: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    sql: 'select from where and or not in is as join left right inner outer on group by order having limit offset insert into values update set delete create table drop alter index primary key distinct union all case when then else end',
    sh: 'if then else elif fi for while do done case esac in function return local export',
  };
  for (const k in KW) KW[k] = new Set(KW[k].split(' '));
  for (const [a, b] of [['py', 'python'], ['javascript', 'js'], ['ts', 'js'], ['typescript', 'js'], ['rs', 'rust'], ['bash', 'sh'], ['shell', 'sh']]) KW[a] = KW[b];
  const CONST = /^(True|False|None|true|false|null|undefined|nil|NULL|TRUE|FALSE)$/;
  const hl = (src, lang) => String(src ?? '').split('\n').map(line => {
    const kw = KW[lang] ?? new Set(), ci = lang === 'sql';
    const marks = lang in COMMENT ? [COMMENT[lang]] : lang ? [] : ['#', '//'];
    let out = '', i = 0;
    while (i < line.length) {
      const ch = line[i];
      const mark = marks.find(m => line.startsWith(m, i) && (i === 0 || /\s/.test(line[i - 1])));
      if (mark) { out += `<span class="t-c">${esc(line.slice(i))}</span>`; break; }
      if (ch === '"' || ch === "'" || (ch === '`' && marks.includes('//'))) {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
        out += `<span class="t-s">${esc(line.slice(i, j + 1))}</span>`;
        i = j + 1;
        continue;
      }
      const num = /^\d+(\.\d+)?/.exec(line.slice(i));
      if (num && (i === 0 || !/[\w.]/.test(line[i - 1]))) { out += `<span class="t-n">${num[0]}</span>`; i += num[0].length; continue; }
      const word = /^[A-Za-z_]\w*/.exec(line.slice(i));
      if (word && (i === 0 || !/\w/.test(line[i - 1]))) {
        const w = word[0];
        const cls = CONST.test(w) ? 't-n' : kw.has(ci ? w.toLowerCase() : w) ? 't-k' : /^\s*\(/.test(line.slice(i + w.length)) ? 't-f' : '';
        out += cls ? `<span class="${cls}">${w}</span>` : w;
        i += w.length;
        continue;
      }
      out += esc(ch);
      i++;
    }
    return out;
  }).join('\n');
  const numbered = (html) => html.split('\n').map(l => `<span class="ln">${l}</span>`).join('\n');
  const OUT_ERR = /^(Traceback|\s+File "|\w*(Error|Exception)\b|error[:[]|fatal:|ERROR\b|FAIL\b)/;
  const OUT_WARN = /^(warning[:[]|Warning\b|WARN\b|hint:)/i;
  const output = (s) => String(s).split('\n').map(l => OUT_ERR.test(l) ? `<span class="t-err">${esc(l)}</span>` : OUT_WARN.test(l) ? `<span class="t-warn">${esc(l)}</span>` : esc(l)).join('\n');
  const icon = (name, label) => `<span class="codicon codicon-${name}" ${label ? `aria-label="${esc(label)}" role="img"` : 'aria-hidden="true"'}></span>`;
  const MARK = { ok: ['pass', 'done'], todo: ['circle-large-outline', 'to do'], fail: ['warning', 'needs attention'], run: ['loading', 'running'], now: ['circle-large-filled', 'current'] };
  const KEY = { enter: 'Enter', h: 'H', a: 'A', b: 'B', g: 'G', p: 'P', u: 'U', s: 'S', d: 'D', e: 'E', c: 'C', left: '←' };
  const TONE_ICON = { right: 'pass', wrong: 'warning', wait: 'loading', info: 'info' };
  const kbd = (a) => a.key && KEY[a.key] ? `<span class="kbd">${KEY[a.key]}</span>` : '';
  const target = (el) => el?.dataset?.action ? `[data-action="${el.dataset.action}"]` : el?.dataset?.choose ? `[data-choose="${el.dataset.choose}"]` : undefined;
  const markIcon = (m) => m === 'right' ? icon('pass', 'right') : m === 'wrong' ? icon('close', 'not right') : '';

  function send(press) {
    if (isWaiting) return;
    isWaiting = true;
    // Taken before the buttons are disabled, which drops focus to the page
    refocus = target(document.activeElement) ?? '.actions .btn';
    document.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const el = 'choose' in press ? document.querySelector(`[data-choose="${press.choose}"]`) : document.querySelector(`[data-action="${press.action}"]`);
    el?.classList.add('pressed');
    vscode.postMessage({ type: 'press', press, t: Date.now() });
  }

  const lines = (ls) => `<ul class="lines">${ls.map(l => `<li><span class="mark-${l.mark}">${icon(...MARK[l.mark])}</span><span>${esc(l.text)}</span>${l.detail ? `<span class="detail">${esc(l.detail)}</span>` : ''}</li>`).join('')}</ul>`;
  const chart = (c) => {
    const n = c.points.length, x = (i) => (8 + i * 190 / (n - 1)).toFixed(1), y = (v) => (54 - v * 48).toFixed(1);
    const grid = [0, 0.5, 1].map(v => `<line class="grid" x1="8" x2="198" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="0" y="${(Number(y(v)) + 2).toFixed(1)}">${v * 100}</text>`).join('');
    return `<figure class="chart"><svg viewBox="0 0 200 60" role="img" aria-label="${esc(c.label)}">${grid}<polyline points="${c.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/><circle cx="${x(n - 1)}" cy="${y(c.points[n - 1])}" r="2"/></svg><figcaption>${esc(c.label)}</figcaption></figure>`;
  };

  function draw(isNew) {
    if (!connected) {
      const place = screen?.progress?.label ?? screen?.title;
      root.innerHTML = `<main class="k-offline"><h1>Teach Me</h1>${place
        ? `<p>Your session ended. Your place is saved: <strong>${esc(place)}</strong>.</p><p class="offline">${icon('debug-disconnect')} Start Claude Code in this folder to continue where you left off.</p>`
        : `<p class="offline">${icon('debug-disconnect')} Start Claude Code in this folder and say <strong>teach me &lt;subject&gt;</strong>. Your lesson appears here.</p>`}</main>`;
      return;
    }
    if (!screen) { root.innerHTML = '<main><p class="offline">Loading your lesson…</p></main>'; return; }
    const s = screen;
    const out = [];
    if (s.progress) out.push(`<div class="progress"><span>${esc(s.progress.label)}</span><span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${s.progress.total}" aria-valuenow="${s.progress.done}"><i data-w="${Math.round(100 * s.progress.done / Math.max(1, s.progress.total))}"></i></span></div>`);
    out.push(`<h1 tabindex="-1">${esc(s.title)}</h1>`);
    if (s.body) out.push(md(s.body));
    if (s.compare) out.push(`<div class="compare">${md(s.compare.text)}<p class="stops"><strong>Where it stops:</strong> ${esc(s.compare.stops)}</p></div>`);
    const lang = s.code?.lang?.toLowerCase();
    if (s.code) out.push(`<pre class="code"><code>${numbered(hl(s.code.source, lang))}</code></pre>`);
    if (s.frame) out.push(`<div class="frame" aria-live="polite"><span class="label">Frame ${s.frame.i + 1} of ${s.frame.n}</span>${s.frame.state ? `<pre><code>${esc(s.frame.state)}</code></pre>` : ''}${s.frame.code ? `<pre class="code"><code>${numbered(hl(s.frame.code, lang))}</code></pre>` : ''}<p>${esc(s.frame.note)}</p></div>`);
    if (s.output !== undefined) out.push(`<div class="output"><span class="label">${icon('terminal')} Output</span><pre><code>${output(s.output)}</code></pre></div>`);
    if (s.table) out.push(`<table class="data trace"><thead><tr>${s.table.columns.map(c => `<th>${esc(c)}</th>`).join('')}<th><span class="sr-only">result</span></th></tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.cells.map((c, k) => `<td class="${r.at === k ? 'now' : c === '?' ? 'blank' : ''}">${r.at === k ? '<span class="sr-only">now: </span>' : ''}${esc(c)}</td>`).join('')}<td class="${r.mark ?? ''}">${markIcon(r.mark)}</td></tr>`).join('')}</tbody></table>`);
    if (s.built) out.push(`<ol class="built" aria-label="Your order">${s.built.length ? s.built.map(b => `<li class="${b.mark ?? ''}"><code>${hl(b.text, lang)}</code>${markIcon(b.mark)}</li>`).join('') : '<li class="empty">Press the lines in order.</li>'}</ol>`);
    if (s.lines) out.push(lines(s.lines));
    if (s.tiles) out.push(`<dl class="tiles">${s.tiles.map(t => `<div><dt>${esc(t.label)}</dt><dd>${esc(t.value)}</dd></div>`).join('')}</dl>`);
    if (s.chart) out.push(chart(s.chart));
    if (s.groups) out.push(s.groups.map(g => `<h2>${esc(g.title)}</h2>${lines(g.lines)}`).join(''));
    if (s.choices) {
      const answered = s.choices.some(c => c.mark) || (s.result && s.result.tone !== 'info' && s.kind === 'question');
      out.push(`<div class="choices" role="group" aria-label="Choices">${s.choices.map(c => {
        const cls = c.mark ?? (answered || c.used ? 'dim' : '');
        if (c.used) return `<button class="choice used" data-choose="${c.n}" disabled aria-label="${c.n}: ${esc(c.text)}, placed"><span class="n">${icon('check')}</span><span>${c.code ? `<code>${esc(c.code)}</code>` : esc(c.text)}</span></button>`;
        const state = c.mark === 'right' ? ', your answer, right' : c.mark === 'wrong' ? ', your answer, not right' : c.mark === 'key' ? ', the right answer' : '';
        return `<button class="choice ${cls}" data-choose="${c.n}" ${answered ? 'disabled' : ''} aria-label="${c.n}: ${esc(c.text)}${c.done ? ', read' : ''}${state}"><span class="n">${c.mark === 'right' || c.mark === 'key' ? icon('pass') : c.mark === 'wrong' ? icon('close') : c.n}</span>${c.code ? `<pre><code>${hl(c.code, lang)}</code></pre>` : `<span>${esc(c.text)}${c.done ? ` <span class="done">${icon('pass')}</span>` : ''}</span>`}${c.mark && c.why ? `<span class="why">${esc(c.why)}</span>` : ''}</button>`;
      }).join('')}</div>`);
    }
    if (s.input) out.push(`<form class="other"><input type="text" maxlength="300" aria-label="${esc(s.input.placeholder)}" placeholder="${esc(s.input.placeholder)}"><button class="btn" type="submit">Send</button></form>`);
    if (s.where) out.push(`<p class="where">${icon('terminal')} ${s.where.file ? `<code>${esc(`${s.where.dir}/${s.where.file}`)}</code> is open in your editor; the Teach Me terminal is in` : 'The Teach Me terminal is in'} <code>${esc(s.where.dir)}</code></p>`);
    if (s.hint) out.push(`<div class="hint"><strong>Hint ${s.hint.level}.</strong> ${esc(s.hint.text)}</div>`);
    const r = s.result;
    out.push(`<div class="result ${r ? r.tone : ''}" role="status" aria-live="polite">${r ? `${icon(TONE_ICON[r.tone] ?? 'info')}<span>${md(r.text)}</span>` : ''}</div>`);
    const primary = s.actions.filter(a => a.primary), quiet = s.actions.filter(a => !a.primary);
    if (s.actions.length) out.push(`<div class="actions">${primary.map(a => `<button class="btn" data-action="${esc(a.id)}">${esc(a.label)}${kbd(a)}</button>`).join('')}${quiet.map(a => `<button class="link" data-action="${esc(a.id)}" ${a.key && KEY[a.key] ? `aria-keyshortcuts="${KEY[a.key]}"` : ''}>${esc(a.label)}${kbd(a)}</button>`).join('')}</div>`);
    if (s.more) out.push(`<details class="more"><summary>More</summary>${md(s.more)}</details>`);
    const keys = [...(s.choices && !s.choices.some(c => c.mark || c.used) ? ['1–8 choose'] : []), ...s.actions.filter(a => KEY[a.key]).map(a => `${KEY[a.key]} ${a.label}`), ...(s.more ? ['M more'] : [])];
    if (keys.length) out.push(`<p class="keys">${showKeys ? `${esc(keys.join(' · '))} · ? hide` : '? keys'}</p>`);
    const y = window.scrollY;
    root.innerHTML = `<main class="k-${esc(s.kind)}${isNew ? ' enter' : ''}">${out.join('')}</main>`;
    window.scrollTo(0, isNew ? 0 : y);
    root.querySelectorAll('.bar > i[data-w]').forEach(f => { f.style.width = `${f.dataset.w}%`; });
    root.querySelectorAll('[data-action]').forEach(b => b.onclick = () => send({ action: b.dataset.action }));
    root.querySelectorAll('[data-choose]').forEach(b => b.onclick = () => send({ choose: Number(b.dataset.choose) }));
    root.querySelectorAll('form.other').forEach(f => f.onsubmit = (e) => { e.preventDefault(); const text = f.querySelector('input').value.trim(); if (text) send({ text }); });
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'screen') {
      const n = m.screen;
      // Explore's next section keeps the title, so a new place or text without a verdict is a new screen too
      const isNew = !screen || screen.title !== n.title || screen.kind !== n.kind || ((!n.result || n.result.tone === 'info') && (screen.progress?.label !== n.progress?.label || screen.body !== n.body));
      const keep = refocus ?? target(document.activeElement);
      refocus = undefined;
      screen = n;
      isWaiting = false;
      vscode.setState({ screen });
      draw(isNew);
      const el = !isNew && keep && root.querySelector(keep);
      (isNew ? root.querySelector('h1') : el && !el.disabled ? el : keep && root.querySelector('.actions .btn'))?.focus({ preventScroll: true });
    }
    if (m.type === 'connection') { connected = m.up; if (!connected) isWaiting = false; draw(false); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !screen || e.target.tagName === 'INPUT') return;
    const k = e.key === 'ArrowLeft' ? 'left' : e.key.toLowerCase();
    const has = (id) => screen.actions.some(a => a.id === id);
    if (/^[1-8]$/.test(k) && screen.choices?.some(c => c.n === Number(k)) && !screen.choices.some(c => c.mark)) { send({ choose: Number(k) }); e.preventDefault(); return; }
    if (k === 'enter' && !['BUTTON', 'SUMMARY', 'A'].includes(document.activeElement?.tagName)) {
      const p = screen.actions.find(a => a.primary);
      if (p) { send({ action: p.id }); e.preventDefault(); }
      return;
    }
    const byKey = screen.actions.find(a => a.key === k);
    if (byKey) { send({ action: byKey.id }); e.preventDefault(); return; }
    if (k === 'm') { const d = document.querySelector('details.more'); if (d) d.open = !d.open; }
    if (k === '?') { const keep = target(document.activeElement); showKeys = !showKeys; draw(false); if (keep) root.querySelector(keep)?.focus({ preventScroll: true }); }
  });

  draw(false);
  vscode.postMessage({ type: 'ready' });
})();
