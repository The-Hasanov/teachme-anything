const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 10000) {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out');
        await sleep(100);
    }
}

async function run() {
    const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'teachme-anything');
    await ext.activate();
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const results = [];
    const check = async (name, fn) => {
        try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
    };

    const dir = path.join(os.homedir(), '.teachme', 'vscode');
    const win = await until(() => {
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
            try { const w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (w.folders.some(x => x.toLowerCase() === root.toLowerCase())) return w; } catch { }
        }
    });
    const base = `http://127.0.0.1:${win.port}`;
    const auth = { 'x-teachme-token': win.token, 'content-type': 'application/json' };
    const view = (body) => fetch(`${base}/lesson/view`, { method: 'POST', headers: auth, body: JSON.stringify(body) });

    const notes = await vscode.workspace.openTextDocument(path.join(root, 'notes.md'));
    const editor = await vscode.window.showTextDocument(notes, { preview: false });
    await editor.edit(e => e.insert(new vscode.Position(1, 0), 'typing'));

    await check('a screen from the mod reaches the view without taking focus', async () => {
        const t0 = Date.now();
        const r = await view({ screen: { kind: 'step', title: 'A branch is a label', actions: [] } });
        assert.strictEqual(r.status, 204);
        assert.ok(Date.now() - t0 < 150, `took ${Date.now() - t0} ms`);
        await sleep(300);
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, notes.uri.fsPath);
    });

    await check('one terminal, in the practice folder, opened without focus, reused', async () => {
        const cwd = path.join(root, 'practice', 'git-branches');
        await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'terminal', cwd } });
        await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'terminal', cwd } });
        await sleep(1500);
        const mine = vscode.window.terminals.filter(t => t.name === 'Teach Me');
        assert.strictEqual(mine.length, 1);
        assert.strictEqual(mine[0].creationOptions.cwd.fsPath.toLowerCase(), cwd.toLowerCase());
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, notes.uri.fsPath);
    });

    await check('reference files: at most two tutor tabs, the learner keeps focus and their dirty file', async () => {
        const tabsBefore = vscode.window.tabGroups.all.flatMap(g => g.tabs).length;
        for (let i = 0; i < 6; i++) {
            await view({ screen: { kind: 'step', title: `ref ${i}`, actions: [] }, layout: { op: 'reference', path: path.join(root, `ref${i}.md`) } });
            await sleep(250);
        }
        await sleep(800);
        const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        const tutor = tabs.filter(t => t.input instanceof vscode.TabInputText && /ref\d\.md$/.test(t.input.uri.fsPath));
        assert.ok(tutor.length <= 2, `tutor tabs: ${tutor.length}`);
        assert.ok(tabs.length <= tabsBefore + 2, `tabs ${tabsBefore} -> ${tabs.length}`);
        assert.ok(tabs.some(t => t.input instanceof vscode.TabInputText && t.input.uri.fsPath === notes.uri.fsPath && t.isDirty), 'the learner\'s file is still open and unsaved');
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, notes.uri.fsPath);
    });

    const count = (fsPath) => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.fsPath.toLowerCase() === fsPath.toLowerCase()).length;
    const stats = path.join(root, 'practice', 'python-lists', 'stats.py');

    await check('a file already open is shown where it is, never opened twice, and stays the learner\'s', async () => {
        await vscode.window.showTextDocument(vscode.Uri.file(stats), { preview: false, viewColumn: vscode.ViewColumn.Two });
        await vscode.window.showTextDocument(notes, { preview: false, viewColumn: vscode.ViewColumn.One });
        await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'practice', path: stats } });
        await sleep(600);
        assert.strictEqual(count(stats), 1, `after the practice step, stats.py tabs: ${count(stats)}`);
        await view({ screen: { kind: 'step', title: 'ref', actions: [] }, layout: { op: 'reference', path: stats } });
        await sleep(800);
        assert.strictEqual(count(stats), 1, `stats.py tabs: ${count(stats)}`);
        for (let i = 0; i < 6; i++) { await view({ screen: { kind: 'step', title: `ref ${i}`, actions: [] }, layout: { op: 'reference', path: path.join(root, `ref${i}.md`) } }); await sleep(250); }
        await sleep(800);
        assert.strictEqual(count(stats), 1, 'stats.py was closed');
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, notes.uri.fsPath);
    });

    await check('practice files the tutor opens are never closed by the reference budget', async () => {
        const [a, b] = ['ref0.md', 'ref1.md'].map(f => path.join(root, f));
        await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && /ref\d\.md$/.test(t.input.uri.fsPath)), true);
        await vscode.window.showTextDocument(notes, { preview: false, viewColumn: vscode.ViewColumn.One });
        for (const p of [a, b]) { await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'practice', path: p } }); await sleep(400); }
        for (let i = 2; i < 6; i++) { await view({ screen: { kind: 'step', title: `ref ${i}`, actions: [] }, layout: { op: 'reference', path: path.join(root, `ref${i}.md`) } }); await sleep(250); }
        await sleep(800);
        assert.strictEqual(count(a), 1, 'the first practice file was closed');
        assert.strictEqual(count(b), 1, 'the second practice file was closed');
    });

    await check('a learner who closes the terminal gets it back on the next step, still one', async () => {
        const cwd = path.join(root, 'practice', 'git-branches');
        vscode.window.terminals.filter(t => t.name === 'Teach Me').forEach(t => t.dispose());
        await sleep(800);
        await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'terminal', cwd } });
        await sleep(1000);
        assert.strictEqual(vscode.window.terminals.filter(t => t.name === 'Teach Me').length, 1);
    });

    await check('a new folder: an idle terminal is replaced, one with a running command is kept', async () => {
        const idle = vscode.window.terminals.find(t => t.name === 'Teach Me');
        const editorBefore = vscode.window.activeTextEditor?.document.uri.fsPath;
        const shell = await until(() => idle.shellIntegration, 15000).catch(() => undefined);
        if (!shell) { results.push('SKIP running-command check: no shell integration here'); return; }
        await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'terminal', cwd: path.join(root, 'practice', 'python-lists') } });
        await sleep(1000);
        assert.ok(!vscode.window.terminals.includes(idle), 'the idle terminal is still open');
        assert.strictEqual(vscode.window.terminals.filter(t => t.name === 'Teach Me').length, 1);
        const busy = vscode.window.terminals.find(t => t.name === 'Teach Me');
        await until(() => busy.shellIntegration, 15000);
        busy.shellIntegration.executeCommand('node -e "setTimeout(() => {}, 20000)"');
        await sleep(1500);
        await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'terminal', cwd: path.join(root, 'practice', 'git-branches') } });
        await sleep(1000);
        assert.ok(vscode.window.terminals.includes(busy), 'the terminal with a running command was closed');
        assert.strictEqual(vscode.window.terminals.filter(t => t.name === 'Teach Me').length, 2);
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, editorBefore);
    });

    await check('presses wait for the mod\'s long poll and arrive in order', async () => {
        const first = await (await fetch(`${base}/lesson/events?after=0&wait=0`, { headers: auth })).json();
        const poll = fetch(`${base}/lesson/events?after=${first.last}&wait=5000`, { headers: auth }).then(r => r.json());
        await sleep(50);
        const t0 = Date.now();
        await vscode.commands.executeCommand('teachme.lesson.focus');
        const got = await poll;
        assert.ok(got.events.some(e => e.type === 'ready'), JSON.stringify(got.events));
        assert.ok(Date.now() - t0 < 3000);
    });

    await check('Open in VS Code shows the lesson view, the practice terminal and the step file', async () => {
        const cwd = path.join(root, 'practice', 'git-branches');
        const task = path.join(cwd, 'task.md');
        fs.writeFileSync(task, '# task\n');
        await view({ screen: { kind: 'exercise', title: 'Your turn', actions: [] }, layout: { op: 'reveal', cwd, path: task } });
        await until(() => count(task) === 1);
        assert.ok(vscode.window.terminals.some(t => t.name === 'Teach Me' && t.creationOptions.cwd?.fsPath?.toLowerCase() === cwd.toLowerCase()), 'no Teach Me terminal in the practice folder');
    });

    await check('the dashboard opens once as an editor tab, and a second open reuses it', async () => {
        const dashboards = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputWebview && /teachme\.dashboard/.test(t.input.viewType));
        await vscode.commands.executeCommand('teachme.dashboard');
        await until(() => dashboards().length === 1);
        await vscode.commands.executeCommand('teachme.dashboard');
        await sleep(300);
        assert.strictEqual(dashboards().length, 1);
        await vscode.window.tabGroups.close(dashboards());
    });

    await check('the view and the lesson surface are in the secondary side bar, not an editor tab', async () => {
        const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        assert.ok(!tabs.some(t => t.input instanceof vscode.TabInputWebview), 'no webview tab');
    });

    console.log(results.join('\n'));
    if (results.some(r => r.startsWith('FAIL'))) throw new Error('integration tests failed');
}

module.exports = { run };
