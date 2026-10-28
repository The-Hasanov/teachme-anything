const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'media', 'lesson.js'), 'utf8');
const listeners = {};
const root = { innerHTML: '', querySelectorAll: () => [] };
const sandbox = {
  acquireVsCodeApi: () => ({ getState: () => undefined, setState() {}, postMessage() {} }),
  document: { getElementById: () => root, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, activeElement: null },
  window: { addEventListener: (t, f) => { listeners[t] = f; }, scrollY: 0, scrollTo() {} },
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
console.log('PASS view: highlighting, escaping, output lines, markdown');
