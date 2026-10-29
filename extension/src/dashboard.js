"use strict";
const vscode = require("vscode");
const crypto = require("crypto");

const VIEW_TYPE = 'teachme.dashboard';

function registerDashboard(context, layout, channel) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const codicons = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');
    let panel;
    let state = { data: undefined, screen: undefined, up: false };
    const post = () => panel?.webview.postMessage({ type: 'state', ...state });

    const html = (webview) => {
        const nonce = crypto.randomBytes(16).toString('hex');
        const src = (base, f) => webview.asWebviewUri(vscode.Uri.joinPath(base, f));
        return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${src(codicons, 'codicon.css')}"><link rel="stylesheet" href="${src(media, 'dashboard.css')}">
</head><body><div id="root"></div><script nonce="${nonce}" src="${src(media, 'dashboard.js')}"></script></body></html>`;
    };

    const open = () => {
        const { panel: p, isNew } = layout.panel(VIEW_TYPE, 'Teach Me', { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media, codicons] });
        panel = p;
        if (!isNew) return post();
        p.iconPath = vscode.Uri.joinPath(media, 'teachme.svg');
        p.webview.html = html(p.webview);
        p.webview.onDidReceiveMessage(m => {
            if (m.type === 'ready') post();
            if (m.type === 'press') channel.push({ type: 'press', press: m.press, t: Date.now() });
            if (m.type === 'lesson') vscode.commands.executeCommand('teachme.lesson.focus');
        });
        p.onDidDispose(() => { panel = undefined; });
    };

    context.subscriptions.push(vscode.commands.registerCommand('teachme.dashboard', open));
    return {
        update(screen, data) { state = { ...state, screen, ...(data ? { data } : {}) }; post(); },
        connection(up) { state = { ...state, up }; post(); },
    };
}

module.exports = { registerDashboard, VIEW_TYPE };
