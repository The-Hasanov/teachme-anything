const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'media', 'lesson.js'), 'utf8');
const listeners = {};
const focused = [], scrolls = [];
const root = { innerHTML: '', querySelectorAll: () => [], querySelector: (sel) => ({ disabled: false, focus: () => focused.push(sel) }) };
const document = { getElementById: () => root, querySelectorAll: () => [], querySelector: () => null, addEventListener: (t, f) => { listeners[t] = f; }, activeElement: null };
const window = { addEventListener: (t, f) => { listeners[t] = f; }, scrollY: 0, scrollTo: (x, y) => scrolls.push(y) };
const sandbox = {
  acquireVsCodeApi: () => ({ getState: () => undefined, setState() {}, postMessage() {} }),
  document, window,
};
new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
const draw = (screen) => { listeners.message({ data: { type: 'screen', screen } }); return root.innerHTML; };

let h = draw({ kind: 'step', title: 'T', actions: [], code: { lang: 'python', source: 'nums = [3, 1]  # "sorted" <b>\nprint("a # b", 2.5)\nx1 = 7' }, output: 'ok\nTraceback (most recent call last):\n  File "s.py", line 1\nValueError: <bad>\nwarning: careful' });
assert.match(h, /<span class="t-c"># &quot;sorted&quot; &lt;b&gt;<\/span>/);
assert.match(h, /<span class="t-s">&quot;a # b&quot;<\/span>/);
assert.match(h, /<span class="t-n">2\.5<\/span>/);
assert.ok(!/x<span class="t-n">1/.test(h), 'a digit inside a name is not a number');
assert.match(h, /<span class="t-err">Traceback/);
assert.match(h, /<span class="t-err">  File &quot;s\.py&quot;/);
assert.match(h, /<span class="t-err">ValueError: &lt;bad&gt;<\/span>/);
assert.match(h, /<span class="t-warn">warning: careful<\/span>/);
assert.ok(!/<b>|<bad>/.test(h), 'nothing from the lesson becomes HTML');

h = draw({ kind: 'step', title: 'T', actions: [], code: { lang: 'sql', source: "SELECT name -- who\nFROM t WHERE id = 'x--y'" } });
assert.match(h, /<span class="t-c">-- who<\/span>/);
assert.match(h, /<span class="t-s">'x--y'<\/span>/);

h = draw({ kind: 'step', title: 'T', actions: [], code: { lang: 'git', source: 'git checkout -- file  # note' } });
assert.ok(!/t-c/.test(h), 'an unknown language gets no comment guess');

h = draw({ kind: 'question', title: 'T', actions: [], code: { lang: 'python', source: 'def top(nums):\n    return sorted(nums) if nums else None\n# if def' } });
assert.match(h, /<main class="k-question/);
assert.equal((h.match(/<span class="ln">/g) ?? []).length, 3, 'one numbered line per source line');
assert.match(h, /<span class="t-k">def<\/span> <span class="t-f">top<\/span>\(nums\)/);
assert.match(h, /<span class="t-k">return<\/span> <span class="t-f">sorted<\/span>\(nums\) <span class="t-k">if<\/span>/);
assert.match(h, /<span class="t-n">None<\/span>/);
assert.match(h, /<span class="t-c"># if def<\/span>/, 'keywords in a comment stay comment');
h = draw({ kind: 'step', title: 'T', actions: [], code: { lang: 'sql', source: 'select count(*) from t' } });
assert.match(h, /<span class="t-k">select<\/span> <span class="t-f">count<\/span>/);

h = draw({ kind: 'step', title: 'T', actions: [], body: '### Why\n\n- one `a*b`\n- *two*\n\n1. first\n2. second\n\n> quoted\n\nSee [docs](https://example.com) and [bad](javascript:alert(1)).\n\n2 * 3 * 4' });
assert.match(h, /<h3>Why<\/h3>/);
assert.match(h, /<ul class="doc"><li>one <code>a&#42;b<\/code><\/li><li><em>two<\/em><\/li><\/ul>/);
assert.match(h, /<ol class="doc"><li>first<\/li><li>second<\/li><\/ol>/);
assert.match(h, /<blockquote>quoted<\/blockquote>/);
assert.match(h, /<a href="https:\/\/example\.com">docs<\/a>/);
assert.ok(!/javascript:/.test(h.replace(/\[bad\]\(javascript:alert\(1\)\)/, '')), 'only https links');
assert.match(h, /<p>2 \* 3 \* 4<\/p>/);
// Explore: a reading section with its sources, its example and what it printed, and keys for moving freely
h = draw({
  kind: 'explore', title: 'Python decorators', progress: { label: 'Section 3 of 8', done: 3, total: 8 },
  body: '### Keeping metadata\n\n`functools.wraps` copies `__name__`.\n\nSources: [functools.wraps](https://docs.python.org/3/library/functools.html#functools.wraps) · [a page](http://example.com)',
  code: { lang: 'python', source: 'import functools\nprint(add.__name__)' }, output: 'add',
  actions: [{ id: 'next', label: 'Next section', primary: true, key: 'enter' }, { id: 'prev', label: 'Previous', key: 'left' }, { id: 'contents', label: 'Contents', key: 'c' }, { id: 'deeper', label: 'Go deeper', key: 'd' }, { id: 'home', label: 'Other topics', key: 'e' }, { id: 'back', label: 'Close', key: 'b' }],
});
assert.match(h, /<main class="k-explore enter">/);
assert.match(h, /<span>Section 3 of 8<\/span>/);
assert.match(h, /<h3>Keeping metadata<\/h3>/);
assert.match(h, /<a href="https:\/\/docs\.python\.org\/3\/library\/functools\.html#functools\.wraps">functools\.wraps<\/a>/);
assert.ok(!/href="http:/.test(h), 'a source that is not https stays text');
assert.match(h, /<span class="t-k">import<\/span> functools/);
assert.match(h, /<div class="output">[\s\S]*<code>add<\/code>/);
assert.match(h, /<button class="btn" data-action="next">Next section<span class="kbd">Enter<\/span><\/button>/);
for (const [id, key] of [['prev', '←'], ['contents', 'C'], ['deeper', 'D'], ['home', 'E'], ['back', 'B']]) assert.match(h, new RegExp(`data-action="${id}" aria-keyshortcuts="${key}"`), `${id} has its key`);
for (const [id, key] of [['prev', '←'], ['contents', 'C']]) assert.match(h, new RegExp(`data-action="${id}" aria-keyshortcuts="${key}">[^<]+<span class="kbd">${key}</span></button>`), `${id} shows its key`);
assert.ok(!/class="keys"/.test(h), 'the key list shows only when ? opens it');
const keydown = (key) => listeners.keydown({ key, target: { tagName: 'BODY' }, preventDefault() {} });
keydown('?');
assert.match(root.innerHTML, /<p class="keys">Enter Next section · ← Previous · C Contents · D Go deeper · E Other topics · B Close · \? hide<\/p>/, "the key list is this screen's buttons");
keydown('?');
assert.ok(!/class="keys"/.test(root.innerHTML), '? closes it again');
assert.match(draw({ kind: 'progress', title: 'Your progress', groups: [{ title: 'Skills', lines: [{ mark: 'half', text: 'Branches' }, { mark: 'now', text: 'Merging' }] }], actions: [] }), /<span class="mark-half"><span class="codicon codicon-color-mode" aria-label="learning" role="img"><\/span><\/span><span>Branches/, 'a skill being learned has its own half mark');

// Explore's next section keeps the title: still a new screen, read from the top
const section = { kind: 'explore', title: 'Python decorators', progress: { label: 'Section 3 of 8', done: 3, total: 8 }, body: 'Three', actions: [{ id: 'next', label: 'Next section', primary: true, key: 'enter' }] };
draw(section);
window.scrollY = 400; focused.length = 0; scrolls.length = 0;
h = draw({ ...section, progress: { label: 'Section 4 of 8', done: 4, total: 8 }, body: 'Four' });
assert.match(h, /<main class="k-explore enter">/);
assert.deepStrictEqual(scrolls, [0], 'a new section starts at the top');
assert.deepStrictEqual(focused, ['h1']);

// A press that keeps the screen keeps focus: on the pressed button, else on the primary
const q = { kind: 'step', title: 'Q', actions: [{ id: 'check', label: 'Check', primary: true, key: 'enter' }, { id: 'hint', label: 'Hint', key: 'h' }] };
draw(q);
focused.length = 0; scrolls.length = 0;
document.activeElement = { dataset: { action: 'hint' } };
keydown('h');
document.activeElement = null;
draw({ ...q, hint: { level: 1, text: 'Look' } });
assert.deepStrictEqual(scrolls, [400], 'the same screen keeps its scroll');
assert.deepStrictEqual(focused, ['[data-action="hint"]']);
focused.length = 0;
keydown('h');
draw({ ...q, hint: { level: 2, text: 'Closer' } });
assert.deepStrictEqual(focused, ['.actions .btn'], 'a key press with nothing focused lands on the primary');
window.scrollY = 0;

// Tones: a wait spins, info is a note; a read section is marked with an icon
assert.match(draw({ kind: 'setup', title: 'Your setup', result: { tone: 'info', text: 'Teach Me installs it' }, actions: [] }), /class="result info"[^>]*><span class="codicon codicon-info"/);
assert.match(draw({ kind: 'explore', title: 'W', result: { tone: 'wait', text: 'Writing' }, actions: [] }), /class="result wait"[^>]*><span class="codicon codicon-loading"/);
h = draw({ kind: 'explore', title: 'Python decorators', body: '8 sections. Open any of them.', choices: [{ n: 1, text: 'What a decorator is', done: true }, { n: 2, text: 'Why it works' }], actions: [{ id: 'read', label: 'Back to the reading', primary: true, key: 'b' }] });
assert.match(h, /data-choose="1"\s+aria-label="1: What a decorator is, read"><span class="n">1<\/span><span>What a decorator is <span class="done"><span class="codicon codicon-pass"/);
assert.ok(!/data-choose="2"[^>]*, read/.test(h));
assert.ok(!/disabled/.test(h), 'every section can be opened, read or not');
assert.match(require('fs').readFileSync(require('path').join(__dirname, '..', 'media', 'lesson.css'), 'utf8'), /\.choice \.n \{[^}]*color: var\(--vscode-textLink-foreground/, 'the choice number uses the link colour, readable in both themes');
// The place line of a lesson step is a button to the path
h = draw({ kind: 'step', title: 'T', progress: { label: 'Counting steps · 4 of 8', done: 3, total: 8, action: 'curriculum' }, actions: [] });
assert.match(h, /<button class="link place" data-action="curriculum" title="Open your path">Counting steps · 4 of 8<\/button>/);
assert.match(draw({ kind: 'step', title: 'T', progress: { label: 'Section 1 of 4', done: 1, total: 4 }, actions: [] }), /<div class="progress"><span>Section 1 of 4<\/span>/);
// Path: the lessons of the section under way sit under it
assert.match(draw({ kind: 'curriculum', title: 'P', lines: [{ mark: 'now', text: 'Branches' }, { mark: 'ok', text: 'Moves', sub: true }, { mark: 'now', text: 'Borrowing', sub: true, detail: '3 of 8 steps' }], actions: [] }), /<li><span class="mark-now">[\s\S]*<li class="sub"><span class="mark-ok">[\s\S]*<li class="sub"><span class="mark-now">[\s\S]*<span class="detail">3 of 8 steps<\/span>/);
// A path line with an action is a link; the open section in Explore's contents says so
assert.match(draw({ kind: 'curriculum', title: 'P', lines: [{ mark: 'ok', text: 'Moves', sub: true, action: 'open:moves-1' }], actions: [] }), /<li class="sub"><span class="mark-ok">[\s\S]*<button class="link" data-action="open:moves-1">Moves<\/button>/);
h = draw({ kind: 'explore', title: 'R', choices: [{ n: 1, text: 'One', done: true }, { n: 2, text: 'Two', done: true, here: true }], actions: [] });
assert.match(h, /data-choose="2"\s+aria-current="true" aria-label="2: Two, read, open now"/);
assert.match(h, /Two <span class="done">[\s\S]*<span class="here">here<\/span>/);
assert.ok(!/data-choose="1" aria-current/.test(h));
// Code in a step's text: a fence, or lines that are each one `span`, is a code block, not a pill per line
h = draw({ kind: 'step', title: 'T', actions: [], body: 'Does it compile?\n\n```rust\nlet s = String::from("hi");\n\nprintln!("<{}>", s);\n```\n\nThen `s` moves.' });
assert.match(h, /<p>Does it compile\?<\/p><pre class="code"><code>/);
assert.equal((h.match(/<span class="ln">/g) ?? []).length, 3, 'a blank line inside a fence stays in the block');
assert.match(h, /<span class="t-k">let<\/span> s/);
assert.ok(!/```|<\{\}>/.test(h), 'no fence marks, nothing becomes HTML');
assert.match(h, /<p>Then <code>s<\/code> moves\.<\/p>/);
h = draw({ kind: 'step', title: 'T', actions: [], body: 'A body:\n\n`let s = 1;`\n`s.push("<b>");`' });
assert.equal((h.match(/<span class="ln">/g) ?? []).length, 2, 'code lines are one block');
assert.ok(!/<p><code>|<b>/.test(h), 'not a pill each, and still escaped');
// The dashboard's Lesson view button: an open view shows its step again, with a glow, from the top
const flashed = [];
root.querySelector = (sel) => sel === 'main' ? { classList: { add: (c) => flashed.push(c) } } : { disabled: false, focus: () => focused.push(sel) };
focused.length = 0; scrolls.length = 0; window.scrollY = 300;
listeners.message({ data: { type: 'flash' } });
assert.match(root.innerHTML, /<main class="k-step enter">/);
assert.deepStrictEqual(flashed, ['flash']);
assert.deepStrictEqual(scrolls, [0]);
assert.ok(focused.includes('h1'));
assert.match(fs.readFileSync(require('path').join(__dirname, '..', 'media', 'lesson.css'), 'utf8'), /reduced-motion[^{]*\{[^}]*main\.flash/, 'no glow for reduced motion');
console.log('PASS view: highlighting, escaping, output lines, markdown, explore, code in text, flash');
