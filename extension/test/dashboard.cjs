const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'media', 'dashboard.js'), 'utf8');

const listeners = {};
const posted = [];
let saved;
let click, keydown;
const focused = [];
const root = { innerHTML: '', innerText: '', className: '', querySelector: (sel) => sel.startsWith('[data-') ? { focus: () => focused.push(sel) } : null, querySelectorAll: () => [], addEventListener: (t, f) => { if (t === 'click') click = f; if (t === 'keydown') keydown = f; } };
const document = { getElementById: () => root, activeElement: null };
const sandbox = {
  acquireVsCodeApi: () => ({ getState: () => undefined, setState: (s) => { saved = s; }, postMessage: (m) => posted.push(m) }),
  document,
  window: { addEventListener: (t, f) => { listeners[t] = f; } },
  requestAnimationFrame: (f) => f(),
};
new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));

const send = (state) => { listeners.message({ data: { type: 'state', ...state } }); return root.innerHTML; };
const press = (dataset) => click({ target: { closest: () => ({ dataset, disabled: false }) } });

assert.deepStrictEqual(posted.filter(m => m.type !== 'rendered'), [{ type: 'ready' }], 'the page asks for its state once it has loaded');
assert.match(root.innerHTML, /No course yet/);

const data = {
  title: 'Rust <fundamentals>', goal: 'write safe tools', overall: { label: '4 of 9 lessons', done: 4, total: 9 },
  phases: [
    { id: 'basics', title: 'Basics', mark: 'ok', done: 3, total: 3, lessons: [{ title: 'Functions', status: 'done' }] },
    { id: 'own', title: 'Ownership', mark: 'now', done: 1, total: 3, lessons: [{ title: 'Moves', status: 'done' }, { title: 'Borrowing', status: 'now', steps: '5 of 6 steps' }, { title: 'Not written yet', status: 'writing' }] },
    { id: 'structs', title: 'Structs, enums and errors', mark: 'todo', done: 0, total: 2, lessons: [{ title: 'Not written yet', status: 'failed' }, { title: 'Not written yet', status: 'todo' }] },
  ],
};
const screen = { title: 'Your turn: shout', progress: { label: '5 of 6', done: 4, total: 6 }, result: { tone: 'wrong', text: 'Not yet' }, actions: [{ id: 'check', label: 'Check', primary: true }, { id: 'hint', label: 'Hint 1' }] };

