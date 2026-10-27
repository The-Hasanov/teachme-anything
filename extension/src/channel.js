"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_WAIT_MS = 25000;
const MAX_EVENTS = 200;

function startChannel({ folders, onView, dir = path.join(os.homedir(), '.teachme', 'vscode') }) {
    const token = crypto.randomBytes(24).toString('hex');
    const boot = crypto.randomUUID();
    const events = [];
    let last = 0;
    let waiting = [];
    let lastPollAt = 0;
    let port = 0;
    const file = path.join(dir, `${process.pid}.json`);

    const json = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body));
    const since = (after) => ({ boot, last, events: events.filter(e => e.seq > after) });
    const flush = () => {
        const ready = waiting;
        waiting = [];
        for (const w of ready) { clearTimeout(w.timer); json(w.res, 200, since(w.after)); }
    };
    const isLocal = (req) => {
        const host = req.headers.host ?? '';
        return (host === `127.0.0.1:${port}` || host === `localhost:${port}`) && !req.headers.origin && req.headers['x-teachme-token'] === token;
    };

    const server = http.createServer(async (req, res) => {
        if (!isLocal(req)) return json(res, 403, { error: 'forbidden' });
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'GET' && url.pathname === '/lesson/events') {
            lastPollAt = Date.now();
            const after = Number(url.searchParams.get('after')) || 0;
            const wait = Math.min(Number(url.searchParams.get('wait')) || 0, MAX_WAIT_MS);
            if (events.some(e => e.seq > after) || !wait) return json(res, 200, since(after));
            const w = { res, after, timer: setTimeout(() => { waiting = waiting.filter(x => x !== w); json(res, 200, since(after)); }, wait) };
            waiting.push(w);
            req.on('close', () => { clearTimeout(w.timer); waiting = waiting.filter(x => x !== w); });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/lesson/view') {
            let body = '';
            for await (const chunk of req) body += chunk;
            try {
                const m = JSON.parse(body);
                json(res, 204);
                onView(m.screen, m.layout);
            } catch {
                json(res, 400, { error: 'bad json' });
            }
            return;
        }
        json(res, 404, { error: 'not found' });
    });

    const writeFile = (list) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ port, token, folders: list, pid: process.pid }), { mode: 0o600 });
    };

    const ready = new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { port = server.address().port; writeFile(folders); resolve(port); });
    });

    return {
        ready,
        token,
        get port() { return port; },
        push(ev) {
            events.push({ ...ev, seq: ++last });
            if (events.length > MAX_EVENTS) events.shift();
            flush();
        },
        isConnected: () => Date.now() - lastPollAt < MAX_WAIT_MS + 5000,
        setFolders: writeFile,
        close() {
            for (const w of waiting) { clearTimeout(w.timer); w.res.end(); }
            waiting = [];
            server.close();
            try { fs.unlinkSync(file); } catch { }
        },
    };
}

module.exports = { startChannel };
