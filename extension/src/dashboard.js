"use strict";
const vscode = require("vscode");
const crypto = require("crypto");

const VIEW_TYPE = 'teachme.dashboard';
const RESET = 'Reset';
const RESET_FRESH = 'Reset and write new lessons';

function registerDashboard(context, layout, channel) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const codicons = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');
    let panel;
    let state = { data: undefined, screen: undefined, up: false };
    let rendered;
    const renders = new Set();
    const post = () => panel?.webview.postMessage({ type: 'state', ...state });

    const html = (webview) => {
        const nonce = crypto.randomBytes(16).toString('hex');
        const src = (base, f) => webview.asWebviewUri(vscode.Uri.joinPath(base, f));
        return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${src(codicons, 'codicon.css')}"><link rel="stylesheet" href="${src(media, 'dashboard.css')}">
</head><body><div id="root"></div><script nonce="${nonce}" src="${src(media, 'dashboard.js')}"></script></body></html>`;
    };

    const confirmReset = async (phase, title) => {
        const detail = 'Every answer, hint and review in it is cleared, and its practice files are backed up to <folder>.old-<time>. "Write new lessons" also sets the written lessons aside, so the questions, exercises and practice programs are written again from scratch. This cannot be undone.';
        const pick = await vscode.window.showWarningMessage(`Reset your progress in ${title}?`, { modal: true, detail }, RESET, RESET_FRESH);
        if (pick) channel.push({ type: 'press', press: { action: `reset:${phase ?? ''}${pick === RESET_FRESH ? ':fresh' : ''}` }, t: Date.now() });
    };

    const open = () => {
        const { panel: p, isNew } = layout.panel(VIEW_TYPE, 'Teach Me', { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media, codicons] });
        panel = p;
        if (!isNew) return post();
        p.iconPath = { light: vscode.Uri.joinPath(media, 'teachme-tab-light.svg'), dark: vscode.Uri.joinPath(media, 'teachme-tab-dark.svg') };
        p.webview.html = html(p.webview);
        p.webview.onDidReceiveMessage(m => {
            if (m.type === 'ready') post();
            if (m.type === 'rendered') { rendered = { tab: m.tab, text: m.text }; renders.forEach(fn => fn(rendered)); }
            if (m.type === 'press') channel.push({ type: 'press', press: m.press, t: Date.now() });
            if (m.type === 'lesson') vscode.commands.executeCommand('teachme.lesson.focus');
            if (m.type === 'reset') void confirmReset(m.phase, m.title);
        });
        p.onDidDispose(() => { panel = undefined; });
    };

    context.subscriptions.push(vscode.commands.registerCommand('teachme.dashboard', open));
    return {
        update(screen, data) { state = { ...state, screen, ...(data ? { data } : {}) }; post(); },
        rendered: () => rendered,
        onRender(fn) { renders.add(fn); return () => renders.delete(fn); },
        click: (selector) => panel?.webview.postMessage({ type: 'click', selector }),
        connection(up) { state = { ...state, up }; post(); },
    };
}

module.exports = { registerDashboard, VIEW_TYPE };
