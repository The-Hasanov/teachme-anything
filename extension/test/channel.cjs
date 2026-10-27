const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startChannel } = require('../src/channel');

const raw = (port, opts) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...opts }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
});

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teachme-channel-'));
    let viewed;
    const ch = startChannel({ folders: ['C:\\course'], dir, onView: (screen) => { viewed?.(screen); } });
    const port = await ch.ready;
    const found = JSON.parse(fs.readFileSync(path.join(dir, `${process.pid}.json`), 'utf8'));
    assert.deepStrictEqual(found.folders, ['C:\\course']);
    const auth = { 'x-teachme-token': ch.token };

    assert.strictEqual((await raw(port, { path: '/lesson/events', headers: {} })).status, 403);
    assert.strictEqual((await raw(port, { path: '/lesson/events', headers: { ...auth, origin: 'http://evil.example' } })).status, 403);
    assert.strictEqual((await raw(port, { path: '/lesson/events', headers: { ...auth, host: `evil.example:${port}` } })).status, 403);

    const base = `http://127.0.0.1:${port}`;
    let after = 0, boot;
    const poll = async () => {
        const r = await fetch(`${base}/lesson/events?after=${after}&wait=20000`, { headers: auth });
        const b = await r.json();
        boot ??= b.boot;
        after = b.last;
        return b.events;
    };
    const rounds = [];
    for (let i = 0; i < 50; i++) {
        const got = poll();
        await new Promise(r => setTimeout(r, 5));
        const t0 = performance.now();
        ch.push({ type: 'press', press: { action: 'next' }, t: Date.now() });
        const evs = await got;
        assert.strictEqual(evs.length, 1);
        const shown = new Promise(r => { viewed = r; });
        await fetch(`${base}/lesson/view`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ screen: { kind: 'step', title: `s${i}`, actions: [] } }) });
        await shown;
        rounds.push(performance.now() - t0);
    }
    rounds.sort((a, b) => a - b);
    const p95 = rounds[Math.floor(rounds.length * 0.95)];
    console.log(`channel round trip (press → mod → screen): median ${rounds[25].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
    assert.ok(p95 < 50, `round trip p95 ${p95} ms`);
    assert.ok(ch.isConnected());

    const t = performance.now();
    const idle = await (await fetch(`${base}/lesson/events?after=${after}&wait=200`, { headers: auth })).json();
    assert.deepStrictEqual(idle.events, []);
    assert.ok(performance.now() - t >= 190);
    ch.close();
    assert.ok(!fs.existsSync(path.join(dir, `${process.pid}.json`)));
    console.log('PASS channel');
})().catch(e => { console.error(e); process.exit(1); });
