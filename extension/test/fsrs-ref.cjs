const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teachme-fsrs-'));
execFileSync('npm', ['i', '--silent', '--prefix', tmp, 'ts-fsrs@4.7.1'], { shell: true, stdio: 'ignore' });
const bundle = path.join(tmp, 'fsrs.cjs');
execFileSync('npx', ['-y', 'esbuild@0.25.10', path.join(__dirname, '..', '..', 'hooks', 'engine', 'fsrs.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`, '--log-level=error'], { shell: true });
const mine = require(bundle);
const ref = require(path.join(tmp, 'node_modules', 'ts-fsrs'));

const DAY = 86_400_000;
const f = ref.fsrs(ref.generatorParameters({ enable_fuzz: false, enable_short_term: true }));
const histories = [
    [[0, 3], [1, 3], [4, 3], [14, 3]],
    [[0, 1], [0.01, 3], [1, 3], [3, 2], [10, 1], [11, 3]],
    [[0, 4], [5, 4], [30, 3]],
    [[0, 2], [2, 1], [2.5, 3], [6, 3], [20, 2]],
];
let checked = 0;
for (const h of histories) {
    const t0 = Date.parse('2026-01-01T09:00:00Z');
    let refCard = ref.createEmptyCard(new Date(t0));
    let card;
    for (const [day, g] of h) {
        const now = t0 + day * DAY;
        refCard = f.next(refCard, new Date(now), g).card;
        card = mine.review(card, g, now);
        assert.ok(Math.abs(card.s - refCard.stability) < 1e-3 * Math.max(1, refCard.stability), `S ${card.s} vs ${refCard.stability} at day ${day}, rating ${g}`);
        assert.ok(Math.abs(card.d - refCard.difficulty) < 1e-3, `D ${card.d} vs ${refCard.difficulty} at day ${day}, rating ${g}`);
        checked++;
    }
}
console.log(`PASS fsrs: ${checked} reviews match ts-fsrs`);