let h = send({ data, screen, up: true });
assert.match(h, /Rust &lt;fundamentals&gt;/, 'course text is escaped');
assert.ok(!/<fundamentals>/.test(h));
assert.match(h, /data-p="44"/, 'the ring shows the overall percent');
assert.match(h, /data-tab="path" aria-selected="true"/, "Path is the first tab");
assert.equal((h.match(/class="card phase /g) ?? []).length, 3, 'one card per phase');
assert.match(h, /3 of 3 lessons/);
assert.match(h, /class="lesson now">.*Borrowing.*5 of 6 steps/s);
assert.match(h, /class="lesson writing">.*Being written…/s);
assert.match(h, /class="lesson failed">.*Could not be written/s);
assert.match(h, /data-w="33"/, 'a phase bar is its share of lessons done');
assert.match(send({ data: { ...data, phases: [{ ...data.phases[1], progress: 1.5 }] }, screen, up: true }), /data-key="phase-0" data-w="50"/, 'the current phase bar counts the lesson under way');
h = send({ data, screen, up: true });
assert.match(h, /data-reset="basics"/);
assert.match(h, /data-reset="own"/);
assert.ok(!/data-reset="structs"/.test(h), 'a phase not started has nothing to reset');

press({ tab: 'control' });
h = root.innerHTML;
assert.deepStrictEqual(saved, { tab: 'control' }, 'the open tab is remembered');
assert.match(h, /data-tab="control" aria-selected="true"/);
assert.match(h, /Connected to Claude Code/);
assert.match(h, /Your turn: shout/);
assert.match(h, /class="result wrong"><i class="codicon codicon-warning" aria-hidden="true"><\/i><span>Not yet<\/span>/, 'the tone is a border and an icon; the text keeps the normal color');
assert.match(h, /<button class="btn primary" data-press="check" >Check<\/button>/);
assert.match(h, /data-reset="" data-title="Rust &lt;fundamentals&gt;"/, 'the whole course can be reset');

posted.length = 0;
press({ press: 'check' });
posted.splice(0, posted.length, ...posted.filter(m => m.type !== 'rendered'));
press({ press: 'tutor' });
press({ lesson: '' });
press({ reset: 'own', title: 'Ownership' });
press({ reset: '', title: 'Rust' });
assert.deepStrictEqual(posted, [
  { type: 'press', press: { action: 'check' } },
  { type: 'press', press: { action: 'tutor' } },
  { type: 'lesson' },
  { type: 'reset', phase: 'own', title: 'Ownership' },
  { type: 'reset', phase: undefined, title: 'Rust' },
]);

h = send({ data, screen, up: false });
assert.match(h, /Not connected/);
assert.match(send({ data, screen, up: true }), /class="card status up flash"/, 'the dot glows once when the session connects');
assert.match(send({ data, screen, up: true }), /class="card status up"/, 'and not again on the next redraw');
h = send({ data, screen, up: false });
assert.match(h, /data-press="check" disabled/, 'nothing is sent while no session listens');
assert.match(h, /data-press="tutor" disabled/);
assert.match(h, /data-lesson>/, 'the lesson view opens without a session');
posted.length = 0;
click({ target: { closest: () => ({ dataset: { press: 'check' }, disabled: true }) } });
assert.deepStrictEqual(posted, [], 'a disabled button sends nothing');

press({ tab: 'path' });
assert.match(root.innerHTML, /data-tab="path" aria-selected="true"/);

// Tabs work from the keyboard: only the open tab is in the Tab order, arrows move between them and focus follows
h = root.innerHTML;
assert.match(h, /id="tab-path" data-tab="path" aria-selected="true" aria-controls="panel" tabindex="0"/);
assert.match(h, /id="tab-control" data-tab="control" aria-selected="false" aria-controls="panel" tabindex="-1"/);
assert.match(h, /<main class="tab-body" id="panel" role="tabpanel" aria-labelledby="tab-path"/);
const key = (k) => { let stopped = false; keydown({ key: k, target: { dataset: { tab: 'x' } }, preventDefault: () => { stopped = true; } }); return stopped; };
for (const [k, want] of [['ArrowRight', 'control'], ['ArrowRight', 'path'], ['ArrowLeft', 'control'], ['Home', 'path'], ['End', 'control']]) {
  focused.length = 0;
  assert.ok(key(k), `${k} is handled`);
  assert.match(root.innerHTML, new RegExp(`data-tab="${want}" aria-selected="true"`), `${k} opens ${want}`);
  assert.deepStrictEqual(focused, [`[data-tab="${want}"]`], 'focus moves to the open tab');
}
focused.length = 0;
press({ tab: 'path' });
assert.deepStrictEqual(focused, ['[data-tab="path"]'], 'a click or Enter on a tab keeps focus on it');
assert.equal(root.className, 'tab', 'a tab change plays the tab entrance only');

// A screen update redraws without entrances and puts focus back where it was
press({ tab: 'control' });
focused.length = 0;
document.activeElement = { dataset: { press: 'check' } };
send({ data, screen, up: true });
assert.equal(root.className, '', 'no entrance replays on an update');
assert.deepStrictEqual(focused, ['[data-press="check"]']);
document.activeElement = null;

press({ tab: 'path' });
assert.match(send({ data: { ...data, phases: [{ ...data.phases[2], total: 1 }] }, screen, up: true }), /0 of 1 lesson</, 'one lesson is singular');

console.log('PASS dashboard: path, control, tab switch, keyboard tabs, focus kept, buttons, escaping');
